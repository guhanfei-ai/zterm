import { registerIpcHandler, confirmSecretDisclosure } from '../services/ipcSecurity'
import { dialog, BrowserWindow } from 'electron'
import { getStore } from '../services/store'
import { storeSecret, getSecret, deleteSecret } from '../services/secretVault'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { writeFileSync } from 'node:fs'
import { serializeSshConfig } from '../services/sshConfigFile'

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
  registerIpcHandler('hosts:list', () => {
    const hosts = getAllHosts()
    // Return without sensitive data
    return hosts.map((h) => ({
      ...h,
      password: undefined,
      privateKeyFilePassphrase: undefined
    }))
  })

  registerIpcHandler('hosts:get', async (event, id: string) => {
    const hosts = getAllHosts()
    const host = hosts.find((h) => h.id === id)
    if (!host) return null
    if (host.authType === 'password' || host.authType === 'privateKeyFile') {
      if (!await confirmSecretDisclosure(event, '主机密码或私钥口令')) {
        return { ...host, password: undefined, privateKeyFilePassphrase: undefined }
      }
    }

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

  registerIpcHandler('hosts:pickPrivateKeyFile', async () => {
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

  registerIpcHandler(
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
        id: randomUUID(),
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

  registerIpcHandler(
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
      const targetChanged = (data.host !== undefined && data.host !== existing.host) ||
        (data.port !== undefined && data.port !== existing.port) ||
        (data.username !== undefined && data.username !== existing.username)
      // 已有密码不能随端点修改静默转送到另一台服务器。
      if (targetChanged && existing.authType === 'password' && !data.password?.trim()) {
        throw new Error('连接目标已变更，请重新填写该目标的密码')
      }
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

  registerIpcHandler('hosts:delete', (_event, id: string): boolean => {
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

  // ===== OpenSSH config 导出 =====

  function getTargetWindow(): BrowserWindow | undefined {
    return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  }

  registerIpcHandler(
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
