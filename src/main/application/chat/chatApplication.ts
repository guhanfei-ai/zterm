import { ChatHarness, type ChatStreamEvent } from '../../harness/chat/chatHarness'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  reasoning?: string
  status?: 'streaming' | 'done' | 'error'
  createdAt: string
}

export interface SendChatCommand {
  chatTabId: string
  messages: ChatMessage[]
  includeTerminalContext: boolean
  terminalTabId?: string
}

export interface TerminalOutputReader {
  readRecentOutput: (terminalTabId: string, lines: number) => string
}

/** 业务逻辑层：决定一次普通聊天是否取用用户明确选择的终端事实。 */
export class ChatApplication {
  constructor(
    private readonly chatHarness: ChatHarness,
    private readonly terminalOutputReader: TerminalOutputReader
  ) {}

  async send(command: SendChatCommand, onEvent: (event: ChatStreamEvent) => void): Promise<void> {
    const terminalOutput = command.includeTerminalContext && command.terminalTabId
      ? this.terminalOutputReader.readRecentOutput(command.terminalTabId, 200)
      : undefined

    await this.chatHarness.run({
      chatTabId: command.chatTabId,
      messages: command.messages,
      terminalOutput,
      onEvent
    })
  }

  abort(chatTabId: string): void {
    this.chatHarness.abort(chatTabId)
  }
}
