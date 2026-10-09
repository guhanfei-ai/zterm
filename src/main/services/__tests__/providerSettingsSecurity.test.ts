import { beforeEach, describe, expect, it, vi } from 'vitest'
const values = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../store', () => ({ getStore: () => ({ get: (k: string) => values.get(k), set: (k: string, v: unknown) => values.set(k, v) }) }))
vi.mock('../secretVault', () => ({ getSecret: () => 'synthetic-key', storeSecret: vi.fn() }))
import { ProviderSettingsApplication } from '../../application/ai/providerSettingsApplication'
import type { AiClient, ProviderConfig } from '../aiClient'
const config: ProviderConfig = { providerType: 'openai-compatible', label: 'test', baseUrl: 'https://trusted.example/v1', apiKey: '', model: 'test', enableStreaming: true, reasoningMode: 'auto' }
beforeEach(() => { values.clear(); values.set('provider_config', config); values.set('provider_api_key', '__encrypted__synthetic') })
describe('模型配置与密钥隔离', () => {
  it('配置读取只返回密钥存在状态，内部模型仍能获取凭据', () => {
    const settings = new ProviderSettingsApplication({} as AiClient)
    expect(settings.getPublicProviderConfig()).toMatchObject({ apiKey: '', hasApiKey: true })
    expect(settings.getProviderConfig()?.apiKey).toBe('synthetic-key')
  })
  it('不能借新服务地址的测试或保存外发已有凭据', async () => {
    const validateConfig = vi.fn()
    const settings = new ProviderSettingsApplication({ validateConfig } as unknown as AiClient)
    expect(await settings.validateProviderConfig({ ...config, baseUrl: 'https://attacker.invalid/v1' })).toMatchObject({ valid: false })
    expect(settings.saveProviderConfig({ ...config, baseUrl: 'https://attacker.invalid/v1' })).toMatchObject({ success: false })
    expect(validateConfig).not.toHaveBeenCalled()
  })
  it('同一服务可复用密钥，新服务必须显式提供自己的密钥', async () => {
    const validateConfig = vi.fn(async () => ({ valid: true }))
    const configure = vi.fn()
    const settings = new ProviderSettingsApplication({ validateConfig, configure } as unknown as AiClient)
    expect(await settings.validateProviderConfig(config)).toEqual({ valid: true })
    expect(validateConfig).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'synthetic-key' }))
    expect(settings.saveProviderConfig({ ...config, contextWindow: 4096 })).toMatchObject({ success: false })
    expect(settings.saveProviderConfig({ ...config, contextWindow: 32768, maxOutputTokens: 4096 })).toEqual({ success: true })
  })
})
