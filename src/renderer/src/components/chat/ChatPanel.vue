<template>
  <div class="chat-panel">
    <!-- CHAT MODE -->
    <template v-if="chatStore.mode === 'chat'">
      <ChatMessageList :messages="chatMessagesInChatMode" :tab-id="chatStore.activeTabId" />
    </template>

    <!-- AGENT MODE -->
    <template v-else>
      <!-- 顶部信息区：两层结构——标题行 + 工具区 -->
      <div class="agent-header">
        <!-- 第一层：主机名/资产名标题行 -->
        <div class="bound-host-bar">
          <svg class="bound-host-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/>
            <line x1="6" y1="18" x2="6.01" y2="18"/>
          </svg>
          <span
            v-if="boundHostDisplay"
            class="bound-host-text"
            :title="boundHostDisplay"
          >{{ boundHostDisplay }}</span>
          <span v-else class="bound-host-placeholder">未绑定终端</span>
        </div>
        <!-- 续接 / 新任务 决策条：仅在存在未完成上下文且主人尚未做出选择时显示 -->
        <div
          v-if="chatStore.pendingContext && !chatStore.contextResolved"
          class="resume-prompt-bar"
        >
          <div class="resume-prompt-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 11 22 2 13 21 11 13 3 11"/></svg>
            <span class="resume-prompt-title">检测到上次未完成的任务</span>
          </div>
          <div class="resume-prompt-body">
            <div class="resume-row">
              <span class="resume-label">上次内容：</span>
              <span class="resume-value">{{ chatStore.pendingContext.taskDescription }}</span>
            </div>
            <div class="resume-row">
              <span class="resume-label">当前进度：</span>
              <span class="resume-value">已累计执行 {{ chatStore.pendingContext.steps.length }} 条命令（单轮预算 {{ chatStore.pendingContext.maxSteps }} 步，介入后重置）</span>
              <span v-if="chatStore.pendingContext.stopReason" class="resume-reason-tag" :class="`reason-${chatStore.pendingContext.stopReason.toLowerCase()}`">
                {{ stopReasonLabel(chatStore.pendingContext.stopReason) }}
              </span>
            </div>
            <div v-if="chatStore.pendingContext.boundHost" class="resume-row">
              <span class="resume-label">绑定主机：</span>
              <span class="resume-value">{{ chatStore.pendingContext.boundHost }}</span>
            </div>
            <div v-if="chatStore.pendingContext.steps.length > 0" class="resume-row">
              <span class="resume-label">已完成：</span>
              <span class="resume-value">{{ doneStepCount(chatStore.pendingContext) }} 步</span>
            </div>
          </div>
          <div class="resume-prompt-actions">
            <button class="btn-resume btn-resume-discard" @click="onDiscardPendingContext">开启新任务</button>
            <button class="btn-resume btn-resume-continue" @click="onAcceptPendingContext">
              {{ chatStore.pendingContext.stopReason === 'ROUND_LIMIT' ? '继续当前任务' : '基于历史重新规划' }}
            </button>
          </div>
        </div>
        <!-- 第二层：状态与操作工具区 -->
        <AgentStatusBar
          :agent-state="chatStore.agentState"
          :bound-host="boundHostDisplay"
          :elapsed-steps="elapsedSteps"
          :max-steps="maxSteps"
          :allow-write="chatStore.allowWrite"
          @bind="onAgentBind"
          @stop="onAgentStop"
          @reset="onAgentReset"
          @continue="onAgentContinue"
          @toggle-write="onToggleWrite"
        />
      </div>
      <div class="agent-message-area" ref="agentAreaRef">
        <div v-if="!agentTimelineMessages.length && chatStore.agentState === 'idle'" class="empty-agent">
          <div class="empty-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
            </svg>
          </div>
          <div class="empty-title">Agent模式</div>
          <div class="empty-desc">输入任务，Agent 将自动分析、规划、执行并输出结论</div>
          <div class="empty-hint">例如："帮我看看 nginx 为什么起不来"</div>
        </div>
        <!-- 第四轮收口：Agent 时间线只读 tab.messages（单数据源），
             由 AgentTimelineItem 内部按 msg 类型分发渲染 -->
        <AgentMessageBlock
          v-for="msg in agentTimelineMessages"
          :key="msg.id"
          :msg="msg"
          @copy-conclusion="copyConclusionAsMarkdown"
          @save-conclusion="saveConclusionAsMarkdown"
        />
      </div>
    </template>

    <!-- Unified Input Area (shared by both modes) -->
    <div class="input-container">
      <div v-if="chatStore.error" class="chat-error">{{ chatStore.error }}</div>
      <div class="input-meta">
        <label v-if="chatStore.mode === 'chat'" class="context-toggle" title="将当前终端最近输出附带为对话上下文">
          <input type="checkbox" v-model="chatStore.includeTerminalContext" />
          <span class="context-toggle-track"><span class="context-toggle-thumb"></span></span>
          <span>附带终端上下文<span v-if="linkedTerminalDisplay" class="context-terminal-name"> · {{ linkedTerminalDisplay }}</span></span>
        </label>
        <span v-else class="input-context-label" :class="{ bound: !!boundHostDisplay }">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="m7 8 3 3-3 3M12 14h5"/></svg>
          {{ boundHostDisplay ? `已关联终端 · ${boundHostDisplay}` : '请先关联终端' }}
        </span>
        <button v-if="chatStore.mode === 'chat' && chatStore.messages.length > 0" class="clear-chat" type="button" title="清空对话" @click="chatStore.clearMessages()">
          清空
        </button>
      </div>
      <div class="input-box">
        <textarea
          ref="inputRef"
          v-model="currentInput"
          class="input-textarea"
          :placeholder="currentPlaceholder"
          rows="1"
          :disabled="currentDisabled"
          @keydown="onKeydown"
          @input="autoResize"
        ></textarea>
        <div class="input-toolbar">
          <div class="toolbar-left">
            <div class="toolbar-select-wrap toolbar-mode-select">
              <select class="toolbar-select" aria-label="对话模式" :value="chatStore.mode" @change="onModeChange">
                <option value="chat">Chat模式</option>
                <option value="agent">Agent模式</option>
              </select>
              <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div class="toolbar-select-wrap toolbar-model-select" :title="currentBusy ? '输出期间无法切换模型' : selectedModel">
              <select
                class="toolbar-select"
                aria-label="AI 模型"
                :value="selectedModel"
                :disabled="currentBusy"
                @change="onModelChange"
              >
                <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
              </select>
              <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
          </div>
          <div class="toolbar-right">
            <button
              v-if="!currentBusy"
              class="btn-send"
              type="button"
              title="发送"
              aria-label="发送"
              :disabled="!currentInput.trim() || currentDisabled"
              @click="onSend"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
            <button v-else class="btn-send btn-stop" type="button" title="停止生成" aria-label="停止生成" @click="onStop">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useChatStore, type PanelMode } from '@/stores/chat'
