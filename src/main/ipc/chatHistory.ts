import { ipcMain } from 'electron'
import {
  clearChatHistory,
  loadChatHistory,
  saveChatHistory
} from '../services/chatHistoryStore'

export function registerChatHistoryIpc(): void {
  ipcMain.handle('chatHistory:load', () => loadChatHistory())
  ipcMain.handle('chatHistory:save', (_event, history: unknown) => saveChatHistory(history))
  ipcMain.handle('chatHistory:clear', () => clearChatHistory())
}
