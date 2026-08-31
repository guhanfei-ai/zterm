import { ipcMain, BrowserWindow } from 'electron'
import { TerminalSession } from '../services/terminalSessionManager'
import { getSecret } from '../services/secretVault'
import { getStore } from '../services/store'
import { translateError } from '../services/errorTranslator'
import { createJumpserverFreshToken, resolveKokoSshParams } from '../services/jumpserverClient'
import type { HostRecord } from './hosts'
import { getJumpserverConnectContext, resolveJumpserverConfigForConnect } from './jumpserver'
import { LocalPtySession, getPlatformShell, getPlatformDisplayName } from '../services/localPtySession'
import {
  cleanupLocalSession,
  createLocalSession,
  disposeAllLocalSessions,
  getAllLocalSessions,
  getLocalSession,
  removeLocalSession,
  terminalSessionManager
} from '../data/terminal/terminalSessionRegistry'

export { disposeAllLocalSessions, getAllLocalSessions, getLocalSession, terminalSessionManager } from '../data/terminal/terminalSessionRegistry'
import { readFileSync } from 'node:fs'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { normalizeReconnectTarget } from '../model/workspace'
import type { SshHostTrustResponse } from '../model/sshHostTrust'
import { resetSshHostTrustRecord } from '../services/sshHostTrust'

const hostPrivateKeyFilePassphraseSecretKey = (id: string): string => `host_pkf_pp_${id}`

// Forward events to the renderer with tabId included
function forwardToRenderer(eventName: string, data?: unknown): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    // 已销毁窗口直接跳过：quit 过程中窗口先关、会话关闭事件后到时，
    // 直接 send 会抛 "Object has been destroyed"，并中断 before-quit 的清理链
    if (win.isDestroyed()) continue
    win.webContents.send(eventName, data)
  }
}

// Register event forwarding for a specific terminal session
function registerSessionEvents(session: TerminalSession): void {
  session.on('data', (data: Buffer) => {
    forwardToRenderer('terminal:onData', { tabId: session.tabId, data: data.toString('utf-8') })
  })

  session.on('connected', () => {
    forwardToRenderer('terminal:onConnected', { tabId: session.tabId, generation: session.generation })
  })

  session.on('host-trust-required', (data) => {
    forwardToRenderer('terminal:onHostTrustRequired', data)
  })

  // P1-1：closed 事件签名统一（C1）。既支持 SSH（{ reason, hadError }）也兼容本地（void）。
  session.on('closed', (info?: { reason?: string; hadError?: boolean }) => {
    const reason: string = info?.reason ?? 'normal'
    const hadError: boolean = info?.hadError ?? false
    forwardToRenderer('terminal:onClosed', {
      tabId: session.tabId,
      generation: session.generation,
      hadError,
      reason,
      detail: reason
    })
    // SSH 会话已关闭：从注册表移除死会话（对齐本地版 closed 的 cleanupLocalSession）。
    // renderer 收到 onClosed 后会把 tab 置为 disconnected，关闭 tab 时会跳过
    // terminal:disconnect，若此处不清理，死 session（含 ssh2 Client 引用与输出缓冲）
    // 将永久残留在会话管理器中直到进程退出。
    // 顺序：先移除监听再 removeSession，避免 removeSession 内部再次 emit
    // 'closed' 时递归进入本 handler。
    session.removeAllListeners()
    if (terminalSessionManager.getSession(session.tabId) === session) {
      terminalSessionManager.removeSession(session.tabId)
    }
  })

  session.on('shell-closed', (detail?: { reason: string }) => {
    forwardToRenderer('terminal:onShellClosed', {
      tabId: session.tabId,
      generation: session.generation,
      detail: detail?.reason || 'shell channel closed'
    })
  })

  session.on('error', (err: Error, source?: string) => {
    forwardToRenderer('terminal:onError', {
      tabId: session.tabId,
      generation: session.generation,
      error: err.message,
      source: source || 'unknown',
      // P8: 保留原始错误类型，便于区分 ECONNRESET / ETIMEDOUT / keepalive timeout 等
      code: (err as NodeJS.ErrnoException).code || undefined
    })
  })
}

