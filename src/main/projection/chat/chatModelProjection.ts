import { DEFAULT_SYSTEM_PROMPT } from '../../config/aiClientConfig'
import type { ModelRequest } from '../../model/contracts'

export interface ChatProjectionMessage {
  role: 'user' | 'assistant' | 'system'
  text: string
}

export interface ChatProjectionInput {
  messages: ChatProjectionMessage[]
  terminalOutput?: string
}

/** 将正式聊天事实和可选终端证据投影为模型可消费的通用请求。 */
export function projectChatModelRequest(input: ChatProjectionInput): ModelRequest {
  const messages: ModelRequest['messages'] = []

  if (input.terminalOutput) {
    messages.push({
      role: 'system',
      content: `以下是最近的终端输出，供你参考：\n\`\`\`\n${input.terminalOutput}\n\`\`\`\n\n请利用这些终端输出来更好地回答用户的问题。`
    })
  }

  messages.push({ role: 'system', content: DEFAULT_SYSTEM_PROMPT })

  for (const message of input.messages) {
    messages.push({ role: message.role, content: message.text })
  }

  return { messages }
}