import { useTerminalStore } from '@/stores/terminal'
import { agentStatusGuard, setAgentMessageArrivedHook } from '@/composables/useAgentGlobalEvents'
import ChatMessageList from './ChatMessageList.vue'
import AgentStatusBar from '@/components/agent/AgentStatusBar.vue'
import AgentMessageBlock from '@/components/agent/AgentMessageBlock.vue'

const chatStore = useChatStore()
const terminalStore = useTerminalStore()

const chatMessagesInChatMode = computed(() =>
  // 排除 Agent 收尾结论 + Agent 自然聊天助手侧 + Agent 自然聊天用户侧 + 全部执行卡片
  // 四类都只在 Agent 时间线显示，切到 Chat 模式不应看到
  chatStore.messages.filter((m) => !m.isAgentConclusion && !m.isAgentNaturalReply && !m.isAgentUserTurn && !m.isAgentCard)
)

// 第四轮收口：Agent 时间线 = tab.messages 中"属于 Agent"的所有消息，
// 由 AgentTimelineItem 内部按 isAgentConclusion / isAgentUserTurn /
// isAgentNaturalReply / isAgentCard 分发渲染。tab.messages 是唯一 source of truth。
const agentTimelineMessages = computed(() => {
  const msgs = chatStore.messages.filter(
    (m) => m.isAgentConclusion || m.isAgentNaturalReply || m.isAgentUserTurn || m.isAgentCard
  )
  // 消息本身已按时间顺序入队，无需额外排序
  return msgs
})

const chatInput = ref('')
const agentInput = ref('')
const selectedModel = ref('')
const availableModels = ref<string[]>([])
const inputRef = ref<HTMLTextAreaElement | null>(null)
const agentAreaRef = ref<HTMLDivElement | null>(null)
const agentScrollState = new Map<string, boolean>()
let agentStarting = false

const TEXTAREA_MIN_HEIGHT = 56
const TEXTAREA_MAX_HEIGHT = 160

const currentInput = computed({
  get: () => chatStore.mode === 'chat' ? chatInput.value : agentInput.value,
  set: (val: string) => {
    if (chatStore.mode === 'chat') chatInput.value = val
    else agentInput.value = val
  }
})

const currentPlaceholder = computed(() => {
  if (chatStore.mode === 'chat') {
    return chatStore.isStreaming ? '等待回复...' : '输入问题... (Shift+Enter 换行)'
  }
  if (chatStore.pendingContext && !chatStore.contextResolved) {
    return '上次任务未完成，直接输入将基于历史继续，也可在上方选择「开启新任务」'
  }
  switch (chatStore.agentState) {
    case 'idle': return '输入任务，按 Enter 启动...'
    case 'completed': return '任务已完成，输入新任务重新开始...'
    case 'failed': return '任务失败，输入新任务重新开始...'
    case 'stopped': return '任务已停止，输入新任务重新开始...'
    case 'stepLimitReached': return '已达步数上限，点击"继续执行"或输入新任务...'
    default: return 'Agent 工作中...'
  }
})

const AGENT_IDLE_STATES = new Set(['idle', 'completed', 'failed', 'stopped', 'stepLimitReached'])
function isAgentBusy(state: string): boolean { return !AGENT_IDLE_STATES.has(state) }

const currentDisabled = computed(() => {
  if (chatStore.mode === 'chat') return chatStore.isStreaming
  // 存在未完成上下文时不锁输入：直接输入 = follow-up（带新指示接续旧任务），
  // 后端 startTask(isNewTask=false) 原生支持；「开启新任务」按钮仍负责显式清上下文
  return isAgentBusy(chatStore.agentState)
})

const currentBusy = computed(() => {
  if (chatStore.mode === 'chat') return chatStore.isStreaming
  return isAgentBusy(chatStore.agentState)
})

function autoResize(): void {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_HEIGHT), TEXTAREA_MAX_HEIGHT) + 'px'
}

function resetInputHeight(): void {
  nextTick(() => {
    if (inputRef.value) {
      inputRef.value.style.height = TEXTAREA_MIN_HEIGHT + 'px'
    }
  })
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    onSend()
  }
}

async function onModelChange(e: Event): Promise<void> {
  if (currentBusy.value) return
  const select = e.target as HTMLSelectElement
  const previousModel = selectedModel.value
  const model = select.value
  selectedModel.value = model
  try {
    const result = await window.electronAPI.ai.setModel(model)
    if (!result.success) {
      selectedModel.value = previousModel
      select.value = previousModel
      chatStore.setError(result.error || '模型切换失败，请先完成模型配置')
      return
    }
  } catch {
    selectedModel.value = previousModel
    select.value = previousModel
    chatStore.setError('模型切换失败，请检查模型配置')
  }
}

