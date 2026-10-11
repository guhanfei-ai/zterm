/**
 * AgentRuntime — Agent 执行层的生命周期契约。
 * Pi 管理模型与工具循环；Controller / Application 管理产品状态、绑定和恢复。
 */
import type { TerminalBridge } from './terminalBridge'
import type { ProviderConfig } from './aiClient'
import type {
  AgentState,
  StepRecord,
  StopReason,
  ChatTurn
} from './agentTypes'

/** 执行体向产品层报告消息、状态和可持久化的执行结果。 */
export interface AgentRuntimeCallbacks {
  emitMessage: (msg: {
    type: string
    content: string
    stepNumber?: number
    details?: Record<string, unknown>
  }) => void
  emitStateChange: (state: AgentState) => void
  onStepComplete: (data: {
    steps: StepRecord[]
    currentStep: number
    conclusion?: string
    stopReason?: StopReason
    /** 对话轮次已自然结束；不代表执行任务成功。 */
    turnCompleted?: boolean
  }) => void
}

/** 启动一轮时传给 runtime 的产品上下文。 */
export interface AgentRuntimeStartOptions {
  allowWrite?: boolean
  boundHost?: string
  conversationHistory?: ChatTurn[]
  userMessage?: string
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
  steps: StepRecord[]
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
    callbacks: AgentRuntimeCallbacks,
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
  updateCallbacks(chatTabId: string, callbacks: AgentRuntimeCallbacks): void

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
