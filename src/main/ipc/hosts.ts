import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getStore } from '../services/store'
import { storeSecret, getSecret, deleteSecret } from '../services/secretVault'
import { v4 as uuidv4 } from 'uuid'
import { basename } from 'node:path'

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
}