async function loadAvailableModels(): Promise<void> {
  const builtin = ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-flash']
  availableModels.value = builtin
  try {
    const config = await window.electronAPI.ai.getProviderConfig()
    if (config) {
      selectedModel.value = config.model
      if (!builtin.includes(config.model)) {
        availableModels.value = [...builtin, config.model]
      }
    } else {
      // 首次安装无已保存配置时，默认选中 deepseek-flash
      selectedModel.value = 'deepseek-flash'
    }
  } catch {
    selectedModel.value = 'deepseek-flash'
  }
}

function onModeChange(e: Event): void {
  const select = e.target as HTMLSelectElement
  const mode = select.value as PanelMode
  if (chatStore.isStreaming || isAgentBusy(chatStore.agentState)) {
    select.value = chatStore.mode
    return
  }
  if (mode === 'chat') cleanupAgentListeners(chatStore.activeTabId)
  chatStore.setMode(mode)
  // 保留两侧输入草稿：chatInput / agentInput 各自独立，
  // 切换模式不应静默丢弃用户未发送的内容
  chatStore.setError(null)
  resetInputHeight()
}

function onSend(): void {
  if (chatStore.mode === 'chat') onSendChat()
  else onStartAgent()
}

function onStop(): void {
  if (chatStore.mode === 'chat') onStopChat()
  else onAgentStop()
}

// ============================================================
// ---- Agent listeners: per-tab isolation ----
// ============================================================
const agentListenerMap = new Map<string, Array<() => void>>()

// 状态防乱序 guard：由 useAgentGlobalEvents 提供的应用级共享实例，
// 保证较新的 stateChange 事件不会被较旧的 getStatus 快照反向回滚。
// （全局 Agent 事件监听也已迁至应用级 setupAgentGlobalEvents，不随本组件卸载注销）

// Register tab-specific listeners (for backwards compat, currently using global routing)
function registerAgentListeners(chatTabId: string): void {
  // Track that this tab has an active agent session.
  // 当前架构下事件路由由全局监听器 + chatTabId 完成，per-tab 没有独立订阅。
  // 保留此 map 作为"该 tab 当前是否处于 Agent 活跃期"的事实来源，供 cleanupAgentListeners 清理。
  if (!agentListenerMap.has(chatTabId)) {
    agentListenerMap.set(chatTabId, [])
  }
}

function cleanupAgentListeners(chatTabId: string): void {
  const unsubs = agentListenerMap.get(chatTabId)
  if (unsubs) {
    for (const unsub of unsubs) {
      try { unsub() } catch { /* ignore */ }
    }
    agentListenerMap.delete(chatTabId)
  }
}

// 由 chatStore.agentStatus 派生（全局 onStateChange → refreshAgentStatusByTabId 会持续刷新）。
// 此前用本地 refs 只在组件内刷新路径更新，全局监听器迁到应用级后 stateChange
// 不再驱动本地 refs，任务执行期间状态栏步数会停更；派生 computed 恒定跟随 store
const elapsedSteps = computed(() => chatStore.agentStatus?.elapsedSteps ?? 0)
const maxSteps = computed(() => chatStore.agentStatus?.maxSteps ?? 25)

const boundHostDisplay = computed(() => chatStore.boundHost || chatStore.agentStatus?.boundHost || '')
const linkedTerminalDisplay = computed(() => {
  const linkedId = chatStore.activeTab?.linkedTerminalTabId
  if (!linkedId) return ''
  const terminal = terminalStore.getTabById(linkedId)
  if (!terminal) return chatStore.activeTab?.linkedTerminalUnavailable ? '终端已关闭' : ''
  return terminal.hostName && terminal.hostName !== '未连接' ? terminal.hostName : terminal.title
})

watch(() => terminalStore.status, (newStatus) => {
  // 只当当前对话绑定了当前断开的终端时，才触发状态刷新，避免多标签污染
  if (newStatus === 'disconnected' && chatStore.agentStatus?.boundTerminalTabId === terminalStore.activeTabId) {
    refreshAgentStatus()
  }
})

watch(
  () => agentTimelineMessages.value.length,
  (currentLength, previousLength) => {
    if (chatStore.mode !== 'agent' || currentLength <= previousLength) return
    autoScrollAgent()
  }
)

// 当 agent 进入终态时重新拉取持久化上下文，用于在用户切换标签后展示"继续/新任务"提示
watch(
  () => chatStore.agentState,
  async (newState) => {
    if (newState === 'idle' || newState === 'completed' || newState === 'failed' || newState === 'stopped' || newState === 'stepLimitReached') {
      await refreshPendingContext()
    }
  }
)

// 切换活动对话框时也尝试加载该 tab 的悬空上下文
// immediate: true 确保默认首个标签（从不切换）也能写入活跃证据并加载上下文
watch(
  () => chatStore.activeTabId,
  async (newTabId) => {
    // 记录用户真正停留的对话标签，供重启后孤儿认领做归属校验
    if (newTabId) {
      window.electronAPI.agent.saveLastActiveTab({ chatTabId: newTabId })
    }
    await refreshPendingContext()
    await refreshAgentStatus()
    // tab 切换后重新同步滚动状态
    if (chatStore.mode === 'agent') {
      bindAgentScrollListener()
      nextTick(() => {
        const el = agentAreaRef.value
        const tabId = chatStore.activeTabId
        if (el && tabId) {
          agentScrollState.set(tabId, !isAgentNearBottom(el))
        }
      })
    }
  },
  { immediate: true }
)

