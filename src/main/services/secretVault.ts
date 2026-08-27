import { safeStorage } from 'electron'
import { getStore } from './store'

const ENCRYPTED_PREFIX = '__encrypted__'

export function initSecretVault(): void {
  // P2-2：safeStorage 不可用时不再静默降级，记录强警告让用户从启动日志/UI 立刻知情。
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(
      '[secretVault] safeStorage 加密不可用。后续 storeSecret 调用会拒绝写入（throw），' +
        '避免凭据以明文落盘。请检查系统钥匙串/凭据管理器是否被禁用。'
    )
  }
}

function isEncryptionReady(): boolean {
  return safeStorage.isEncryptionAvailable()
}

function encrypt(value: string): string {
  if (!isEncryptionReady()) {
    // P2-2：拒绝静默降级。调用方应先校验 isEncryptionAvailable 再调用 storeSecret。
    throw new Error(
      'safeStorage 加密不可用，已拒绝明文落盘。请在「设置」检查系统钥匙串/凭据管理器是否被禁用。'
    )
  }
  const buf = safeStorage.encryptString(value)
  return ENCRYPTED_PREFIX + buf.toString('base64')
}

function decrypt(value: string): string {
  if (value.startsWith(ENCRYPTED_PREFIX) && safeStorage.isEncryptionAvailable()) {
    try {
      const buf = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64')
      return safeStorage.decryptString(buf)
    } catch {
      return value
    }
  }
  return value
}

export function canStoreSecrets(): boolean {
  return isEncryptionReady()
}

export function storeSecret(key: string, value: string): void {
  const s = getStore()
  s.set(key, encrypt(value))
}

export function getSecret(key: string): string | undefined {
  const s = getStore()
  const raw = s.get(key) as string | undefined
  if (!raw) return undefined
  return decrypt(raw)
}

export function deleteSecret(key: string): void {
  const s = getStore()
  s.delete(key)
}
