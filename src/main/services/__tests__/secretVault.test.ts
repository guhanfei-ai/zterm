import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ available: true, backend: 'gnome_libsecret', decryptFails: false, values: new Map<string, string>() }))
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => state.available,
  getSelectedStorageBackend: () => state.backend,
  encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => { if (state.decryptFails) throw new Error('unavailable'); return value.toString() },
} }))
vi.mock('../store', () => ({ getStore: () => ({
  get: (key: string) => state.values.get(key), set: (key: string, value: string) => state.values.set(key, value),
  delete: (key: string) => state.values.delete(key),
}) }))
import { canStoreSecrets, getSecret, storeSecret } from '../secretVault'
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => { state.available = true; state.backend = 'gnome_libsecret'; state.decryptFails = false; state.values.clear() })
afterEach(() => Object.defineProperty(process, 'platform', platform))
describe('凭据存储拒绝降级', () => {
  it('Linux basic_text 后端不得保存凭据', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    state.backend = 'basic_text'
    expect(canStoreSecrets()).toBe(false)
    expect(() => storeSecret('test', 'synthetic')).toThrow()
    expect(state.values.size).toBe(0)
  })
  it('解密失败或钥匙串不可用时不得返回密文伪装密码', () => {
    storeSecret('test', 'synthetic')
    state.decryptFails = true
    expect(() => getSecret('test')).toThrow('解密失败')
    state.available = false
    expect(() => getSecret('test')).toThrow('安全存储不可用')
  })
  it('可用钥匙串保持往返', () => {
    storeSecret('test', 'synthetic')
    expect(getSecret('test')).toBe('synthetic')
    expect(state.values.get('test')).toMatch(/^__encrypted__/)
  })
})