// 模式切换时重新绑定/解绑 Agent 滚动监听
watch(
  () => chatStore.mode,
  (newMode) => {
    if (newMode === 'agent') {
      nextTick(() => bindAgentScrollListener())
    } else {
      unbindAgentScrollListener()
    }
  }
)

// ---- Chat Mode ----
async function onSendChat(): Promise<void> {
  const text = chatInput.value.trim()
  if (!text || chatStore.isStreaming) return

  const chatTabId = chatStore.activeTabId

  chatInput.value = ''
  chatStore.setError(null)
  chatStore.addUserMessage(text)
  resetInputHeight()
  chatStore.addAssistantMessage()
  chatStore.setStreaming(true)

  const cleanup = window.electronAPI.ai.onStreamChunk((chunk) => {
    if (chunk.chatTabId && chunk.chatTabId !== chatTabId) return
    if (chunk.error) {
      chatStore.finishLastMessageByTabId(chatTabId, chunk.error)
      chatStore.setErrorByTabId(chatTabId, chunk.error)
      return
    }
    if (chunk.done) {
      chatStore.finishLastMessageByTabId(chatTabId)
      return
    }
    chatStore.appendToLastMessageByTabId(chatTabId, chunk.text, chunk.reasoning)
  })
  const cleanupError = window.electronAPI.ai.onStreamError((data) => {
    if (data.chatTabId && data.chatTabId !== chatTabId) return
    chatStore.finishLastMessageByTabId(chatTabId, data.error)
    chatStore.setErrorByTabId(chatTabId, data.error)
  })
  chatStore.setCleanup(() => { cleanup(); cleanupError() })

  try {
    const rawMessages = structuredClone(
      // 与 chatMessagesInChatMode 的展示过滤保持一致：
      // Agent 时间线消息（结论 / 助手侧 / 用户侧 / 执行卡片）不进入 Chat 模型上下文，
      // 否则切模式后发送会把 UI 上不可见的大量执行卡片一并发给模型
      chatStore.messages
        .filter(
          (m) =>
            !m.isAgentConclusion && !m.isAgentNaturalReply && !m.isAgentUserTurn && !m.isAgentCard
        )
        .slice(0, -1)
    )
    await window.electronAPI.ai.chatStream({
      chatTabId,
      messages: rawMessages,
      includeTerminalContext: chatStore.includeTerminalContext,
      terminalTabId: terminalStore.activeTabId
    })
  } catch (err) {
    cleanup()
    cleanupError()
    const errMsg = err instanceof Error ? err.message : String(err)
    if (errMsg.includes('could not be cloned') || errMsg.includes('clone')) {
      chatStore.finishLastMessageByTabId(chatTabId, '发送失败：本地参数序列化错误，请重试')
      chatStore.setErrorByTabId(chatTabId, '发送失败：本地参数序列化错误，请重试')
    } else {
      chatStore.finishLastMessageByTabId(chatTabId, errMsg)
    }
  }
}

async function onStopChat(): Promise<void> {
  const chatTabId = chatStore.activeTabId
  await window.electronAPI.ai.abort({ chatTabId })
  chatStore.finishLastMessageByTabId(chatTabId, '已由用户中止')
}

// ---- Agent Mode ----
async function onAgentBind(): Promise<void> {
  if (terminalStore.status !== 'connected') {
    chatStore.setError('请先连接到一台主机再绑定')
    return
  }
  const chatTabId = chatStore.activeTabId
  const terminalTabId = terminalStore.activeTabId

  const result = await window.electronAPI.agent.bind({ chatTabId, terminalTabId })
  if (result.success && result.boundHost) {
    chatStore.setError(null)
    chatStore.setBoundHost(result.boundHost)
    await refreshAgentStatus()
  } else {
    chatStore.setError(result.error || '绑定失败：无法获取当前终端主机信息')
  }
}

async function onStartAgent(): Promise<void> {
  if (agentStarting) return

  const text = agentInput.value.trim()
  if (!text) return

  if (chatStore.agentState !== 'idle' &&
      chatStore.agentState !== 'completed' &&
      chatStore.agentState !== 'failed' &&
      chatStore.agentState !== 'stopped' &&
      chatStore.agentState !== 'stepLimitReached') {
    return
  }

  // 有悬空上下文时允许直接启动：走 follow-up（isNewTask=false），
  // 输入会作为 user_turn 接进旧任务历史，等价于"带着新指示继续上次任务"；
  // 「开启新任务」按钮仍负责显式丢弃上下文的路径

  agentStarting = true
  try {

  const chatTabId = chatStore.activeTabId

  // 不再调 agent:reset——startTask 内部会自己处理状态重置
  // 不再清空 agentMessages / resetAgent——让上一轮执行轨迹保留可见

  // 第一轮收口：把用户发言作为 user_turn 推进时间线，让 UI 立即出现用户气泡。
  // 持久化与 graph state 由后端 agentController.startTask 内部负责。
  chatStore.addAgentMessage({
    id: `user-turn-${Date.now()}`,
    type: 'user_turn',
    content: text,
    createdAt: new Date().toISOString()
  })

  agentInput.value = ''
  chatStore.setError(null)
  chatStore.setAgentTask(text)
  // 启动即视为已对悬空上下文做出选择（无论 follow-up 还是新任务）：
  // 清决策条并解锁后续输入。定向到发起的 tab，防 IPC 期间切标签清理错位。
  // follow-up 由 takeAgentMode() 的默认值保证（未被显式置为 'new' 时 isNewTask=false）
  chatStore.setPendingContextByTabId(chatTabId, null)
  chatStore.setContextResolvedByTabId(chatTabId, true)
  resetInputHeight()
  // 新任务启动：重置滚动状态，强制贴底
  agentScrollState.set(chatStore.activeTabId, false)
  forceScrollAgentToBottom()

  registerAgentListeners(chatTabId)

  try {
    // 第三轮补丁：一次性消费 agentMode —— 用户点过"重置"后，下一次发言才传 isNewTask=true；
    // 消费后立即回退到 followup，避免连续多条发言都按新任务处理。
    const isNewTask = chatStore.takeAgentMode() === 'new'
    const result = await window.electronAPI.agent.startTask({
      chatTabId,
      description: text,
      maxSteps: 25,
      isNewTask
    })
    if (!result.success && result.error) {
      chatStore.setError(result.error)
      cleanupAgentListeners(chatTabId)
    }
  } catch (err) {
    chatStore.setError(String(err))
    cleanupAgentListeners(chatTabId)
  }

  await refreshAgentStatusByTabId(chatTabId)

  } finally {
    agentStarting = false
  }
}

