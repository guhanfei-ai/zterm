import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getStore } from '../services/store'
import { storeSecret, getSecret, deleteSecret } from '../services/secretVault'
import { v4 as uuidv4 } from 'uuid'
import { basename } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseSshConfig, serializeSshConfig, type ParsedSshConfigHost } from '../services/sshConfigFile'

export type HostAuthType = 'password' | 'key' | 'privateKeyFile'

export interface HostRecord {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: HostAuthType
  password?: string
  keyId?: string
  privateKeyFilePath?: string
  privateKeyFileName?: string
  privateKeyFilePassphrase?: string
  description?: string
  createdAt: string
  updatedAt: string
}

const HOSTS_KEY = 'hosts_list'
const hostPasswordSecretKey = (id: string): string => `host_pwd_${id}`
const hostPrivateKeyFilePassphraseSecretKey = (id: string): string => `host_pkf_pp_${id}`

function getAllHosts(): HostRecord[] {
  const raw = getStore().get(HOSTS_KEY)
  return Array.isArray(raw) ? (raw as HostRecord[]) : []
}

function saveAllHosts(hosts: HostRecord[]): void {
  getStore().set(HOSTS_KEY, hosts)
}

export function registerHostsIpc(): void {
  ipcMain.handle('hosts:list', () => {
    const hosts = getAllHosts()
    // Return without sensitive data
    return hosts.map((h) => ({
      ...h,
      password: undefined,
      privateKeyFilePassphrase: undefined
    }))
  })

  ipcMain.handle('hosts:get', (_event, id: string) => {
    const hosts = getAllHosts()
    const host = hosts.find((h) => h.id === id)
    if (!host) return null

    // Decrypt password if present — 注意：不要改 store 缓存对象本身，
    // 否则后续 saveAllHosts 可能把明文 password 一起持久化。
    if (host.authType === 'password') {
      const storedPwd = getSecret(hostPasswordSecretKey(id))
      if (storedPwd) {
        return { ...host, password: storedPwd }
      }
    }

    if (host.authType === 'privateKeyFile') {
      const storedPassphrase = getSecret(hostPrivateKeyFilePassphraseSecretKey(id))
      if (storedPassphrase) {
        return { ...host, privateKeyFilePassphrase: storedPassphrase }
      }
    }

    return host
  })

  ipcMain.handle('hosts:pickPrivateKeyFile', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showOpenDialog(win, {
        title: '选择 SSH 私钥文件',
        properties: ['openFile']
      })

      if (result.canceled || !result.filePaths.length) {
        return { canceled: true }
      }

      const filePath = result.filePaths[0]
      return {
        canceled: false,
        filePath,
        fileName: basename(filePath)
      }
    } catch (err: unknown) {
      return {
        canceled: false,
        error: err instanceof Error ? err.message : '选择 SSH 私钥文件失败'
      }
    }
  })

  ipcMain.handle(
    'hosts:create',
    (
      _event,
      data: {
        name: string
        host: string
        port?: number
        username: string
        authType: HostAuthType
        password?: string
        keyId?: string
        privateKeyFilePath?: string
        privateKeyFilePassphrase?: string
        description?: string
      }
    ): HostRecord => {
      const hosts = getAllHosts()
      const now = new Date().toISOString()
      const record: HostRecord = {
        id: uuidv4(),
        name: data.name,
        host: data.host,
        port: data.port || 22,
        username: data.username,
        authType: data.authType,
        keyId: data.authType === 'key' ? data.keyId : undefined,
        privateKeyFilePath: data.authType === 'privateKeyFile' ? data.privateKeyFilePath : undefined,
        privateKeyFileName:
          data.authType === 'privateKeyFile' && data.privateKeyFilePath
            ? basename(data.privateKeyFilePath)
            : undefined,
        description: data.description,
        createdAt: now,
        updatedAt: now
      }

      // Store password encrypted
      if (data.authType === 'password' && data.password) {
        storeSecret(hostPasswordSecretKey(record.id), data.password)
      }

      if (data.authType === 'privateKeyFile' && data.privateKeyFilePassphrase) {
        storeSecret(hostPrivateKeyFilePassphraseSecretKey(record.id), data.privateKeyFilePassphrase)
      }

      hosts.push(record)
      saveAllHosts(hosts)
      return record
    }
  )

  ipcMain.handle(
    'hosts:update',
    (
      _event,
      id: string,
      data: {
        name?: string
        host?: string
        port?: number
        username?: string
        authType?: HostAuthType
        password?: string
        keyId?: string
        privateKeyFilePath?: string
        privateKeyFilePassphrase?: string
        description?: string
      }
    ): HostRecord | null => {
      const hosts = getAllHosts()
      const idx = hosts.findIndex((h) => h.id === id)
      if (idx === -1) return null

      const existing = hosts[idx]
      const nextAuthType = data.authType ?? existing.authType
      const nextPrivateKeyFilePath =
        nextAuthType === 'privateKeyFile'
          ? (data.privateKeyFilePath !== undefined ? data.privateKeyFilePath : existing.privateKeyFilePath)
          : undefined
      const updated: HostRecord = {
        ...existing,
        name: data.name ?? existing.name,
        host: data.host ?? existing.host,
        port: data.port ?? existing.port,
        username: data.username ?? existing.username,
        authType: nextAuthType,
        keyId:
          nextAuthType === 'key'
            ? (data.keyId !== undefined ? data.keyId : existing.keyId)
            : undefined,
        privateKeyFilePath: nextPrivateKeyFilePath,
        privateKeyFileName: nextPrivateKeyFilePath ? basename(nextPrivateKeyFilePath) : undefined,
        description: data.description !== undefined ? data.description : existing.description,
        updatedAt: new Date().toISOString()
      }

      if (nextAuthType === 'password' && data.password !== undefined) {
        storeSecret(hostPasswordSecretKey(id), data.password)
      } else if (nextAuthType === 'password' && data.password === undefined) {
        // editing with password auth, keeping existing password - no action needed
      }

      if (nextAuthType !== 'password') {
        deleteSecret(hostPasswordSecretKey(id))
        updated.password = undefined
      }

      if (nextAuthType !== 'privateKeyFile') {
        deleteSecret(hostPrivateKeyFilePassphraseSecretKey(id))
        updated.privateKeyFilePassphrase = undefined
      } else if (data.privateKeyFilePassphrase !== undefined && data.privateKeyFilePassphrase.trim()) {
        storeSecret(hostPrivateKeyFilePassphraseSecretKey(id), data.privateKeyFilePassphrase)
      }

      if (nextAuthType === 'password') {
        updated.keyId = undefined
        updated.privateKeyFilePath = undefined
        updated.privateKeyFileName = undefined
      } else if (nextAuthType === 'key') {
        updated.privateKeyFilePath = undefined
        updated.privateKeyFileName = undefined
      }

      hosts[idx] = updated
      saveAllHosts(hosts)
      return updated
    }
  )

  ipcMain.handle('hosts:delete', (_event, id: string): boolean => {
    let hosts = getAllHosts()
    const before = hosts.length
    hosts = hosts.filter((h) => h.id !== id)

    if (hosts.length < before) {
      saveAllHosts(hosts)
      deleteSecret(hostPasswordSecretKey(id))
      deleteSecret(hostPrivateKeyFilePassphraseSecretKey(id))
      return true
    }
    return false
  })

  // ===== OpenSSH config 导入 / 导出 =====

  function getTargetWindow(): BrowserWindow | undefined {
    return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  }

  function parseImportedHostDuplicates(parsed: ParsedSshConfigHost[]): boolean[] {
    const existing = getAllHosts()
    return parsed.map((candidate) =>
      existing.some(
        (h) => h.host === candidate.host && h.port === candidate.port && h.username === candidate.username
      )
    )
  }

  ipcMain.handle(
    'hosts:importSshConfig',
    async (): Promise<
      | { canceled: true }
      | { canceled: false; error?: string }
      | {
          canceled: false
          hosts: ParsedSshConfigHost[]
          duplicates: boolean[]
          skippedBlocks: number
          totalBlocks: number
        }
    > => {
      const win = getTargetWindow()
      if (!win) return { canceled: false, error: '找不到可用的窗口' }
      const result = await dialog.showOpenDialog(win, {
        title: '导入 OpenSSH 配置文件',
        properties: ['openFile'],
        filters: [{ name: 'SSH Config', extensions: ['conf', 'config', 'txt'] }]
      })
      if (result.canceled || !result.filePaths.length) return { canceled: true }

      let text: string
      try {
        text = readFileSync(result.filePaths[0], 'utf8')
      } catch (err: unknown) {
        return { canceled: false, error: err instanceof Error ? err.message : '读取文件失败' }
      }
      if (text.length > 4 * 1024 * 1024) {
        return { canceled: false, error: '配置文件过大（超过 4MB），请检查是否选择了正确的文件' }
      }

      const parsed = parseSshConfig(text, homedir())
      return {
        canceled: false,
        hosts: parsed.hosts,
        duplicates: parseImportedHostDuplicates(parsed.hosts),
        skippedBlocks: parsed.skippedBlocks,
        totalBlocks: parsed.totalBlocks
      }
    }
  )

  ipcMain.handle(
    'hosts:confirmImportSshConfig',
    (_event, input: unknown): { success: boolean; created?: number; error?: string } => {
      if (!Array.isArray(input) || input.length === 0 || input.length > 200) {
        return { success: false, error: '导入列表无效' }
      }
      const candidates: ParsedSshConfigHost[] = []
      for (const item of input) {
        if (!item || typeof item !== 'object') continue
        const candidate = item as Partial<ParsedSshConfigHost>
        if (
          typeof candidate.alias !== 'string' || !candidate.alias.trim() ||
          typeof candidate.host !== 'string' || !candidate.host.trim() ||
          typeof candidate.port !== 'number' ||
          typeof candidate.username !== 'string'
        ) {
          return { success: false, error: '导入项字段无效' }
        }
        candidates.push({
          alias: candidate.alias.trim().slice(0, 100),
          host: candidate.host.trim().slice(0, 255),
          port: candidate.port,
          username: candidate.username.trim().slice(0, 64),
          identityFile:
            typeof candidate.identityFile === 'string' && candidate.identityFile.trim()
              ? candidate.identityFile.trim()
              : undefined,
          ignoredKeywords: Array.isArray(candidate.ignoredKeywords)
            ? candidate.ignoredKeywords.filter((k): k is string => typeof k === 'string')
            : []
        })
      }
      if (!candidates.length) return { success: false, error: '没有可导入的主机' }

      const hosts = getAllHosts()
      const now = new Date().toISOString()
      for (const candidate of candidates) {
        const record: HostRecord = {
          id: uuidv4(),
          name: candidate.alias,
          host: candidate.host,
          port: candidate.port,
          username: candidate.username,
          authType: candidate.identityFile ? 'privateKeyFile' : 'password',
          keyId: undefined,
          privateKeyFilePath: candidate.identityFile,
          privateKeyFileName: candidate.identityFile ? basename(candidate.identityFile) : undefined,
          description: '从 OpenSSH config 导入',
          createdAt: now,
          updatedAt: now
        }
        hosts.push(record)
      }
      saveAllHosts(hosts)
      return { success: true, created: candidates.length }
    }
  )

  ipcMain.handle(
    'hosts:exportSshConfig',
    async (): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> => {
      const hosts = getAllHosts()
      if (!hosts.length) {
        return { success: false, error: '当前没有可导出的主机' }
      }
      const win = getTargetWindow()
      if (!win) return { success: false, error: '找不到可用的窗口' }

      const content = serializeSshConfig(
        hosts.map((h) => ({
          name: h.name,
          host: h.host,
          port: h.port,
          username: h.username,
          authType: h.authType,
          privateKeyFilePath: h.privateKeyFilePath
        }))
      )
      const result = await dialog.showSaveDialog(win, {
        title: '导出主机配置',
        defaultPath: 'ssh_config_zterm.conf',
        filters: [{ name: 'SSH Config', extensions: ['conf'] }]
      })
      if (result.canceled || !result.filePath) {
        return { success: true, canceled: true }
      }
      try {
        writeFileSync(result.filePath, content, 'utf8')
        return { success: true, filePath: result.filePath }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : '写入文件失败' }
      }
    }
  )
}
