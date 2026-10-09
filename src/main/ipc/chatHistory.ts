import { registerIpcHandler } from '../services/ipcSecurity'
import {
  clearChatHistory,
  loadChatHistory,
  saveChatHistory
} from '../services/chatHistoryStore'

export function registerChatHistoryIpc(): void {
  registerIpcHandler('chatHistory:load', () => loadChatHistory())
  registerIpcHandler('chatHistory:save', (_event, history: unknown) => saveChatHistory(history))
  registerIpcHandler('chatHistory:clear', () => clearChatHistory())
}