async function refreshAgentStatus(): Promise<void> {
  // 当前活动标签走与 refreshAgentStatusByTabId 同一套防乱序规则，
  // 避免两条路径行为不一致导致旧快照回滚终态
  await refreshAgentStatusByTabId(chatStore.activeTabId)
}

async function refreshAgentStatusByTabId(tabId: string): Promise<void> {
  // 发起请求前记录当时的版本号与请求序号；响应回来时据此判断是否可写回 state 字段
  const request = agentStatusGuard.beginRefresh(tabId)
  try {
    const status = await window.electronAPI.agent.getStatus({ chatTabId: tabId })
    // 非状态字段（status / 步数 / 读写模式 / 绑定信息）可按最新请求正常刷新
    chatStore.setAgentStatusByTabId(tabId, status)
    chatStore.setAllowWriteByTabId(tabId, status.allowWrite)
    // state 字段受 guard 保护：只有当本次响应仍是该标签最新刷新请求，
    // 且请求期间未收到新的 stateChange 时，才允许写回；否则丢弃，避免旧快照回滚终态
    if (agentStatusGuard.shouldApplyState(tabId, request)) {
      chatStore.setAgentStateByTabId(tabId, status.state)
    }
    // 非状态字段由全局路径写入 store；步数显示由 elapsedSteps/maxSteps computed 派生
  } catch { /* ignore */ }
}

async function onAgentStop(): Promise<void> {
  const chatTabId = chatStore.activeTabId
  chatStore.finalizeThinkingOnStopByTabId(chatTabId)
  chatStore.finalizeExecutionMessagesByTabId(chatTabId)
  await window.electronAPI.agent.stop({ chatTabId })
  await refreshAgentStatusByTabId(chatTabId)
}

async function onAgentReset(): Promise<void> {
  const chatTabId = chatStore.activeTabId
  cleanupAgentListeners(chatTabId)
  await window.electronAPI.agent.fullReset({ chatTabId })
  // IPC 往返期间可能已切换标签：所有写入定向到发起请求的 chatTabId，
  // 否则 fullReset 会清掉另一个标签的 Agent 时间线（不可逆）
  chatStore.fullResetAgentByTabId(chatTabId)
  chatStore.setPendingContextByTabId(chatTabId, null)
  chatStore.setContextResolvedByTabId(chatTabId, true)
  // 第三轮补丁：明确标记下一次 Agent 提交为"开启新任务"。
  // 配合 onStartAgent 里的 takeAgentMode 一次性消费，主人重置后下一句就真正走新任务路径。
  chatStore.setAgentModeByTabId(chatTabId, 'new')
  agentInput.value = ''
  await refreshAgentStatus()
  await refreshPendingContext()
}

async function onAgentContinue(): Promise<void> {
  const chatTabId = chatStore.activeTabId
  registerAgentListeners(chatTabId)
  // 显式续跑：重置滚动状态，强制贴底看最新输出
  agentScrollState.set(chatTabId, false)
  forceScrollAgentToBottom()

  const result = await window.electronAPI.agent.continueTask(25, { chatTabId })
  if (!result.success && result.error) {
    chatStore.setError(result.error)
    cleanupAgentListeners(chatTabId)
    return
  }
  // 续跑前清掉悬空上下文：已成功接续（定向到发起的 tab，防 IPC 期间切标签串错位）
  chatStore.setPendingContextByTabId(chatTabId, null)
  await refreshAgentStatus()
}

// ---- 续接 / 新任务决策 ----
async function refreshPendingContext(): Promise<void> {
  // 仅在 Agent 处于 idle 终态时尝试加载（避免执行中反复刷新）
  const st = chatStore.agentState
  if (st !== 'idle' && st !== 'completed' && st !== 'failed' && st !== 'stopped' && st !== 'stepLimitReached') {
    return
  }
  // 已有悬空上下文且已解决：跳过（避免重新弹出已确认的提示）
  // 注意：pendingContext=null 时不能跳过——首次加载也可能 contextResolved=true（默认值）
  if (chatStore.pendingContext && chatStore.contextResolved) {
    return
  }
  try {
    const chatTabId = chatStore.activeTabId
    const result = await window.electronAPI.agent.getContext({ chatTabId })
    // IPC 往返期间可能已切换标签：所有写入必须定向到发起请求的 chatTabId，
    // 不能写入"当前激活标签"，否则旧标签的上下文会串到新标签
    if (result?.success && result.hasContext && result.context) {
      const ctx = result.context
      // 只在 stopReason 非 COMPLETED 且 taskDescription 非空时显示决策条
      if (ctx.stopReason !== 'COMPLETED' && ctx.taskDescription) {
        chatStore.setPendingContextByTabId(chatTabId, ctx)
        return
      }
    }
    // 没有可用上下文：保持已解决状态
    chatStore.setPendingContextByTabId(chatTabId, null)
  } catch {
    /* ignore */
  }
}

