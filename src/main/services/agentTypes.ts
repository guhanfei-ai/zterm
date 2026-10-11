import type { SafetyCheck } from './safetyGuard'

/** 可序列化的终端执行记录。 */
export interface StepRecord {
  stepNumber: number
  plan: string
  command?: string
  commandOutput?: string
  /** 经终端协议验证的真实退出码；缺失表示未验证或旧历史步骤。 */
  exitCode?: number
  observation: string
  safetyCheck?: SafetyCheck
  status: 'pending' | 'executing' | 'done' | 'blocked' | 'skipped'
  startedAt?: string
  duration?: number
}

/** 用户、助手和工具回合组成跨重启的对话历史。 */
export interface ChatTurn {
  role: 'user' | 'assistant' | 'tool'
  content: string
  command?: string
  isFromExecution?: boolean
  createdAt: string
}

export type AgentState =
  | 'starting'
  | 'idle'
  | 'planning'
  | 'executing'
  | 'observing'
  | 'summarizing'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'stepLimitReached'

export type StopReason = 'ROUND_LIMIT' | 'USER_INTERRUPT' | 'ERROR' | 'COMPLETED' | null
