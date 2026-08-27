import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ChatMessage } from '../types/chat'
import type { AgentMessage, AgentStatus, AgentState } from '../../../main/services/agentController'
import type { AgentContextSnapshot } from '../../../main/services/agentContextStore'
import { v4 as uuidv4 } from 'uuid'

export type PanelMode = 'chat' | 'agent'

// Agent message with rendering metadata
export interface AgentDisplayMessage {
  id: string
  type: AgentMessage['type']
  stepNumber?: number
  content: string
  reasoning?: string
  details?: Record<string, unknown>
  createdAt: string
  // Thinking streaming state
  thinkingId?: string
  streaming?: boolean
  collapsed?: boolean
}

export interface AgentConfirmRequest {
  message: string
  pendingCommand: string
}

export interface ChatTab {
  id: string
  title: string
  mode: PanelMode
  messages: ChatMessage[]
  isStreaming: boolean
  error: string | null
  includeTerminalContext: boolean
  // Agent state
  agentStatus: AgentStatus | null
  // P1-4：state 字段用 AgentState union，避免拼写错误被静默接受
  agentState: AgentState
  // 注意：tab.messages 才是 Agent 时间线的唯一 source of truth。
  // 之前分散在 tab.agentMessages / tab.messages / agentConclusionMessages 的多数组结构已废弃。
  agentTask: string
  confirmRequest: AgentConfirmRequest | null
  autoExecute: boolean
  allowWrite: boolean
  // Binding info per tab
  boundHost: string
  // 续接上下文：当前对话框最近一次未完成的任务快照
  pendingContext: AgentContextSnapshot | null
  // 主人是否已对续接/新任务做出选择；true 表示本轮已确认，可继续输入
  contextResolved: boolean
  // Agent 下一轮提交模式：'followup'（默认，保留执行上下文）/ 'new'（下一轮开新任务，清空 steps/conclusion 等）
  agentMode: 'followup' | 'new'
}

function createChatTab(override?: Partial<ChatTab>): ChatTab {
  return {
    id: uuidv4(),
    title: '对话',
    mode: 'agent',
    messages: [],
    isStreaming: false,
    error: null,
    includeTerminalContext: false,
    agentStatus: null,
    agentState: 'idle',
    agentTask: '',
    confirmRequest: null,
    autoExecute: false,
    allowWrite: false,
    boundHost: '',
    pendingContext: null,
    contextResolved: true,
    agentMode: 'followup',
    ...override
  }
}

