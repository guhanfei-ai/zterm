/**
 * Pi 模型适配器:从 zTerm 的 ProviderConfig 构造隔离的 ModelRuntime + Model。
 *
 * R03(协议路由):注册自定义 provider,api 显式为 'openai-completions'。
 * composeModelProvider 的 streamWith 对无内置 base 的自定义 provider
 * 走 getApiProvider(model.api) —— 真实的 Chat Completions 实现
 * (pi-ai dist/api/openai-completions.js,POST {baseUrl}/chat/completions)。
 * 不复用内置 'openai' provider(它固定走 Responses API)。
 *
 * R04(初始化隔离):
 * - credentials: AuthStorage.inMemory() + setRuntimeApiKey(纯内存凭据;
 *   getAuth 优先命中 runtime 凭据,不会回落 ambient 环境变量/ADC 文件,
 *   也不读 ~/.pi/agent/auth.json、不执行其 '!' 命令型配置)
 * - modelsPath: null(禁用默认 models.json 发现)
 * - modelsStore: 内存实现(不落盘)
 * - refreshOnCreate: false + allowModelNetwork: false(不联网刷新)
 * - PI_AGENT_DIR 环境变量指向 tmp,兜底 SDK 内部 getAgentDir() 回落
 * - Settings 由调用方用 SettingsManager.inMemory() 注入(见 piAgentRuntime)
 *
 * 凭据注入方式的选择:setRuntimeApiKey 走 RuntimeCredentials(内存 map),
 * 不经过 registerProvider 的 ProviderConfigInput.apiKey(config 值解析层,
 * 支持 '!' 命令型配置——那是 R04 要封死的本机执行入口)。
 *
 * 详见 _tacp/20260925-030120 验收退回 R03/R04。
 */
