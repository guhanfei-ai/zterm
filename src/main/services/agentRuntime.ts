/**
 * AgentRuntime — engine-agnostic contract for the Agent execution layer.
 *
 * zTerm 的产品规则沉淀在 AgentController / AgentApplication / AgentGraphCallbacks
 * 三层;AgentRuntime 只负责"一轮怎么跑、怎么停、怎么释放"。现有 LangGraph 实现与
 * Pi 实现都满足本接口,通过工厂接线切换,不向 UI 扩散引擎类型。
 *
 * 详见 _tacp/20260925-015901-Codex-Pi内核迁移执行总纲.md 第 4 章。
 */
import type { TerminalBridge } from './terminalBridge'
import type { AiClient, ProviderConfig } from './aiClient'
import type { AgentGraphCallbacks } from './agentGraph'
import type {
  StepRecord,
  StopReason,
  SystemInfo,
  ChatTurn,
  KeyOutput
} from './agentGraphState'

/** 启动一轮时传给 runtime 的产品上下文(引擎无关,不含 LangGraph 特有字段)。 */
export interface AgentRuntimeStartOptions {
  allowWrite?: boolean
  boundHost?: string
  conversationHistory?: ChatTurn[]
  userMessage?: string
  taskId?: string
  recentKeyOutputs?: KeyOutput[]
  restoredState?: AgentRuntimeRestoredState
  /**
   * 会话策略(R05):
   * - 'reuse':追问 —— 沿用同 tab 的引擎会话,模型上下文跨轮保留;
   * - 'rebuild':新任务/恢复 —— 重建会话并按 conversationHistory 导入历史。
   */
  sessionPolicy?: 'reuse' | 'rebuild'
}

/** 跨重启恢复时回灌给 runtime 的状态快照。 */
export interface AgentRuntimeRestoredState {
  currentStep: number
  steps: StepRecord[]
  systemDetected: boolean
  systemInfo?: SystemInfo
  recentKeyOutputs?: KeyOutput[]
  stopReason: StopReason
  /**
   * 引擎特定的阶段标记。LangGraph 用 GraphPhase,Pi 忽略。
   * 类型为 string 以保持接口引擎无关;各实现自行解读。
   */
  phase?: string
}

/**
 * 每 chatTabId 隔离的 Agent 执行体契约。
 *
 * - startTask / continueTask 采用同步点火语义:发起级错误同步 throw,
 *   执行期错误通过 callbacks 走事件流(与 AgentController 既有契约对齐)。
 * - stop 后禁止续跑复活已中止的轮次(各实现用 stopped 标志或等价机制保证)。
 */
export interface AgentRuntime {
  /**
   * 启动新一轮。reinit tab(新 AbortController / 新会话),后台点火,不阻塞调用方。
   * options.restoredState 非空时按恢复语义起算(预算基准 = 已有业务步骤数)。
   */
  startTask(
    chatTabId: string,
    taskDescription: string,
    maxSteps: number,
    bridge: TerminalBridge | null,
    callbacks: AgentGraphCallbacks,
    options?: AgentRuntimeStartOptions
  ): Promise<void>

  /**
   * 续跑(stepLimitReached 路径):重置本轮预算基准,从上一轮收尾处继续。
   * H02/H03:bridge 是 Controller 当前持有的有效绑定;conversationHistory
   * 是重建会话时的历史来源(持久化权威);I03:taskDescription 在长会话
   * 重建时补入被裁剪窗口挤出的原始目标。
   */
  continueTask(
    chatTabId: string,
    additionalSteps: number,
    options?: { bridge?: TerminalBridge; conversationHistory?: ChatTurn[]; taskDescription?: string; allowWrite?: boolean }
  ): Promise<void>

  /** 停止指定 tab:取消模型请求并禁止后续命令下发。 */
  stop(chatTabId: string): void

  isRunning(chatTabId: string): boolean
  hasTab(chatTabId: string): boolean

  /** 释放指定 tab 的全部资源(取消、销毁会话、清监听)。 */
  removeTab(chatTabId: string): void

  /** 更新 callbacks(webContents 切换时重绑事件通道)。 */
  updateCallbacks(chatTabId: string, callbacks: AgentGraphCallbacks): void

  /**
   * 运行中更新 allowWrite(总纲 6.3:运行中降为只读应影响尚未下发的后续命令)。
   * 可选方法:不支持运行中降权的实现可以不实现。
   */
  updateAllowWrite?(chatTabId: string, allowWrite: boolean): void

  /**
   * 更新模型配置(F04:配置变化进入下一轮,不在执行中的旧轮切换)。
   * 可选方法:不支持配置热更新的实现可以不实现。
   */
  updateConfig?(config: ProviderConfig): void
}

/** 迁移期引擎选择。阶段 B 默认 graph,阶段 E 切换为 pi。 */
export type AgentEngine = 'pi' | 'graph'

/**
 * 读取引擎选择。优先环境变量 ZTERM_AGENT_ENGINE,其次 storeGet 回调,
 * 最后回退默认值。不向用户暴露"多引擎选型"界面(总纲 7.7)。
 */
export function readAgentEnginePreference(
  storeGet?: (key: string) => unknown
): AgentEngine {
  const env = process.env.ZTERM_AGENT_ENGINE
  if (env === 'pi' || env === 'graph') return env
  if (storeGet) {
    const v = storeGet('agent_engine')
    if (v === 'pi' || v === 'graph') return v as AgentEngine
  }
  // 阶段 E:默认切换为 pi,旧 Graph 仅作为受控回退(总纲 7.7)。
  // 仍可通过 ZTERM_AGENT_ENGINE=graph 或 store agent_engine='graph' 回退。
  return 'pi'
}
