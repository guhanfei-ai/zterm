import type { ProviderConfig } from '../../model/contracts'
import { AiClient } from '../../services/aiClient'
import { getSecret, storeSecret } from '../../services/secretVault'
import { getStore } from '../../services/store'

const PROVIDER_KEY = 'provider_config'
const PROVIDER_SECRET_KEY = 'provider_api_key'

/** 业务逻辑层：Provider 设置的读取、保存、模型选择和校验。 */
export class ProviderSettingsApplication {
  constructor(private readonly aiClient: AiClient) {}

  initialize(): void {
    const config = this.getProviderConfig()
    if (config) this.aiClient.configure(config)
  }

  getPublicProviderConfig(): (ProviderConfig & { hasApiKey: boolean }) | null {
    const raw = getStore().get(PROVIDER_KEY)
    if (!raw || typeof raw !== 'object') return null
    return { ...(raw as ProviderConfig), apiKey: '', hasApiKey: Boolean(getStore().get(PROVIDER_SECRET_KEY)) }
  }

  revealApiKey(): string | null {
    return getSecret(PROVIDER_SECRET_KEY) || null
  }

  private canReuseSavedKey(baseUrl: string): boolean {
    const raw = getStore().get(PROVIDER_KEY) as ProviderConfig | undefined
    return Boolean(raw && typeof baseUrl === 'string' &&
      baseUrl.trim().replace(/\/+$/, '') === raw.baseUrl?.trim().replace(/\/+$/, ''))
  }

  getProviderConfig(): ProviderConfig | null {
    const raw = getStore().get(PROVIDER_KEY)
    if (!raw || typeof raw !== 'object') return null

    const config = { ...(raw as ProviderConfig) }
    const apiKey = getSecret(PROVIDER_SECRET_KEY)
    if (apiKey) config.apiKey = apiKey
    return config
  }

  saveProviderConfig(config: Omit<ProviderConfig, 'providerType'>): { success: boolean; error?: string } {
    if (!config?.baseUrl || !config.model?.trim()) return { success: false, error: '缺少服务地址或模型' }
    if (config.contextWindow !== undefined && (!Number.isSafeInteger(config.contextWindow) || config.contextWindow < 8192 || config.contextWindow > 2_000_000)) return { success: false, error: '上下文窗口必须介于 8192 和 2000000' }
    if (config.maxOutputTokens !== undefined && (!Number.isSafeInteger(config.maxOutputTokens) || config.maxOutputTokens < 256 || config.maxOutputTokens > (config.contextWindow ?? 32768) / 2)) return { success: false, error: '输出上限必须介于 256 和上下文窗口的一半' }
    const fullConfig: ProviderConfig = { ...config, providerType: 'openai-compatible' }
    let apiKey = config.apiKey

    if (!apiKey?.trim()) {
      if (!this.canReuseSavedKey(config.baseUrl)) return { success: false, error: '服务地址已变更，请重新填写密钥，不能把已有凭据自动发送到新地址' }
      apiKey = getSecret(PROVIDER_SECRET_KEY) || ''
      if (!apiKey) return { success: false, error: '缺少 API Key，请填写后重试' }
    }

    storeSecret(PROVIDER_SECRET_KEY, apiKey)
    getStore().set(PROVIDER_KEY, { ...fullConfig, apiKey: '' })
    this.aiClient.configure({ ...fullConfig, apiKey })
    return { success: true }
  }

  setModel(model: string): { success: boolean; error?: string } {
    const config = this.getProviderConfig()
    if (!config) return { success: false, error: '模型未配置' }

    const updated = { ...config, model, providerType: 'openai-compatible' as const }
    getStore().set(PROVIDER_KEY, { ...updated, apiKey: '' })
    this.aiClient.configure(updated)
    return { success: true }
  }

  async validateProviderConfig(config: ProviderConfig): Promise<{ valid: boolean; error?: string }> {
    if (!config.apiKey?.trim() && !this.canReuseSavedKey(config.baseUrl)) return { valid: false, error: '服务地址已变更，请填写该服务对应的密钥后测试' }
    const apiKey = config.apiKey?.trim() ? config.apiKey : getSecret(PROVIDER_SECRET_KEY) || ''
    return this.aiClient.validateConfig({ ...config, apiKey })
  }
}