export const useChatStore = defineStore('chat', () => {
  const tabs = ref<ChatTab[]>([createChatTab()])
  const activeTabId = ref(tabs.value[0].id)

  // Per-tab cleanup stream function
  const cleanupFns = new Map<string, () => void>()

  // 单调递增的标题编号：关闭中间标签后新建不重号
  let tabSerial = 1

  const activeTab = computed(() =>
    tabs.value.find(t => t.id === activeTabId.value) || tabs.value[0]
  )

  // ---- Helper: find tab by id ----
  function getTab(tabId: string): ChatTab | undefined {
    return tabs.value.find(t => t.id === tabId)
  }

  // ---- Compatibility accessors (active tab) ----
  const mode = computed(() => activeTab.value.mode)
  const messages = computed(() => activeTab.value.messages)
  const isStreaming = computed(() => activeTab.value.isStreaming)
  const error = computed(() => activeTab.value.error)
  const includeTerminalContext = computed({
    get: () => activeTab.value.includeTerminalContext,
    set: (val: boolean) => { activeTab.value.includeTerminalContext = val }
  })
  const agentStatus = computed(() => activeTab.value.agentStatus)
  const agentState = computed(() => activeTab.value.agentState)
  const agentTask = computed(() => activeTab.value.agentTask)
  const confirmRequest = computed(() => activeTab.value.confirmRequest)
  const autoExecute = computed(() => activeTab.value.autoExecute)
  const allowWrite = computed(() => activeTab.value.allowWrite)
  const boundHost = computed(() => activeTab.value.boundHost)
  const pendingContext = computed(() => activeTab.value.pendingContext)
  const contextResolved = computed(() => activeTab.value.contextResolved)

  // ---- Tab management ----
  function addTab(): string {
    const tab = createChatTab({ title: `对话 ${++tabSerial}` })
    tabs.value.push(tab)
    activeTabId.value = tab.id
    return tab.id
  }

  function switchTab(id: string): void {
    if (tabs.value.find(t => t.id === id)) {
      activeTabId.value = id
    }
  }

  function closeTab(id: string): void {
    if (tabs.value.length <= 1) return
    const idx = tabs.value.findIndex(t => t.id === id)
    if (idx < 0) return

    // 清理后端持有的 agentTabState 以防止内存泄露
    void window.electronAPI.agent.destroy({ chatTabId: id })

    const fn = cleanupFns.get(id)
    if (fn) { fn(); cleanupFns.delete(id) }
    tabs.value.splice(idx, 1)
    if (activeTabId.value === id) {
      const newIdx = Math.min(idx, tabs.value.length - 1)
      activeTabId.value = tabs.value[newIdx].id
    }
  }

  // ---- Chat mode functions (active tab) ----
  function addUserMessage(text: string): ChatMessage {
    const msg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      text,
      status: 'done',
      createdAt: new Date().toISOString()
    }
    activeTab.value.messages.push(msg)
    return msg
  }

  function addAssistantMessage(): ChatMessage {
    const msg: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      text: '',
      reasoning: '',
      status: 'streaming',
      createdAt: new Date().toISOString()
    }
    activeTab.value.messages.push(msg)
    return msg
  }

  function appendToLastMessage(text?: string, reasoning?: string): void {
    const tab = activeTab.value
    const last = tab.messages[tab.messages.length - 1]
    if (last && last.role === 'assistant') {
      if (text) last.text += text
      if (reasoning) last.reasoning = (last.reasoning || '') + reasoning
    }
  }

  function finishLastMessage(err?: string): void {
    const tab = activeTab.value
    const last = tab.messages[tab.messages.length - 1]
    if (last && last.role === 'assistant') {
      last.status = err ? 'error' : 'done'
      if (err) last.text = last.text || err
    }
    tab.isStreaming = false
    const fn = cleanupFns.get(tab.id)
    if (fn) { fn(); cleanupFns.delete(tab.id) }
  }

  // ---- Agent mode functions (active tab) ----
  function setMode(m: PanelMode): void {
    activeTab.value.mode = m
  }

  function setAgentTask(desc: string): void {
    activeTab.value.agentTask = desc
  }

  function finalizeExecutionMessages(stepNumber?: number): void {
    finalizeExecutionMessagesByTabId(activeTab.value.id, stepNumber)
  }

  function addAgentMessage(msg: AgentDisplayMessage): void {
    addAgentMessageByTabId(activeTab.value.id, msg)
  }

  function setAgentState(state: AgentState): void {
    setAgentStateByTabId(activeTab.value.id, state)
  }

  function setConfirmRequest(req: AgentConfirmRequest | null): void {
    setConfirmRequestByTabId(activeTab.value.id, req)
  }

  function setAutoExecute(v: boolean): void {
    setAutoExecuteByTabId(activeTab.value.id, v)
  }

  function setAllowWrite(v: boolean): void {
    setAllowWriteByTabId(activeTab.value.id, v)
  }

  function clearMessages(): void {
    activeTab.value.messages = []
  }

  function finalizeThinkingOnStop(): void {
    finalizeThinkingOnStopByTabId(activeTab.value.id)
  }

  function resetAgent(): void {
    const tab = activeTab.value
    tab.agentState = 'idle'
    tab.agentTask = ''
    tab.confirmRequest = null
    tab.agentStatus = null
    // 清空 Agent 时间线：执行结论 + 自然聊天助手侧 + 自然聊天用户侧 + 全部执行卡片
    tab.messages = tab.messages.filter(
      (m) => !m.isAgentConclusion && !m.isAgentNaturalReply && !m.isAgentUserTurn && !m.isAgentCard
    )
    // 主人明确开启新任务时也会调用本函数；pendingContext 由调用方显式维护
  }

  function fullResetAgent(): void {
    resetAgent()
    activeTab.value.autoExecute = false
    activeTab.value.allowWrite = false
    activeTab.value.boundHost = ''
  }

  function setStreaming(v: boolean): void {
    activeTab.value.isStreaming = v
  }

  function setError(err: string | null): void {
    activeTab.value.error = err
  }

  function setCleanup(fn: () => void): void {
    const oldFn = cleanupFns.get(activeTab.value.id)
    if (oldFn) {
      oldFn()
    }
    cleanupFns.set(activeTab.value.id, fn)
  }

  function setBoundHost(host: string): void {
    activeTab.value.boundHost = host
  }

  function setAgentStatus(status: AgentStatus | null): void {
    setAgentStatusByTabId(activeTab.value.id, status)
  }

  function setPendingContext(ctx: AgentContextSnapshot | null): void {
    setPendingContextByTabId(activeTab.value.id, ctx)
  }

  function clearPendingContext(): void {
    setPendingContextByTabId(activeTab.value.id, null)
  }

  function setContextResolved(v: boolean): void {
    setContextResolvedByTabId(activeTab.value.id, v)
  }

  /**
   * 标记下一次 Agent 提交为"开启新任务"模式。
   * 仅在用户明确点"重置"按钮时被调用，takeAgentMode 消费后自动回到 followup。
   */
  function setAgentMode(mode: 'followup' | 'new'): void {
    activeTab.value.agentMode = mode
  }

  /**
   * 一次性读取 agentMode 并立刻重置为 'followup'，
   * 保证 onStartAgent 只在用户明确要求的那一次传入 isNewTask=true。
   */
  function takeAgentMode(): 'followup' | 'new' {
    const mode = activeTab.value.agentMode
    activeTab.value.agentMode = 'followup'
    return mode
  }

  // ============================================================
  // ---- Direct-by-tabId write methods (no activeTab switch) ----
  // ============================================================

  /** Append to last assistant message in a specific tab */
  function appendToLastMessageByTabId(tabId: string, text?: string, reasoning?: string): void {
    const tab = getTab(tabId)
    if (!tab) return
    const last = tab.messages[tab.messages.length - 1]
    if (last && last.role === 'assistant') {
      if (text) last.text += text
      if (reasoning) last.reasoning = (last.reasoning || '') + reasoning
    }
  }

  /** Finish last assistant message in a specific tab */
  function finishLastMessageByTabId(tabId: string, err?: string): void {
    const tab = getTab(tabId)
    if (!tab) return
    const last = tab.messages[tab.messages.length - 1]
    if (last && last.role === 'assistant') {
      last.status = err ? 'error' : 'done'
      if (err) last.text = last.text || err
    }
    tab.isStreaming = false
    const fn = cleanupFns.get(tabId)
    if (fn) { fn(); cleanupFns.delete(tabId) }
  }

  /** Set error in a specific tab */
  function setErrorByTabId(tabId: string, err: string | null): void {
    const tab = getTab(tabId)
    if (tab) tab.error = err
  }

  /** Add agent message to a specific tab — 单时间线收口版 */
  function addAgentMessageByTabId(tabId: string, msg: AgentDisplayMessage): void {
    const tab = getTab(tabId)
    if (!tab) return

    // 1) conclusion — 任务收尾，进入时间线标记 isAgentConclusion
    if (msg.type === 'conclusion') {
      finalizeExecutionMessagesByTabId(tabId)
      const chatMsg: ChatMessage = {
        id: msg.id,
        role: 'assistant',
        text: msg.content,
        status: 'done',
        createdAt: msg.createdAt,
        isAgentConclusion: true,
        agentDetails: msg.details
      }
      tab.messages.push(chatMsg)
      return
    }

    // 2) user_turn — Agent 模式用户发言
    if (msg.type === 'user_turn') {
      const chatMsg: ChatMessage = {
        id: msg.id,
        role: 'user',
        text: msg.content,
        status: 'done',
        createdAt: msg.createdAt,
        isAgentUserTurn: true
      }
      tab.messages.push(chatMsg)
      return
    }

    // 3) assistant_reply — Agent 自然聊天
    if (msg.type === 'assistant_reply') {
      const chatMsg: ChatMessage = {
        id: msg.id,
        role: 'assistant',
        text: msg.content,
        status: 'done',
        createdAt: msg.createdAt,
        isAgentNaturalReply: true
      } as ChatMessage
      tab.messages.push(chatMsg)
      return
    }

    // 4) 思考块：按 thinkingId 去重更新（不增加新条目）
    if (msg.type === 'thinking' && msg.thinkingId) {
      const existing = tab.messages.find(
        (m) => m.isAgentCard && m.agentCardType === 'thinking' && m.thinkingId === msg.thinkingId
      )
      if (existing) {
        if (!msg.streaming && !msg.content.trim()) {
          // 空 thinking 块：直接删除占位条目
          const idx = tab.messages.indexOf(existing)
          if (idx >= 0) tab.messages.splice(idx, 1)
          return
        }
        if (tab.agentState === 'stopped' && msg.streaming) return
        existing.text = msg.content
        existing.streaming = msg.streaming
        existing.collapsed = msg.streaming ? false : true
        return
      }
    }
    if (msg.type === 'thinking' && !msg.streaming && !msg.content.trim()) return
    if (msg.type === 'thinking' && tab.agentState === 'stopped') return

    // 5) observation / error 出现时，把当前 step 的 execution 标记为收尾
    if (msg.type === 'observation' || msg.type === 'error') {
      finalizeExecutionMessagesByTabId(tabId, msg.stepNumber)
    }

    // 6) 执行卡片统一进 tab.messages
    const cardType: ChatMessage['agentCardType'] =
      msg.type === 'plan' || msg.type === 'execution' || msg.type === 'observation' ||
      msg.type === 'thinking' || msg.type === 'error' || msg.type === 'status'
        ? msg.type
        : undefined
    if (!cardType) return  // 防御：未知类型不入库

    const cardMsg: ChatMessage = {
      id: msg.id,
      role: 'system',  // 中性：渲染层按 isAgentCard 分支，不依赖 role
      text: msg.content,
      status: 'done',
      createdAt: msg.createdAt,
      isAgentCard: true,
      agentCardType: cardType,
      stepNumber: msg.stepNumber,
      details: msg.details,
      streaming: msg.streaming,
      collapsed: msg.collapsed,
      thinkingId: msg.thinkingId
    }
    tab.messages.push(cardMsg)
  }

  /** Set agent state in a specific tab */
  function setAgentStateByTabId(tabId: string, state: AgentState): void {
    const tab = getTab(tabId)
    if (tab) tab.agentState = state
  }

  /** Finalize execution messages in a specific tab */
  function finalizeExecutionMessagesByTabId(tabId: string, stepNumber?: number): void {
    const tab = getTab(tabId)
    if (!tab) return
    for (const msg of tab.messages) {
      if (!msg.isAgentCard || msg.agentCardType !== 'execution') continue
      if (stepNumber !== undefined && msg.stepNumber !== stepNumber) continue
      msg.details = {
        ...(msg.details && typeof msg.details === 'object' ? msg.details : {}),
        running: false,
        awaitingApproval: false
      }
    }
  }

  /** Finalize thinking on stop in a specific tab */
  function finalizeThinkingOnStopByTabId(tabId: string): void {
    const tab = getTab(tabId)
    if (!tab) return
    for (const msg of tab.messages) {
      if (msg.isAgentCard && msg.agentCardType === 'thinking' && msg.streaming) {
        msg.streaming = false
        msg.collapsed = true
      }
    }
  }

  /** Set confirm request in a specific tab */
  function setConfirmRequestByTabId(tabId: string, req: AgentConfirmRequest | null): void {
    const tab = getTab(tabId)
    if (tab) tab.confirmRequest = req
  }

  /** Clear binding in a specific tab */
  function clearBindingByTabId(tabId: string): void {
    const tab = getTab(tabId)
    if (!tab) return
    tab.boundHost = ''
    if (tab.agentStatus) {
      tab.agentStatus = { ...tab.agentStatus, boundHost: undefined }
    }
  }

  /** Set agent status in a specific tab */
  function setAgentStatusByTabId(tabId: string, status: AgentStatus | null): void {
    const tab = getTab(tabId)
    if (tab) tab.agentStatus = status
  }

  /** Set autoExecute in a specific tab */
  function setAutoExecuteByTabId(tabId: string, v: boolean): void {
    const tab = getTab(tabId)
    if (tab) tab.autoExecute = v
  }

  /** Set allowWrite in a specific tab */
  function setAllowWriteByTabId(tabId: string, v: boolean): void {
    const tab = getTab(tabId)
    if (tab) tab.allowWrite = v
  }

  /** Set pendingContext in a specific tab */
  function setPendingContextByTabId(tabId: string, ctx: AgentContextSnapshot | null): void {
    const tab = getTab(tabId)
    if (tab) {
      tab.pendingContext = ctx
      if (!ctx) {
        // 清空时同步把"已确认"标记位置为 true，让输入框恢复可用
        tab.contextResolved = true
      } else {
        // 加载到悬空上下文时，需要主人先做选择
        tab.contextResolved = false
      }
    }
  }

  /** Set contextResolved in a specific tab */
  function setContextResolvedByTabId(tabId: string, v: boolean): void {
    const tab = getTab(tabId)
    if (tab) tab.contextResolved = v
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    // Compatibility (active tab)
    mode,
    messages,
    isStreaming,
    error,
    includeTerminalContext,
    agentStatus,
    agentState,
    agentTask,
    confirmRequest,
    autoExecute,
    allowWrite,
    boundHost,
    pendingContext,
    contextResolved,
    // Tab management
    addTab,
    switchTab,
    closeTab,
    // Chat (active tab)
    addUserMessage,
    addAssistantMessage,
    appendToLastMessage,
    finishLastMessage,
    clearMessages,
    // Agent (active tab)
    setMode,
    setAgentTask,
    addAgentMessage,
    setAgentState,
    setConfirmRequest,
    setAutoExecute,
    setAllowWrite,
    finalizeExecutionMessages,
    finalizeThinkingOnStop,
    resetAgent,
    fullResetAgent,
    setStreaming,
    setError,
    setCleanup,
    setBoundHost,
    setAgentStatus,
    setPendingContext,
    clearPendingContext,
    setContextResolved,
    setAgentMode,
    takeAgentMode,
    // Direct-by-tabId (no activeTab switch)
    appendToLastMessageByTabId,
    finishLastMessageByTabId,
    setErrorByTabId,
    addAgentMessageByTabId,
    setAgentStateByTabId,
    finalizeExecutionMessagesByTabId,
    finalizeThinkingOnStopByTabId,
    setConfirmRequestByTabId,
    clearBindingByTabId,
    setAgentStatusByTabId,
    setAutoExecuteByTabId,
    setAllowWriteByTabId,
    setPendingContextByTabId,
    setContextResolvedByTabId
  }
})
