export const WORKSPACE_SNAPSHOT_VERSION = 1 as const

const MAX_TABS = 100
const MAX_STRING_LENGTH = 256
const MAX_TITLE_LENGTH = 120

export type WorkspaceMode = 'direct' | 'jumpserver' | 'local'

export interface DirectReconnectTarget {
  kind: 'direct'
  hostId: string
}

export interface JumpserverReconnectTarget {
  kind: 'jumpserver'
  configId: string
  assetId: string
  accountId: string
  assetName: string
  accountName?: string
}

export interface LocalReconnectTarget {
  kind: 'local'
}

export type ReconnectTarget =
  | DirectReconnectTarget
  | JumpserverReconnectTarget
  | LocalReconnectTarget

export interface TerminalTabSnapshot {
  id: string
  title: string
  defaultTitle: string
  mode: WorkspaceMode
  hostId: string | null
  hostName: string
  reconnectTarget: ReconnectTarget | null
}

export interface ChatTabSnapshot {
  id: string
  title: string
  mode: 'chat' | 'agent'
  includeTerminalContext: boolean
  linkedTerminalTabId: string | null
}

export interface WorkspaceSnapshotV1 {
  version: typeof WORKSPACE_SNAPSHOT_VERSION
  savedAt: string
  activeMode: WorkspaceMode
  terminalTabs: TerminalTabSnapshot[]
  activeTerminalTabIds: Record<WorkspaceMode, string>
  chatTabs: ChatTabSnapshot[]
  activeChatTabId: string
}

export type WorkspaceSnapshotParseResult =
  | { recoverable: true; snapshot: WorkspaceSnapshotV1 }
  | { recoverable: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, maxLength = MAX_STRING_LENGTH): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return null
  return trimmed
}

function readOptionalString(value: unknown, maxLength = MAX_STRING_LENGTH): string | null {
  if (value === null || value === undefined) return null
  return readString(value, maxLength)
}

function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return value === 'direct' || value === 'jumpserver' || value === 'local'
}

function isPanelMode(value: unknown): value is 'chat' | 'agent' {
  return value === 'chat' || value === 'agent'
}

export function normalizeReconnectTarget(value: unknown): ReconnectTarget | null {
  if (!isRecord(value)) return null

  if (value.kind === 'local') {
    return { kind: 'local' }
  }

  if (value.kind === 'direct') {
    const hostId = readString(value.hostId)
    return hostId ? { kind: 'direct', hostId } : null
  }

  if (value.kind === 'jumpserver') {
    const configId = readString(value.configId)
    const assetId = readString(value.assetId)
    const accountId = readString(value.accountId)
    const assetName = readString(value.assetName, MAX_TITLE_LENGTH)
    const accountName = readOptionalString(value.accountName, MAX_TITLE_LENGTH)
    if (!configId || !assetId || !accountId || !assetName) return null
    return {
      kind: 'jumpserver',
      configId,
      assetId,
      accountId,
      assetName,
      ...(accountName ? { accountName } : {})
    }
  }

  return null
}

function normalizeTerminalTab(value: unknown): TerminalTabSnapshot | null {
  if (!isRecord(value) || !isWorkspaceMode(value.mode)) return null
  const id = readString(value.id)
  const title = readString(value.title, MAX_TITLE_LENGTH)
  const defaultTitle = readString(value.defaultTitle, MAX_TITLE_LENGTH)
  const hostName = readString(value.hostName, MAX_TITLE_LENGTH)
  const hostId = value.hostId === null ? null : readOptionalString(value.hostId)
  if (!id || !title || !defaultTitle || !hostName) return null

  return {
    id,
    title,
    defaultTitle,
    mode: value.mode,
    hostId,
    hostName,
    reconnectTarget: normalizeReconnectTarget(value.reconnectTarget)
  }
}

function normalizeChatTab(value: unknown, terminalTabIds: Set<string>): ChatTabSnapshot | null {
  if (!isRecord(value) || !isPanelMode(value.mode) || typeof value.includeTerminalContext !== 'boolean') {
    return null
  }
  const id = readString(value.id)
  const title = readString(value.title, MAX_TITLE_LENGTH)
  if (!id || !title) return null

  const linkedTerminalTabId = readOptionalString(value.linkedTerminalTabId)
  return {
    id,
    title,
    mode: value.mode,
    includeTerminalContext: value.includeTerminalContext,
    linkedTerminalTabId: linkedTerminalTabId && terminalTabIds.has(linkedTerminalTabId)
      ? linkedTerminalTabId
      : null
  }
}

function normalizeActiveTerminalTabIds(
  value: unknown,
  terminalTabs: TerminalTabSnapshot[]
): Record<WorkspaceMode, string> {
  const raw = isRecord(value) ? value : {}
  const modes: WorkspaceMode[] = ['direct', 'jumpserver', 'local']
  const result = {} as Record<WorkspaceMode, string>

  for (const mode of modes) {
    const requestedId = readOptionalString(raw[mode])
    const isValid = requestedId && terminalTabs.some((tab) => tab.id === requestedId && tab.mode === mode)
    result[mode] = isValid ? requestedId : terminalTabs.find((tab) => tab.mode === mode)?.id || ''
  }

  return result
}

export function normalizeWorkspaceSnapshot(value: unknown): WorkspaceSnapshotParseResult {
  if (!isRecord(value)) {
    return { recoverable: false, reason: '保存的工作区不是有效对象' }
  }
  if (value.version !== WORKSPACE_SNAPSHOT_VERSION) {
    return { recoverable: false, reason: '保存的工作区版本不受支持' }
  }
  if (!isWorkspaceMode(value.activeMode)) {
    return { recoverable: false, reason: '保存的工作区模式无效' }
  }
  const savedAt = readString(value.savedAt)
  if (!savedAt || !Array.isArray(value.terminalTabs) || !Array.isArray(value.chatTabs)) {
    return { recoverable: false, reason: '保存的工作区字段不完整' }
  }
  if (value.terminalTabs.length > MAX_TABS || value.chatTabs.length > MAX_TABS) {
    return { recoverable: false, reason: '保存的工作区标签数量超出限制' }
  }

  const terminalTabs: TerminalTabSnapshot[] = []
  const terminalTabIds = new Set<string>()
  for (const valueItem of value.terminalTabs) {
    const tab = normalizeTerminalTab(valueItem)
    if (!tab || terminalTabIds.has(tab.id)) continue
    terminalTabs.push(tab)
    terminalTabIds.add(tab.id)
  }

  const chatTabs: ChatTabSnapshot[] = []
  const chatTabIds = new Set<string>()
  for (const valueItem of value.chatTabs) {
    const tab = normalizeChatTab(valueItem, terminalTabIds)
    if (!tab || chatTabIds.has(tab.id)) continue
    chatTabs.push(tab)
    chatTabIds.add(tab.id)
  }

  const requestedActiveChatTabId = readOptionalString(value.activeChatTabId)
  const activeChatTabId = requestedActiveChatTabId && chatTabIds.has(requestedActiveChatTabId)
    ? requestedActiveChatTabId
    : chatTabs[0]?.id || ''

  return {
    recoverable: true,
    snapshot: {
      version: WORKSPACE_SNAPSHOT_VERSION,
      savedAt,
      activeMode: value.activeMode,
      terminalTabs,
      activeTerminalTabIds: normalizeActiveTerminalTabIds(value.activeTerminalTabIds, terminalTabs),
      chatTabs,
      activeChatTabId
    }
  }
}