async function onAcceptPendingContext(): Promise<void> {
  const chatTabId = chatStore.activeTabId

  // 注册 Agent 消息监听
  registerAgentListeners(chatTabId)
  chatStore.setError(null)

  // 显式恢复：先重置滚动状态并贴底，再发起 continueTask
  // （与 onAgentContinue / onStartAgent 保持一致：先贴底再执行）
  agentScrollState.set(chatTabId, false)
  forceScrollAgentToBottom()

  try {
    const result = await window.electronAPI.agent.continueTask(25, { chatTabId })
    if (!result.success && result.error) {
      chatStore.setError(`恢复失败：${result.error}`)
      cleanupAgentListeners(chatTabId)
      return
    }
  } catch (err) {
    chatStore.setError(`恢复异常：${String(err)}`)
    cleanupAgentListeners(chatTabId)
    return
  }

  // 恢复成功：清除决策条，刷新状态（定向到发起的 tab，防 IPC 期间切标签串错位）
  chatStore.setPendingContextByTabId(chatTabId, null)
  chatStore.setContextResolvedByTabId(chatTabId, true)
  await refreshAgentStatus()
}

async function onDiscardPendingContext(): Promise<void> {
  // 主人明确选择"开启新任务"：丢弃旧上下文，下次 startTask 会写入新的
  const chatTabId = chatStore.activeTabId
  try {
    await window.electronAPI.agent.discardContext({ chatTabId })
  } catch {
    /* ignore */
  }
  // IPC 往返期间可能已切换标签：写入定向到发起请求的 chatTabId
  chatStore.setPendingContextByTabId(chatTabId, null)
  chatStore.setContextResolvedByTabId(chatTabId, true)
  chatStore.setError(null)
  // 第三轮补丁：决策按钮也是"开启新任务"语义，标记下一次提交走 isNewTask=true
  chatStore.setAgentModeByTabId(chatTabId, 'new')
}

function stopReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case 'ROUND_LIMIT': return '达到步数上限'
    case 'USER_INTERRUPT': return '用户手动停止'
    case 'ERROR': return '异常中断'
    case 'COMPLETED': return '已完成'
    default: return '未知停止原因'
  }
}

function doneStepCount(ctx: { steps: Array<{ status: string }> }): number {
  return ctx.steps.filter((s) => s.status === 'done').length
}

async function onToggleWrite(enabled: boolean): Promise<void> {
  chatStore.setError(null)
  const chatTabId = chatStore.activeTabId
  const result = await window.electronAPI.agent.setAllowWrite(enabled, { chatTabId })
  if (result.success) {
    // 同步主进程返回的真实状态，而不是乐观写入用户意图
    // （定向写回发起的 tab，防 IPC 期间切标签串错位）
    chatStore.setAllowWriteByTabId(chatTabId, result.allowWrite ?? enabled)
  } else {
    // 失败时显示明确错误反馈，并从主进程拉回真实状态
    chatStore.setError(result.error || '读写模式切换失败')
    await refreshAgentStatus()
  }
}

// ---- Agent Conclusion Helpers ----
// markdown 渲染已迁到 AgentTimelineItem.renderMarkdown 内；这里只保留"结构化报告"构造与 IPC 桥接
function buildConclusionMarkdown(msg: { text: string; agentDetails?: Record<string, unknown> }): string {
  const lines: string[] = []
  const details = msg.agentDetails

  if (details?.taskDescription) {
    lines.push(`# Agent 总结报告：${details.taskDescription}`)
  } else {
    lines.push('# Agent 总结报告')
  }
  lines.push('')

  const sysInfo = details?.systemInfo as { kernel?: string; distroName?: string; distroVersion?: string } | undefined
  if (sysInfo?.distroName) {
    lines.push(`**系统环境**：${sysInfo.distroName} ${sysInfo.distroVersion}（内核 ${sysInfo.kernel}）`)
    lines.push('')
  }

  const steps = details?.steps as Array<{ stepNumber: number; plan: string; command?: string; observation: string; status: string }> | undefined
  if (steps && steps.length > 0) {
    lines.push('## 执行步骤')
    lines.push('')
    for (const step of steps) {
      if (step.stepNumber === 0) continue
      lines.push(`### 步骤 ${step.stepNumber}：${step.plan}`)
      if (step.command) {
        lines.push(`\n\`\`\`bash\n${step.command}\n\`\`\`\n`)
      }
      lines.push(`> ${step.observation}`)
      lines.push('')
    }
  }

  lines.push('## 结论')
  lines.push('')
  lines.push(msg.text)

  return lines.join('\n')
}

async function copyConclusionAsMarkdown(msg: { text: string; agentDetails?: Record<string, unknown> }): Promise<void> {
  const md = buildConclusionMarkdown(msg)
  try {
    await navigator.clipboard.writeText(md)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = md
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
}

async function saveConclusionAsMarkdown(msg: { text: string; agentDetails?: Record<string, unknown> }): Promise<void> {
  const md = buildConclusionMarkdown(msg)
  try {
    await window.electronAPI.agent.saveConclusion({ content: md })
  } catch { /* ignore */ }
}

function isAgentNearBottom(el: HTMLElement, threshold = 60): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold
}

function onAgentAreaScroll(): void {
  const el = agentAreaRef.value
  const tabId = chatStore.activeTabId
  if (el && tabId) {
    agentScrollState.set(tabId, !isAgentNearBottom(el))
  }
}

function autoScrollAgent(): void {
  const tabId = chatStore.activeTabId
  if (tabId && agentScrollState.get(tabId)) return
  const terminalStates = ['completed', 'failed', 'stopped']
  if (terminalStates.includes(chatStore.agentState)) return
  scrollAgentToBottom()
}

