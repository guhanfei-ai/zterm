export interface ProviderConfig {
  providerType: 'openai-compatible'
  label: string
  baseUrl: string
  apiKey: string
  model: string
  enableStreaming: boolean
  reasoningMode: 'auto'
}

/** 传给具体模型协议适配器的通用消息。 */
export interface ModelMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** 模型接入层只接受已完成投影的通用请求，不感知终端、主机或任务领域对象。 */
export interface ModelRequest {
  messages: ModelMessage[]
}

export interface ModelStreamChunk {
  text?: string
  reasoning?: string
  done: boolean
  error?: string
}

export interface ModelResult {
  text: string
  reasoning: string
}

export interface ModelCapabilities {
  streaming: boolean
  reasoning: boolean
}
