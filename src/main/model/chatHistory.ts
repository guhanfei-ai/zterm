/**
 * 聊天历史持久化模型（v1）。
 *
 * 只保存用户可见的对话正文与轻量标记；以下内容一律不持久化：
 * - Agent 运行态（状态机、确认请求、自动执行授权、pendingContext）
 * - 卡片 details（可能包含终端输出等敏感内容）
 * - 流式状态（streaming / collapsed / thinkingId）
 * - 任何凭据或 API Key
 */

export const CHAT_HISTORY_VERSION = 1 as const

const MAX_TABS = 100
const MAX_MESSAGES_PER_TAB = 500
const MAX_MESSAGE_TEXT_LENGTH = 100 * 1024 // 单条消息 100KB 上限
const MAX_REASONING_LENGTH = 100 * 1024
const MAX_TITLE_LENGTH = 120
const TRUNCATION_MARKER = '\n…[内容过长，已截断]'

export type ChatHistoryRole = 'user' | 'assistant' | 'system'

export type ChatHistoryCardType =
  | 'plan'
  | 'execution'
  | 'observation'
  | 'thinking'
  | 'error'
  | 'status'

export interface ChatHistoryMessageV1 {
  id: string
  role: ChatHistoryRole
  text: string
  reasoning?: string
  createdAt: string
  isAgentConclusion?: boolean
  isAgentNaturalReply?: boolean
  isAgentUserTurn?: boolean
  isAgentCard?: boolean
  agentCardType?: ChatHistoryCardType
  stepNumber?: number
}

export interface ChatHistoryTabV1 {
  id: string
  title: string
  mode: 'chat' | 'agent'
  messages: ChatHistoryMessageV1[]
}

export interface ChatHistoryV1 {
  version: typeof CHAT_HISTORY_VERSION
  savedAt: string
  tabs: ChatHistoryTabV1[]
}

export type ChatHistoryParseResult =
  | { valid: true; history: ChatHistoryV1 }
  | { valid: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readShortString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return null
  return trimmed
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) + TRUNCATION_MARKER : value
}

function isRole(value: unknown): value is ChatHistoryRole {
  return value === 'user' || value === 'assistant' || value === 'system'
}

function isCardType(value: unknown): value is ChatHistoryCardType {
  return (
    value === 'plan' || value === 'execution' || value === 'observation' ||
    value === 'thinking' || value === 'error' || value === 'status'
  )
}

function normalizeMessage(value: unknown): ChatHistoryMessageV1 | null {
  if (!isRecord(value) || !isRole(value.role)) return null
  const id = readShortString(value.id, 64)
  const createdAt = readShortString(value.createdAt, 40)
  if (!id || !createdAt || typeof value.text !== 'string') return null

  const message: ChatHistoryMessageV1 = {
    id,
    role: value.role,
    text: truncate(value.text, MAX_MESSAGE_TEXT_LENGTH),
    createdAt
  }

  if (typeof value.reasoning === 'string' && value.reasoning.trim()) {
    message.reasoning = truncate(value.reasoning, MAX_REASONING_LENGTH)
  }
  if (value.isAgentConclusion === true) message.isAgentConclusion = true
  if (value.isAgentNaturalReply === true) message.isAgentNaturalReply = true
  if (value.isAgentUserTurn === true) message.isAgentUserTurn = true
  if (value.isAgentCard === true) {
    message.isAgentCard = true
    if (isCardType(value.agentCardType)) message.agentCardType = value.agentCardType
    if (typeof value.stepNumber === 'number' && Number.isSafeInteger(value.stepNumber)) {
      message.stepNumber = value.stepNumber
    }
  }

  return message
}

function normalizeTab(value: unknown): ChatHistoryTabV1 | null {
  if (!isRecord(value)) return null
  if (value.mode !== 'chat' && value.mode !== 'agent') return null
  const id = readShortString(value.id, 64)
  const title = readShortString(value.title, MAX_TITLE_LENGTH)
  if (!id || !title || !Array.isArray(value.messages)) return null
  if (value.messages.length > MAX_MESSAGES_PER_TAB) return null

  const messages: ChatHistoryMessageV1[] = []
  const messageIds = new Set<string>()
  for (const item of value.messages) {
    const message = normalizeMessage(item)
    if (!message || messageIds.has(message.id)) continue
    messages.push(message)
    messageIds.add(message.id)
  }

  return { id, title, mode: value.mode, messages }
}

/**
 * 验证并规范化外部输入的聊天历史。未知字段丢弃；损坏或版本不匹配
 * 返回受控的不可用结果，而不是抛错或写回覆盖。
 */
export function normalizeChatHistory(value: unknown): ChatHistoryParseResult {
  if (!isRecord(value)) {
    return { valid: false, reason: '保存的聊天历史不是有效对象' }
  }
  if (value.version !== CHAT_HISTORY_VERSION) {
    return { valid: false, reason: '保存的聊天历史版本不受支持' }
  }
  const savedAt = readShortString(value.savedAt, 40)
  if (!savedAt || !Array.isArray(value.tabs)) {
    return { valid: false, reason: '保存的聊天历史字段不完整' }
  }
  if (value.tabs.length > MAX_TABS) {
    return { valid: false, reason: '保存的聊天历史标签数量超出限制' }
  }

  const tabs: ChatHistoryTabV1[] = []
  const tabIds = new Set<string>()
  for (const item of value.tabs) {
    const tab = normalizeTab(item)
    if (!tab || tabIds.has(tab.id)) continue
    tabs.push(tab)
    tabIds.add(tab.id)
  }

  return { valid: true, history: { version: CHAT_HISTORY_VERSION, savedAt, tabs } }
}