/** 为本地 PTY 会话注册事件转发（与 SSH 版本同构，共享同一套事件流） */
function registerLocalSessionEvents(session: LocalPtySession): void {
  session.on('data', (data: Buffer) => {
    forwardToRenderer('terminal:onData', { tabId: session.tabId, data: data.toString('utf-8') })
  })

  session.on('connected', () => {
    forwardToRenderer('terminal:onConnected', { tabId: session.tabId, generation: session.generation })
  })

  session.on('closed', (info?: { reason?: string; hadError?: boolean }) => {
    const reason: string = info?.reason ?? 'normal'
    const hadError: boolean = info?.hadError ?? false
    forwardToRenderer('terminal:onClosed', {
      tabId: session.tabId,
      generation: session.generation,
      hadError,
      reason,
      detail: reason
    })
    cleanupLocalSession(session)
  })

  session.on('shell-closed', (detail?: { reason: string; exitCode?: number; signal?: number }) => {
    forwardToRenderer('terminal:onShellClosed', {
      tabId: session.tabId,
      generation: session.generation,
      detail: detail?.reason || 'shell channel closed',
      exitCode: detail?.exitCode,
      signal: detail?.signal
    })
  })

  session.on('error', (err: Error) => {
    forwardToRenderer('terminal:onError', {
      tabId: session.tabId,
      generation: session.generation,
      error: err.message,
      source: 'local-pty'
    })
    if (!session.connected) {
      cleanupLocalSession(session)
    }
  })
}

function notifyConnecting(session: TerminalSession): void {
  forwardToRenderer('terminal:onConnecting', { tabId: session.tabId, generation: session.generation })
}

function notifyLocalConnecting(session: LocalPtySession): void {
  forwardToRenderer('terminal:onConnecting', { tabId: session.tabId, generation: session.generation })
}

async function resolveSshConnectHosts(host: string): Promise<string[]> {
  if (!host || isIP(host)) return [host]

  try {
    const resolved = await lookup(host, { all: true })
    const ordered = [
      ...resolved.filter((item) => item.family === 4).map((item) => item.address),
      ...resolved.filter((item) => item.family === 6).map((item) => item.address),
      host
    ]
    return Array.from(new Set(ordered.filter(Boolean)))
  } catch {
    return [host]
  }
}

function isSshAuthenticationError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.message.includes('All configured authentication methods failed') ||
    err.message.includes('Authentication failed') ||
    err.message.includes('authentication failed')
  )
}

function formatKokoConnectError(err: unknown): string {
  const translated = translateError(err, 'ssh')
  return isSshAuthenticationError(err)
    ? `koko SSH 鉴权失败：${translated}`
    : `koko SSH 连接失败：${translated}`
}

function formatDirectConnectError(err: unknown): string {
  if (err instanceof Error && err.message.startsWith('SSH 主机身份')) return err.message
  if (err instanceof Error && err.message.startsWith('无法验证 SSH 主机身份')) return err.message
  if (err instanceof Error && err.message.startsWith('无法保存 SSH 主机信任记录')) return err.message
  return `SSH 连接失败：${translateError(err, 'ssh')}`
}

type TerminalConnectResult = { success: boolean; generation?: number; error?: string }

