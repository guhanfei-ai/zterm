import { ipcMain } from 'electron'
import { getStore } from '../services/store'
import { storeSecret, getSecret, deleteSecret } from '../services/secretVault'
import { v4 as uuidv4 } from 'uuid'

export interface KeyRecord {
  id: string
  name: string
  type: 'ssh-private-key'
  privateKey: string
  passphrase?: string
  createdAt: string
  updatedAt: string
}

const KEYS_KEY = 'keys_list'

function getAllKeys(): KeyRecord[] {
  const raw = getStore().get(KEYS_KEY)
  return Array.isArray(raw) ? (raw as KeyRecord[]) : []
}

function saveAllKeys(keys: KeyRecord[]): void {
  getStore().set(KEYS_KEY, keys)
}

export function registerKeysIpc(): void {
  ipcMain.handle('keys:list', () => {
    const keys = getAllKeys()
    // Return without private key content in list (for security)
    return keys.map((k) => ({
      ...k,
      privateKey: k.privateKey ? '••••••••' : '',
      passphrase: undefined
    }))
  })

  ipcMain.handle('keys:get', (_event, id: string) => {
    const keys = getAllKeys()
    const key = keys.find((k) => k.id === id)
    if (!key) return null

    // Decrypt from store
    const storedKey = getSecret(`key_pk_${id}`)
    const storedPass = getSecret(`key_pp_${id}`)

    return {
      ...key,
      privateKey: storedKey || key.privateKey,
      passphrase: storedPass || key.passphrase
    }
  })

  ipcMain.handle(
    'keys:create',
    (
      _event,
      data: { name: string; privateKey: string; passphrase?: string }
    ): KeyRecord => {
      const keys = getAllKeys()
      const now = new Date().toISOString()
      const id = uuidv4()

      // Store sensitive data ONLY in encrypted storage, never in plain list
      storeSecret(`key_pk_${id}`, data.privateKey)
      if (data.passphrase) {
        storeSecret(`key_pp_${id}`, data.passphrase)
      }

      // Plain record never stores private key or passphrase
      const record: KeyRecord = {
        id,
        name: data.name,
        type: 'ssh-private-key',
        privateKey: '',
        passphrase: undefined,
        createdAt: now,
        updatedAt: now
      }

      keys.push(record)
      saveAllKeys(keys)
      return record
    }
  )

  ipcMain.handle(
    'keys:update',
    (
      _event,
      id: string,
      data: { name?: string; privateKey?: string; passphrase?: string }
    ): KeyRecord | null => {
      const keys = getAllKeys()
      const idx = keys.findIndex((k) => k.id === id)
      if (idx === -1) return null

      const existing = keys[idx]
      const updated: KeyRecord = {
        ...existing,
        name: data.name ?? existing.name,
        // Never store privateKey or passphrase in plain list
        privateKey: '',
        passphrase: undefined,
        updatedAt: new Date().toISOString()
      }

      // Store sensitive data ONLY in encrypted storage
      if (data.privateKey !== undefined && data.privateKey.trim()) {
        storeSecret(`key_pk_${id}`, data.privateKey)
      }
      if (data.passphrase !== undefined) {
        if (data.passphrase) {
          storeSecret(`key_pp_${id}`, data.passphrase)
        } else {
          deleteSecret(`key_pp_${id}`)
        }
      }

      keys[idx] = updated
      saveAllKeys(keys)
      return updated
    }
  )

  ipcMain.handle('keys:delete', (_event, id: string): boolean => {
    let keys = getAllKeys()
    const before = keys.length
    keys = keys.filter((k) => k.id !== id)

    if (keys.length < before) {
      saveAllKeys(keys)
      deleteSecret(`key_pk_${id}`)
      deleteSecret(`key_pp_${id}`)
      return true
    }
    return false
  })
}
