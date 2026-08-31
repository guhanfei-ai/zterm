import {
  normalizeChatHistory,
  type ChatHistoryV1
} from '../model/chatHistory'
import { getStore } from './store'

export const CHAT_HISTORY_STORE_KEY = 'chat_history_v1'

export type ChatHistoryLoadResult =
  | { found: false }
  | { valid: true; history: ChatHistoryV1 }
  | { valid: false; reason: string }

export function loadChatHistory(): ChatHistoryLoadResult {
  try {
    const raw = getStore().get(CHAT_HISTORY_STORE_KEY)
    if (raw === undefined) return { found: false }
    const result = normalizeChatHistory(raw)
    return result.valid
      ? { valid: true, history: result.history }
      : { valid: false, reason: result.reason }
  } catch {
    console.error('[chatHistory] 读取聊天历史失败')
    return { valid: false, reason: '读取已保存聊天历史失败' }
  }
}

export function saveChatHistory(value: unknown): { success: true; history: ChatHistoryV1 } | { success: false; error: string } {
  const result = normalizeChatHistory(value)
  if (!result.valid) {
    return { success: false, error: result.reason }
  }

  try {
    getStore().set(CHAT_HISTORY_STORE_KEY, result.history)
    return { success: true, history: result.history }
  } catch {
    console.error('[chatHistory] 保存聊天历史失败')
    return { success: false, error: '保存聊天历史失败' }
  }
}

export function clearChatHistory(): { success: boolean; error?: string } {
  try {
    getStore().delete(CHAT_HISTORY_STORE_KEY)
    return { success: true }
  } catch {
    console.error('[chatHistory] 清除聊天历史失败')
    return { success: false, error: '清除已保存聊天历史失败' }
  }
}