async function connectDirectTerminal(data: {
  tabId: string
  hostId: string
  cols: number
  rows: number
}): Promise<TerminalConnectResult> {
  let session: TerminalSession | undefined
  let password: string | undefined
  let privateKey: string | undefined
  let passphrase: string | undefined
  try {
    const rawHosts = getStore().get('hosts_list')
    const hosts: HostRecord[] = Array.isArray(rawHosts) ? (rawHosts as HostRecord[]) : []
    const host = hosts.find((item) => item.id === data.hostId)

    if (!host) {
      return { success: false, error: '未找到主机' }
    }

    if (host.authType === 'password') {
      password = getSecret(`host_pwd_${host.id}`)
    } else if (host.authType === 'key' && host.keyId) {
      privateKey = getSecret(`key_pk_${host.keyId}`)
      passphrase = getSecret(`key_pp_${host.keyId}`) || undefined
    } else if (host.authType === 'privateKeyFile') {
      if (!host.privateKeyFilePath) {
        return { success: false, error: '未配置 SSH 私钥文件' }
      }

      try {
        privateKey = readFileSync(host.privateKeyFilePath, 'utf-8')
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException
        if (error.code === 'ENOENT') {
          return { success: false, error: 'SSH 私钥文件不存在，请重新选择文件' }
        }
        if (error.code === 'EACCES' || error.code === 'EPERM') {
          return { success: false, error: 'SSH 私钥文件不可读，请检查文件权限' }
        }
        return { success: false, error: '读取 SSH 私钥文件失败' }
      }

      if (!privateKey.trim()) {
        return { success: false, error: 'SSH 私钥文件内容为空' }
      }

      passphrase = getSecret(hostPrivateKeyFilePassphraseSecretKey(host.id)) || undefined
    }

    session = terminalSessionManager.createSession(data.tabId)
    registerSessionEvents(session)
    notifyConnecting(session)
    session.sessionMeta = {
      source: 'direct',
      displayName: host.name || host.host,
      displaySecondary: `${host.username}@${host.host}`
    }

    await session.connect({
      host: host.host,
      port: host.port,
      username: host.username,
      password,
      privateKey,
      passphrase,
      requireHostTrust: true
    })
    await session.openShell(data.cols, data.rows)
    return { success: true, generation: session.generation }
  } catch (err: unknown) {
    if (session && terminalSessionManager.getSession(data.tabId) === session) {
      terminalSessionManager.removeSession(data.tabId)
    }
    return { success: false, generation: session?.generation, error: formatDirectConnectError(err) }
  } finally {
    password = undefined
    privateKey = undefined
    passphrase = undefined
  }
}

async function connectJumpserverTerminal(data: {
  tabId: string
  cols: number
  rows: number
  configId: string
  assetId: string
  accountId: string
  assetName: string
  accountName?: string
}): Promise<TerminalConnectResult> {
  let session: TerminalSession | undefined
  let freshToken: { id: string; value: string; clientUrl: string } | undefined
  try {
    const resolvedConfig = resolveJumpserverConfigForConnect(data.configId)
    if (!resolvedConfig.success) {
      return { success: false, error: resolvedConfig.error }
    }

    const freshResult = await createJumpserverFreshToken(
      {
        baseUrl: resolvedConfig.baseUrl,
        authMode: 'access_key',
        accessKeyId: resolvedConfig.accessKeyId,
        accessKeySecret: resolvedConfig.accessKeySecret,
        verifyTls: resolvedConfig.verifyTls
      },
      data.assetId,
      data.accountId
    )
    if (!freshResult.success || !freshResult.token) {
      return { success: false, error: `创建连接令牌失败：${freshResult.error || '未知错误'}` }
    }
    freshToken = freshResult.token

    const kokoResolve = resolveKokoSshParams(
      { id: freshToken.id, value: freshToken.value },
      freshToken.clientUrl,
      resolvedConfig.baseUrl
    )
    if (!kokoResolve.success || !kokoResolve.params) {
      return { success: false, error: `解析 koko SSH endpoint 失败：${kokoResolve.error || '未知错误'}` }
    }

    const connectHosts = await resolveSshConnectHosts(kokoResolve.params.host)
    for (let index = 0; index < connectHosts.length; index += 1) {
      session = terminalSessionManager.createSession(data.tabId)
      registerSessionEvents(session)
      notifyConnecting(session)
      session.sessionMeta = {
        source: 'jumpserver',
        displayName: data.assetName,
        displaySecondary: data.accountName
      }

      try {
        await session.connect({
          host: connectHosts[index],
          port: kokoResolve.params.port,
          username: kokoResolve.params.username,
          password: kokoResolve.params.password
        })
        break
      } catch (err) {
        if (index === connectHosts.length - 1) {
          if (session && terminalSessionManager.getSession(data.tabId) === session) {
            terminalSessionManager.removeSession(data.tabId)
          }
          return {
            success: false,
            generation: session?.generation,
            error: formatKokoConnectError(err)
          }
        }
      }
    }

    if (!session) {
      return { success: false, error: 'koko SSH 连接失败：未获取到可用的连接地址' }
    }

    try {
      await session.openShell(data.cols, data.rows)
    } catch (err) {
      if (terminalSessionManager.getSession(data.tabId) === session) {
        terminalSessionManager.removeSession(data.tabId)
      }
      return {
        success: false,
        generation: session.generation,
        error: `打开终端 shell 失败：${translateError(err, 'ssh')}`
      }
    }

    return { success: true, generation: session.generation }
  } catch (err: unknown) {
    return { success: false, generation: session?.generation, error: translateError(err, 'ssh') }
  } finally {
    if (freshToken) {
      freshToken.value = ''
      freshToken = undefined
    }
  }
}