function forceScrollAgentToBottom(): void {
  const tabId = chatStore.activeTabId
  if (tabId) agentScrollState.set(tabId, false)
  scrollAgentToBottom()
}

function scrollAgentToBottom(): void {
  nextTick(() => {
    if (agentAreaRef.value) {
      agentAreaRef.value.scrollTop = agentAreaRef.value.scrollHeight
    }
  })
}

// 绑定/解绑 Agent 消息区滚动监听（处理 DOM 重建）
let _agentScrollBound = false
function bindAgentScrollListener(): void {
  if (_agentScrollBound) return
  const el = agentAreaRef.value
  if (el) {
    el.addEventListener('scroll', onAgentAreaScroll, { passive: true })
    _agentScrollBound = true
  }
}
function unbindAgentScrollListener(): void {
  if (!_agentScrollBound) return
  const el = agentAreaRef.value
  if (el) {
    el.removeEventListener('scroll', onAgentAreaScroll)
  }
  _agentScrollBound = false
}

onMounted(() => {
  loadAvailableModels()
  refreshPendingContext()
  refreshAgentStatus()
  window.addEventListener('focus', refreshAgentStatus)
  // 向应用级全局监听注入"消息到达时自动滚动"回调
  setAgentMessageArrivedHook(autoScrollAgent)
  // Agent 消息区滚动监听（如果已在 Agent 模式则立即绑定）
  if (chatStore.mode === 'agent') bindAgentScrollListener()
})

onUnmounted(() => {
  // Agent 消息区滚动监听清理
  unbindAgentScrollListener()
  window.removeEventListener('focus', refreshAgentStatus)
  // 取消注入的应用级滚动回调（全局事件监听本身由 App.vue 持有，不在此注销）
  setAgentMessageArrivedHook(null)
  // Cleanup all per-tab agent listeners
  for (const [tabId] of agentListenerMap) {
    cleanupAgentListeners(tabId)
  }
})

// Cleanup Map entries when tabs are closed
watch(() => chatStore.tabs.map(t => t.id), (newIds, oldIds) => {
  if (!oldIds) return
  const removedIds = oldIds.filter(id => !newIds.includes(id))
  for (const id of removedIds) {
    agentScrollState.delete(id)
    // 同步清理 guard 中该标签的版本号与请求序号，避免 Map 无限增长
    agentStatusGuard.cleanup(id)
    const listeners = agentListenerMap.get(id)
    if (listeners) {
      listeners.forEach(cleanup => cleanup())
      agentListenerMap.delete(id)
    }
  }
})
</script>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.chat-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  border-bottom: 1px solid var(--divider);
  background: var(--surface-muted);
  flex-shrink: 0;
}

.input-meta {
  min-height: 26px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px 7px;
}

.context-toggle {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}
.context-toggle input { position: absolute; opacity: 0; pointer-events: none; }
.context-toggle-track {
  flex-shrink: 0;
  width: 24px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  padding: 2px;
  box-sizing: border-box;
  border-radius: 99px;
  background: var(--surface-high);
  transition: background .15s ease;
}
.context-toggle-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-tertiary);
  transition: transform .15s ease, background .15s ease;
}
.context-toggle input:checked + .context-toggle-track { background: color-mix(in srgb, var(--accent) 42%, var(--surface-high)); }
.context-toggle input:checked + .context-toggle-track .context-toggle-thumb { transform: translateX(10px); background: var(--accent); }
.context-toggle input:focus-visible + .context-toggle-track { outline: 2px solid var(--accent); outline-offset: 2px; }
.context-terminal-name { color: var(--text-tertiary); }
.context-toggle > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.input-context-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-tertiary);
}
.input-context-label.bound { color: var(--text-secondary); }
.input-context-label.bound svg { color: var(--accent); }
.clear-chat {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-family: inherit;
  font-size: 12px;
  padding: 2px 4px;
  cursor: pointer;
}
.clear-chat:hover { color: var(--text-primary); }

.btn-icon.tiny {
  width: 22px; height: 22px; font-size: 12px;
  background: transparent; border: 1px solid var(--border-soft);
  color: var(--text-secondary); border-radius: 4px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.btn-icon:hover { background: var(--surface-alt); color: var(--text-primary); }

.agent-message-area {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  min-height: 0;
}

.empty-agent {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 48px 24px;
  color: var(--text-secondary);
  text-align: center;
  min-height: 200px;
}
.empty-icon { margin-bottom: 12px; opacity: 0.45; }
.empty-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; }
.empty-desc { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; line-height: 1.5; }
.empty-hint { font-size: 11px; color: var(--text-tertiary); }

.input-container {
  padding: 8px 12px 12px;
  flex-shrink: 0;
}

.chat-error {
  font-size: 12px;
  color: var(--danger);
  margin-bottom: 8px;
  padding: 6px 10px;
  background: var(--danger-muted);
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
}

.input-box {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--input-shell-border);
  border-radius: var(--radius-input-capsule);
  background: var(--input-shell-bg);
  overflow: hidden;
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
  min-height: 108px;
  box-shadow: var(--shadow-subtle);
}

.input-box:focus-within {
  border-color: var(--input-shell-focus-border);
  background: var(--input-shell-hover-bg);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent), var(--shadow-capsule);
}

.input-textarea {
  display: block;
  flex-shrink: 0;
  width: 100%;
  background: transparent;
  border: none;
  color: var(--text-primary);
  padding: 12px 12px 8px;
  font-size: 13px;
  line-height: 1.5;
  outline: none;
  resize: none;
  min-height: 56px;
  max-height: 160px;
  overflow-y: auto;
  font-family: inherit;
}