import os from 'node:os'
import path from 'node:path'
import {
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import type { Model } from '@earendil-works/pi-ai'
import type { ProviderConfig } from './aiClient'

/** zTerm 专用 provider id:避免与内置 'openai'(Responses API)冲突。 */
export const ZTERM_PROVIDER_ID = 'zterm-openai-completions'

/**
 * 纯内存 CredentialStore(R04):
 * 0.87.1 不再导出 AuthStorage,自实现接口 —— 一个 provider 一条 api_key 凭据,
 * 全部留在内存,不读写任何文件,没有命令型配置解析入口。
 */
class InMemoryCredentialStore implements CredentialStore {
  private readonly entries = new Map<string, Credential>()

  async read(providerId: string): Promise<Credential | undefined> {
    return this.entries.get(providerId)
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return [...this.entries.entries()].map(([providerId, c]) => ({
      providerId,
      type: c.type,
    }))
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    const next = await fn(this.entries.get(providerId))
    if (next !== undefined) this.entries.set(providerId, next)
    return this.entries.get(providerId)
  }

  async delete(providerId: string): Promise<void> {
    this.entries.delete(providerId)
  }
}

export interface PiModelSetup {
  model: Model<'openai-completions'>
  modelRuntime: ModelRuntime
  sessionManager: SessionManager
  settingsManager: SettingsManager
  /**
   * L01:本会话的模型发送授权令牌(轮次级)—— runtime 在每次
   * prompt 前升级 allowedUid 到当前轮;隔离后不再升级。
   */
  modelAuth: { allowedUid: number | null }
}

/** 隔离目录:系统临时目录,绝不指向用户 home。 */
export const PI_SANDBOX_DIR = path.join(os.tmpdir(), 'zterm-pi-agent')

/** 确保本进程内 SDK 的 getAgentDir() 不回落到 ~/.pi/agent(兜底,幂等)。 */
export function ensurePiSandboxEnv(): void {
  if (!process.env.PI_AGENT_DIR) {
    process.env.PI_AGENT_DIR = PI_SANDBOX_DIR
  }
}

/** 构造 Chat Completions 模型对象(与注册的 provider 同 id)。 */
export function buildCompletionsModel(config: ProviderConfig): Model<'openai-completions'> {
  return {
    id: config.model,
    name: config.model,
    api: 'openai-completions',
    provider: ZTERM_PROVIDER_ID,
    baseUrl: config.baseUrl,
    reasoning: config.reasoningMode === 'auto',
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  }
}

export interface PiModelSetupOptions {
  /**
   * F05:宿主共享的内存 SettingsManager(loader 与 session 共用),
   * 传入时不再新建,保证整条初始化链只有一个内存 settings 来源。
   */
  settingsManager?: SettingsManager
  /**
   * L01:发送时读取 runtime 当前轮 uid 的回调(发送前归属校验用)。
   * 未提供时(无会话上下文的直接调用)模型发送被拒 —— fail-closed。
   */
  currentTurnUid?: () => number | null
  /**
   * L01:模型发送授权 —— 轮次级令牌(每次 prompt 绑定当前轮 uid)。
   * streamSimple 发送前校验"调用发起时 runtime 的当前轮 === 本令牌
   * 绑定的轮":旧 preflight 恢复后的发送发生在新轮占位之后(uid 不
   * 匹配)或旧会话隔离之后(令牌 uid 不再被升级)→ 发送前 fail-closed。
   * 合法新轮 prompt 时由 runtime 把本会话令牌升级到当前轮 → 正常发送。
   */
  modelAuth?: { allowedUid: number | null }
}

/**
 * 从 zTerm provider 配置构造隔离的 ModelRuntime + Model + 内存 Session/Settings。
 *
 * 每次 rebuild 调用并使用**当前** config(F04:配置变化立即进入新轮,
 * 不残留旧 Runtime 构造时的配置);reuse 由调用方按配置指纹判断。
 *
 * SessionManager.inMemory():模型会话上下文由 Pi 在内存中维护;
 * zTerm 的 agentContextStore 是唯一持久化权威(总纲 7.2 分工)。
 */
export async function buildPiModelSetup(
  config: ProviderConfig,
  options?: PiModelSetupOptions
): Promise<PiModelSetup> {
  ensurePiSandboxEnv()
  const modelAuthCurrentTurnUid = options?.currentTurnUid

  const credentials = new InMemoryCredentialStore()
  // R04:模型部分完全隔离
  const modelRuntime = await ModelRuntime.create({
    credentials,
    // modelsPath: null —— 显式禁用默认 ~/.pi/agent/models.json 发现
    modelsPath: null,
    // refreshOnCreate: false —— 不做创建时的目录/可用性刷新
    refreshOnCreate: false,
    allowModelNetwork: false,
  })

  const model = buildCompletionsModel(config)

  // L01:模型发送授权令牌(轮次级)。streamSimple 发送前校验当前轮身份:
  // - 正常飞行(发送时 runtime 当前轮 === 令牌绑定轮)→ 放行;
  // - 旧 preflight 恢复(新轮已占位,uid 不匹配)→ 发送前拒绝;
  // - 旧会话隔离(令牌 uid 永不再升级)→ 发送前拒绝。
  const auth: { allowedUid: number | null } = options?.modelAuth ?? { allowedUid: null }

  // R03:注册自定义 provider。只声明协议与模型列表,不传 apiKey
  // (apiKey 走 runtime 凭据,避免 config 值解析层的命令型配置入口)。
  // L01:注入 streamSimple 包装 —— 每次模型发送前校验轮次授权,
  // 旧 session(已隔离)的发送被拒(throw → SDK 视为模型错误,
  // 不发任何网络请求)。真实协议仍走 getApiProvider('openai-completions')。
  const { getApiProvider } = await import('@earendil-works/pi-ai/compat')
  const api = getApiProvider('openai-completions')
  if (!api) throw new Error('pi-ai 未注册 openai-completions API 实现')
  modelRuntime.registerProvider(ZTERM_PROVIDER_ID, {
    api: 'openai-completions',
    baseUrl: config.baseUrl,
    models: [buildCompletionsModel(config)],
    streamSimple: (m, context, opts) => {
      // L01:发送前归属校验 —— 当前轮必须是本会话令牌绑定的轮
      const currentUid = modelAuthCurrentTurnUid?.()
      if (auth.allowedUid == null || currentUid == null || currentUid !== auth.allowedUid) {
        throw new Error('[zterm] 会话已结束,旧轮模型请求被拒绝(发送前)')
      }
      return api.streamSimple(m, context, opts)
    },
  })

  // R04:凭据注入 runtime 层(内存,请求时 getAuth 优先命中,
  // 不回落 stored 文件或 ambient 环境变量)
  await modelRuntime.setRuntimeApiKey(ZTERM_PROVIDER_ID, config.apiKey)

  // R04/F05:Settings 全内存 —— 优先复用宿主共享实例
  const settingsManager = options?.settingsManager ?? SettingsManager.inMemory()

  // 会话上下文内存维护(历史导入见 piAgentRuntime 的 buildHistoryEntries)
  const sessionManager = SessionManager.inMemory()

  return { model, modelRuntime, sessionManager, settingsManager, modelAuth: auth }
}