export function registerTerminalIpc(): void {
  ipcMain.handle(
    'terminal:connect',
    async (
      _event,
      data: { tabId: string; hostId: string; cols: number; rows: number }
    ): Promise<TerminalConnectResult> => connectDirectTerminal(data)
  )

  ipcMain.handle(
    'terminal:respondHostTrust',
    (_event, data: unknown): { success: boolean; error?: string } => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { success: false, error: '主机信任响应无效' }
      }
      const response = data as Partial<SshHostTrustResponse>
      if (
        typeof response.tabId !== 'string' ||
        !response.tabId ||
        typeof response.generation !== 'number' ||
        !Number.isSafeInteger(response.generation) ||
        typeof response.requestId !== 'string' ||
        !response.requestId ||
        !['trust-once', 'trust-always', 'reject'].includes(response.decision || '')
      ) {
        return { success: false, error: '主机信任响应无效' }
      }
      const session = terminalSessionManager.getSession(response.tabId)
      if (!session || session.generation !== response.generation) {
        return { success: false, error: '主机信任请求已失效' }
      }
      return session.respondHostTrust(response as SshHostTrustResponse)
    }
  )

  ipcMain.handle('terminal:resetHostTrust', (_event, hostId: unknown): { success: boolean; error?: string } => {
    if (typeof hostId !== 'string' || !hostId) return { success: false, error: '主机标识无效' }
    const rawHosts = getStore().get('hosts_list')
    const hosts: HostRecord[] = Array.isArray(rawHosts) ? (rawHosts as HostRecord[]) : []
    const host = hosts.find((item) => item.id === hostId)
    if (!host) return { success: false, error: '未找到主机' }
    resetSshHostTrustRecord(host.host, host.port)
    return { success: true }
  })

  // ===== Jumpserver 终端连接入口（v4.3：经 koko SSH 令牌直连）=====
  // 路线：旧 tokenId 查上下文 → 现连现创 fresh 令牌 → resolveKokoSshParams 组装 koko SSH 参数
  //       → 复用 ssh2 TerminalSession.connect() + openShell()
  // 不再依赖 /exchange/ 做直连判断（exchangeJumpserverConnectionToken 函数本体保留不删）
  ipcMain.handle(
    'terminal:connectJumpserver',
    async (
      _event,
      data: { tabId: string; cols: number; rows: number; tokenId: string; clientUrl: string; assetName: string; accountName?: string }
    ): Promise<TerminalConnectResult> => {
      const context = getJumpserverConnectContext(data.tokenId)
      if (!context) {
        return { success: false, error: '连接上下文缺失，请重新选择资产与账号' }
      }
      const target = {
        kind: 'jumpserver' as const,
        configId: context.configId,
        assetId: context.assetId,
        accountId: context.accountId,
        assetName: data.assetName,
        ...(data.accountName ? { accountName: data.accountName } : {})
      }
      forwardToRenderer('terminal:onReconnectTarget', { tabId: data.tabId, target })
      return connectJumpserverTerminal({ tabId: data.tabId, cols: data.cols, rows: data.rows, ...target })
    }
  )

  ipcMain.handle(
    'terminal:reconnect',
    async (
      _event,
      data: { tabId?: unknown; target?: unknown; cols?: unknown; rows?: unknown }
    ): Promise<TerminalConnectResult> => {
      if (
        typeof data.tabId !== 'string' ||
        !data.tabId ||
        typeof data.cols !== 'number' ||
        !Number.isFinite(data.cols) ||
        data.cols < 1 ||
        typeof data.rows !== 'number' ||
        !Number.isFinite(data.rows) ||
        data.rows < 1
      ) {
        return { success: false, error: '重连参数无效' }
      }

      const target = normalizeReconnectTarget(data.target)
      if (!target) return { success: false, error: '没有可用的重连目标' }

      if (target.kind === 'direct') {
        return connectDirectTerminal({
          tabId: data.tabId,
          hostId: target.hostId,
          cols: data.cols,
          rows: data.rows
        })
      }
      if (target.kind === 'jumpserver') {
        return connectJumpserverTerminal({
          tabId: data.tabId,
          cols: data.cols,
          rows: data.rows,
          ...target
        })
      }

      return { success: false, error: '本地终端请启动新的 shell' }
    }
  )

  // ===== 本地终端连接入口 =====
  ipcMain.handle(
    'terminal:connectLocal',
    async (
      _event,
      data: { tabId: string; cols: number; rows: number }
    ): Promise<{ success: boolean; generation?: number; error?: string }> => {
      let session: LocalPtySession | undefined
      try {
        const shell = getPlatformShell()
        const displayName = getPlatformDisplayName()

        session = createLocalSession(data.tabId)
        registerLocalSessionEvents(session)
        notifyLocalConnecting(session)

        session.sessionMeta = {
          source: 'local',
          displayName
        }

        await session.connect(shell, data.cols, data.rows)

        return { success: true, generation: session.generation }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '启动本地终端失败'
        return { success: false, generation: session?.generation, error: message }
      }
    }
  )

  // P2-1：write 改 handle 拿到 ack，避免 renderer 端高频按键时 send 调用堆积。
  // 异常路径显式返回 error 字符串，让 renderer 可以感知。
  ipcMain.handle('terminal:write', (_event, data: { tabId: string; data: string }) => {
    try {
      // 优先查 SSH 会话，再查本地会话
      const sshSession = terminalSessionManager.getSession(data.tabId)
      if (sshSession) {
        sshSession.write(data.data)
        return { success: true }
      }
      const localSession = getLocalSession(data.tabId)
      if (localSession) {
        localSession.write(data.data)
        return { success: true }
      }
      return { success: false, error: 'no session' }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('terminal:resize', (_event, tabId: string, cols: number, rows: number) => {
    try {
      const sshSession = terminalSessionManager.getSession(tabId)
      if (sshSession) {
        sshSession.resize(cols, rows)
        return
      }
      const localSession = getLocalSession(tabId)
      if (localSession) {
        localSession.resize(cols, rows)
      }
    } catch (err) {
      console.error('terminal:resize error', err)
    }
  })

  ipcMain.handle('terminal:disconnect', (_event, tabId: string) => {
    try {
      // 同时检查 SSH 会话和本地会话
      if (terminalSessionManager.hasSession(tabId)) {
        terminalSessionManager.removeSession(tabId)
      } else {
        removeLocalSession(tabId)
      }
    } catch (err) {
      console.error('terminal:disconnect error', err)
    }
    return { success: true }
  })

  ipcMain.handle('terminal:getRecentOutput', (_event, tabId: string, lines: number) => {
    const sshSession = terminalSessionManager.getSession(tabId)
    if (sshSession) {
      return sshSession.getRecentOutput(lines || 200)
    }
    const localSession = getLocalSession(tabId)
    if (localSession) {
      return localSession.getRecentOutput(lines || 200)
    }
    return ''
  })

  ipcMain.handle('terminal:getCurrentHost', (_event, tabId: string) => {
    const session = terminalSessionManager.getSession(tabId)
    if (session) {
      return session.currentHost || null
    }
    // 本地会话返回 null
    return null
  })

  ipcMain.handle('terminal:isConnected', (_event, tabId: string) => {
    const sshSession = terminalSessionManager.getSession(tabId)
    if (sshSession) return sshSession.connected
    const localSession = getLocalSession(tabId)
    return localSession?.connected ?? false
  })
}