.input-textarea:disabled {
  opacity: 0.5;
}

.input-textarea::placeholder {
  color: var(--text-tertiary);
  opacity: 0.85;
}

.input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  margin-top: auto;
  padding: 8px 10px 10px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.toolbar-select-wrap {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
}

.toolbar-mode-select { flex: 0 0 auto; }
.toolbar-model-select { flex: 1; max-width: 180px; }

.toolbar-select {
  width: 100%;
  height: 32px;
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  appearance: none;
  background: var(--surface-alt);
  border: 1px solid var(--divider-soft, var(--divider));
  border-radius: var(--radius-input-internal);
  color: var(--text-secondary);
  font-size: 12px;
  padding: 0 22px 0 10px;
  outline: none;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
}

.toolbar-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.toolbar-select:hover {
  background: var(--hover-overlay);
  color: var(--text-primary);
  border-color: var(--divider);
}

.toolbar-select:focus {
  border-color: var(--accent);
}

.toolbar-select option {
  background: var(--surface-muted);
  color: var(--text-primary);
}

.select-arrow {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  color: var(--text-secondary);
  opacity: 0.65;
}

.toolbar-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.btn-send {
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--input-send-bg);
  color: var(--accent-contrast, var(--text-primary));
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
  box-shadow: var(--shadow-subtle);
}

.btn-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  background: var(--input-send-disabled-bg, var(--surface-alt));
  color: var(--text-tertiary);
  box-shadow: none;
}

.btn-send:not(:disabled):hover {
  background: var(--input-send-hover-bg);
  color: var(--accent-contrast, var(--text-primary));
  box-shadow: var(--shadow-card);
}

.btn-send:not(:disabled):active {
  background: var(--input-send-active-bg, var(--accent-pressed));
  color: var(--accent-contrast, var(--text-primary));
  box-shadow: none;
}

.btn-stop {
  background: var(--danger);
  color: #fff;
}

.btn-stop:not(:disabled):hover {
  background: var(--danger-hover);
  color: #fff;
}

.btn-stop:not(:disabled):active { background: var(--danger-hover); color: #fff; }

.agent-conclusions {
  margin: 8px 0 4px;
}
.conclusion-chat {
  margin: 8px;
}
.conclusion-bubble {
  background: var(--surface-alt);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-card);
  padding: 10px 14px;
  box-shadow: var(--shadow-subtle);
}
.conclusion-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--success);
}
.conclusion-icon {
  flex-shrink: 0;
}
.conclusion-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
  word-break: break-word;
}
.conclusion-body :deep(.code-block) {
  background: var(--bg); border: 1px solid var(--divider);
  border-radius: 4px; padding: 6px 10px;
  margin: 6px 0; font-size: 11px;
  font-family: monospace; white-space: pre-wrap;
  overflow-x: auto;
}
.conclusion-body :deep(.inline-code) {
  background: var(--surface-alt); padding: 1px 4px;
  border-radius: 3px; font-size: 11px; font-family: monospace;
}
.conclusion-body :deep(strong) { color: var(--text-primary); }
.conclusion-body :deep(em) { color: var(--text-secondary); }
.conclusion-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
.btn-md-action {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  padding: 2px 8px;
  border: 1px solid var(--divider-soft);
  border-radius: 4px;
  background: transparent;
  color: var(--success);
  cursor: pointer;
  transition: all 0.15s;
}
.btn-md-action:hover {
  background: var(--success-muted);
  color: var(--success);
  border-color: var(--divider);
}

/* ---- 顶部信息区容器：统一两层结构的留白、边距与对齐 ---- */
.agent-header {
  flex-shrink: 0;
  padding: 12px 16px 4px;
  border-bottom: 1px solid var(--divider-soft);
}

/* ---- 第一层：主机名标题行（panel header / subtitle 风格）---- */
.bound-host-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  min-height: 22px;
}

.bound-host-icon {
  flex-shrink: 0;
  color: var(--accent);
  opacity: 0.55;
}

.bound-host-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.bound-host-placeholder {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-disabled);
}

.resume-prompt-bar {
  margin: 0 0 8px;
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  background: var(--surface-alt);
  border-radius: var(--radius-control);
  flex-shrink: 0;
}

.resume-prompt-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.resume-prompt-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.resume-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.resume-label {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.resume-value {
  color: var(--text-primary);
  word-break: break-word;
  flex: 1;
  min-width: 0;
}

.resume-reason-tag {
  display: inline-block;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--warning-muted);
  color: var(--warning);
  border: 1px solid var(--divider);
}

.resume-reason-tag.reason-round_limit { background: var(--warning-muted); color: var(--warning); border-color: var(--warning); }
.resume-reason-tag.reason-user_interrupt { background: var(--surface-alt); color: var(--text-secondary); border-color: var(--divider); }
.resume-reason-tag.reason-error { background: var(--danger-muted); color: var(--danger); border-color: var(--danger); }
.resume-reason-tag.reason-completed { background: var(--success-muted); color: var(--success); border-color: var(--success); }

.resume-prompt-actions {
  display: flex;
  gap: 8px;
}

.btn-resume {
  flex: 1;
  padding: 5px 10px;
  font-size: 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--divider);
  cursor: pointer;
  transition: all 0.15s;
}

.btn-resume-discard {
  background: transparent;
  color: var(--text-secondary);
}

.btn-resume-discard:hover {
  background: var(--surface-alt);
  color: var(--text-primary);
}

.btn-resume-continue {
  background: var(--accent);
  color: var(--accent-contrast, #fff);
  border-color: var(--accent);
  font-weight: 600;
}

.btn-resume-continue:hover {
  background: var(--accent-hover);
}
</style>
