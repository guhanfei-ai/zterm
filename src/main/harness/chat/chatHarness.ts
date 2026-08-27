import type { ModelStreamChunk } from '../../model/contracts'
import { projectChatModelRequest, type ChatProjectionMessage } from '../../projection/chat/chatModelProjection'
import { AiClient } from '../../services/aiClient'
import { ModelStreamSession } from '../modelStreamSession'

export interface ChatStreamEvent extends ModelStreamChunk {
  chatTabId: string
  sessionId: string
}

export interface RunChatCommand {
  chatTabId: string
  messages: ChatProjectionMessage[]
  terminalOutput?: string
  onEvent: (event: ChatStreamEvent) => void
}

/** 普通聊天的一次 AI 任务执行生命周期：投影、流式、取消与会话隔离。 */
export class ChatHarness {
  private readonly sessions = new Map<string, ModelStreamSession>()

  constructor(private readonly aiClient: AiClient) {}

  async run(command: RunChatCommand): Promise<void> {
    const request = projectChatModelRequest({
      messages: command.messages,
      terminalOutput: command.terminalOutput
    })
    const session = this.createSession(command.chatTabId)
    try {
      await this.aiClient.sendStream(request, session, (chunk) => {
        command.onEvent({
          ...chunk,
          chatTabId: command.chatTabId,
          sessionId: session.sessionId
        })
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '对话流式传输错误'
      command.onEvent({
        done: true,
        error: message,
        chatTabId: command.chatTabId,
        sessionId: session.sessionId
      })
    } finally {
      this.removeSession(command.chatTabId, session)
    }
  }

  abort(chatTabId: string): void {
    this.sessions.get(chatTabId)?.abort()
  }

  private createSession(chatTabId: string): ModelStreamSession {
    this.abort(chatTabId)
    const session = new ModelStreamSession(`chat-${chatTabId}-${Date.now()}`)
    this.sessions.set(chatTabId, session)
    return session
  }

  private removeSession(chatTabId: string, session: ModelStreamSession): void {
    if (this.sessions.get(chatTabId) === session) {
      this.sessions.delete(chatTabId)
    }
  }
}
