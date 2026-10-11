export interface ProviderConfig {
  providerType: 'openai-compatible'
  label: string
  baseUrl: string
  apiKey: string
  model: string
  enableStreaming: boolean
  reasoningMode: 'auto'
  contextWindow?: number
  maxOutputTokens?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  reasoning?: string
  status?: 'streaming' | 'done' | 'error'
  createdAt: string
  // 历史总结消息的读取标记；正文使用统一助手卡片显示。
  isAgentConclusion?: boolean
  // Agent 自然聊天回复。
  isAgentNaturalReply?: boolean
  // Agent 模式下的用户发言（与 isAgentNaturalReply 对称）。
  // 必须显式标记，否则 chat 模式过滤与 resetAgent 都会漏掉它。
  isAgentUserTurn?: boolean
  // Agent 执行卡片（plan/execution/observation/thinking/error/status）。
  // 与 chat/natural/conclusion 一起进入同一条 tab.messages 时间线。
  isAgentCard?: boolean
  // Agent 卡片的具体子类型（沿用 AgentMessage['type']）
  agentCardType?: 'plan' | 'execution' | 'observation' | 'thinking' | 'error' | 'status'
  // 卡片可选：stepNumber / details / thinkingId / streaming
  stepNumber?: number
  // 卡片可选：details（reasoning/running/duration 等）
  details?: Record<string, unknown>
  // 思考块流式状态
  streaming?: boolean
  collapsed?: boolean
  // 思考块身份（用于在流式更新时去重）
  thinkingId?: string
}

export interface StreamChunk {
  text?: string
  reasoning?: string
  done: boolean
  error?: string
}
