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

  getProviderConfig(): ProviderConfig | null {
    const raw = getStore().get(PROVIDER_KEY)
    if (!raw || typeof raw !== 'object') return null

    const config = { ...(raw as ProviderConfig) }
    const apiKey = getSecret(PROVIDER_SECRET_KEY)
    if (apiKey) config.apiKey = apiKey
    return config
  }

  saveProviderConfig(config: Omit<ProviderConfig, 'providerType'>): { success: boolean; error?: string } {
    const fullConfig: ProviderConfig = { ...config, providerType: 'openai-compatible' }
    let apiKey = config.apiKey

    if (!apiKey?.trim()) {
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
    const apiKey = config.apiKey?.trim() ? config.apiKey : getSecret(PROVIDER_SECRET_KEY) || ''
    return this.aiClient.validateConfig({ ...config, apiKey })
  }
}
