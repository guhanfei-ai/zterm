import { Annotation } from '@langchain/langgraph'
import { SafetyCheck } from './safetyGuard'

// ---- Step record kept in graph state (serializable) ----
export interface StepRecord {
  stepNumber: number
  plan: string
  command?: string
  commandOutput?: string
  observation: string
  safetyCheck?: SafetyCheck
  status: 'pending' | 'executing' | 'done' | 'blocked' | 'skipped'
  startedAt?: string
  duration?: number
}

// ---- One turn in the Agent's conversation history ----
// 持久化到 agentContextStore，让"重启后继续追问"能找回上文。
// 2026-09-16 对话优先重构：新增 tool 角色 —— 命令输出 / 拦截反馈作为
// 工具回合进对话，conversationHistory 成为 reply 主循环的上下文主轴。
export interface ChatTurn {
  role: 'user' | 'assistant' | 'tool'
  content: string
  // tool 角色的来源命令（用户/助手角色无意义）
  command?: string
  // 标记这条发言是否触发了真实命令执行（仅 assistant 侧有意义）。
  // true 时是执行结果自然回复，false 时是纯聊天。
  isFromExecution?: boolean
  createdAt: string
}

export interface KeyOutput {
  stepNumber: number
  command?: string
  output: string
}

// ---- Parsed model response ----
export interface ParsedModelResponse {
  plan?: string
  command?: string
  observation?: string
  done?: boolean
}

// ---- One queued command from a reply turn (reply 可一次出多条命令) ----
export interface PendingCommand {
  plan?: string
  command: string
}

// ---- System probe info ----
export interface SystemInfo {
  kernel: string
  distroName: string
  distroVersion: string
  packageManager: string
  rawOutput: string
}

// ---- Node execution phase (for UI state mapping) ----
export type GraphPhase =
  | 'idle'
  | 'probing'
  | 'planning'
  | 'safety_check'
  | 'executing'
  | 'observing'
  | 'summarizing'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'stepLimitReached'

// ---- Stop reason ----
export type StopReason = 'ROUND_LIMIT' | 'USER_INTERRUPT' | 'ERROR' | 'COMPLETED' | null

/**
 * LangGraph Annotation for the Agent graph state.
 * Uses default "last value wins" reducers for all fields.
 */
export const AgentStateAnnotation = Annotation.Root({
  // ---- Task identity ----
  taskId: Annotation<string>(),
  taskDescription: Annotation<string>(),
  // 当前轮用户发言。taskDescription 是稳定任务目标，二者不能混用。
  userMessage: Annotation<string>(),
  chatTabId: Annotation<string>(),

  // ---- Step tracking ----
  currentStep: Annotation<number>(),
  maxSteps: Annotation<number>(),

  // ---- Current step data ----
  planText: Annotation<string>(),
  pendingCommand: Annotation<string>(),
  // reply 一次规划出的命令队列；pendingCommand 是队列中正在处理的第一条。
  // 每条命令独立走安全检查/执行，消耗一个步号；拦截时队列整体作废。
  pendingCommands: Annotation<PendingCommand[]>(),
  commandOutput: Annotation<string>(),
  observation: Annotation<string>(),
  safetyResult: Annotation<SafetyCheck | null>(),

  // ---- System info ----
  systemDetected: Annotation<boolean>(),
  systemInfo: Annotation<SystemInfo>(),

  // ---- Completed steps history ----
  steps: Annotation<StepRecord[]>(),

  // 本轮 turn 开始时已存在的业务步骤数（stepNumber > 0）。
  // startTask 时由 restoredState.steps 推导：新任务为 0，follow-up 为旧任务的步骤数。
  // 用途一：reply 收尾时区分"本轮执行过命令 → completed（最终回复即结论）"
  // 与"纯聊天 → idle"（旧 checkpoint 缺字段时按 0 安全降级）。
  // 用途二：单轮预算基准 —— maxSteps 是"一次人类介入后无人值守下最多执行的命令轮数"，
  // 本轮已执行轮数 = steps 业务步数 - turnStartStepCount；人类每次介入时基准重算，
  // 预算即从零重记（见 agentGraph.turnBudgetExhausted）。
  turnStartStepCount: Annotation<number>(),

  // ---- Natural conversation history (user/assistant/tool turns) ----
  // 区别于 steps：steps 只记"执行步骤"（审计用），conversationHistory 记
  // 用户 / 助手 / 工具三种回合，是 reply 主循环的上下文主轴。
  conversationHistory: Annotation<ChatTurn[]>(),
  recentKeyOutputs: Annotation<KeyOutput[]>(),

  // ---- Lifecycle ----
  aborted: Annotation<boolean>(),
  phase: Annotation<GraphPhase>(),
  stopReason: Annotation<StopReason>(),

  // ---- Configuration ----
  allowWrite: Annotation<boolean>(),
  boundHost: Annotation<string>(),

  // ---- Conclusion ----
  conclusion: Annotation<string>(),

  // ---- Model response text (raw) ----
  modelResponseText: Annotation<string>(),

  // ---- Error ----
  error: Annotation<string>()
})

/** Inferred type from the annotation */
export type AgentGraphState = typeof AgentStateAnnotation.State

/** Update type — partial state returned by nodes */
export type AgentGraphUpdate = typeof AgentStateAnnotation.Update

/** Create a blank initial state */
export function createInitialState(): AgentGraphState {
  return {
    taskId: '',
    taskDescription: '',
    userMessage: '',
    chatTabId: '',
    currentStep: 0,
    maxSteps: 25,
    planText: '',
    pendingCommand: '',
    pendingCommands: [],
    commandOutput: '',
    observation: '',
    safetyResult: null,
    systemDetected: false,
    systemInfo: { kernel: '', distroName: '', distroVersion: '', packageManager: '', rawOutput: '' },
    steps: [],
    turnStartStepCount: 0,
    conversationHistory: [],
    recentKeyOutputs: [],
    aborted: false,
    phase: 'idle',
    stopReason: null,
    allowWrite: false,
    boundHost: '',
    conclusion: '',
    modelResponseText: '',
    error: ''
  }
}
