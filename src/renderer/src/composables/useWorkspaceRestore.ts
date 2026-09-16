import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { WorkspaceSnapshotV1 } from '../../../main/model/workspace'
import { WORKSPACE_SNAPSHOT_VERSION } from '../../../main/model/workspace'
import { useHostsStore } from '@/stores/hosts'
import { useTerminalStore } from '@/stores/terminal'
import { useChatStore } from '@/stores/chat'

export type WorkspaceRestoreDialogState = 'hidden' | 'restore' | 'invalid'

const SAVE_DELAY_MS = 500
const CHAT_HISTORY_SAVE_DELAY_MS = 1500

export function useWorkspaceRestore() {
  const hostsStore = useHostsStore()
  const terminalStore = useTerminalStore()
  const chatStore = useChatStore()
  const dialogState = ref<WorkspaceRestoreDialogState>('hidden')
  const dialogReason = ref('')

  let pendingSnapshot: WorkspaceSnapshotV1 | null = null
  let decisionMade = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let chatSaveTimer: ReturnType<typeof setTimeout> | null = null
  let unsubscribeReconnectTarget: (() => void) | null = null

  function createSnapshot(): WorkspaceSnapshotV1 {
    return {
      version: WORKSPACE_SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      activeMode: hostsStore.activeMode,
      terminalTabs: terminalStore.serializeWorkspaceTabs(),
      activeTerminalTabIds: { ...terminalStore.activeTabIds },
      chatTabs: chatStore.serializeWorkspaceTabs(),
      activeChatTabId: chatStore.activeTabId
    }
  }

  async function saveWorkspace(): Promise<void> {
    if (!decisionMade || dialogState.value !== 'hidden') return
    const result = await window.electronAPI.workspace.save(createSnapshot())
    if (!result.success) {
      console.error('[workspace] 保存工作区失败')
    }
  }

  async function saveChatHistory(): Promise<void> {
    if (!decisionMade || dialogState.value !== 'hidden') return
    const result = await window.electronAPI.chatHistory.save(chatStore.serializeChatHistory())
    if (!result.success) {
      console.error('[chatHistory] 保存聊天历史失败')
    }
  }

  function scheduleSave(): void {
    if (!decisionMade || dialogState.value !== 'hidden') return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void saveWorkspace()
    }, SAVE_DELAY_MS)
  }

  function scheduleChatSave(): void {
    if (!decisionMade || dialogState.value !== 'hidden') return
    if (chatSaveTimer) clearTimeout(chatSaveTimer)
    chatSaveTimer = setTimeout(() => {
      chatSaveTimer = null
      void saveChatHistory()
    }, CHAT_HISTORY_SAVE_DELAY_MS)
  }

  function resetToEmptyWorkspace(): void {
    terminalStore.hydrateWorkspaceTabs([], {
      direct: '',
      jumpserver: '',
      local: ''
    })
    chatStore.hydrateWorkspaceTabs([], new Set<string>(), '')
    hostsStore.setActiveMode('direct')
  }

  async function restoreWorkspace(): Promise<void> {
    if (!pendingSnapshot) return
    const snapshot = pendingSnapshot
    const terminalIds = new Set(snapshot.terminalTabs.map((tab) => tab.id))
    terminalStore.hydrateWorkspaceTabs(snapshot.terminalTabs, snapshot.activeTerminalTabIds)
    chatStore.hydrateWorkspaceTabs(snapshot.chatTabs, terminalIds, snapshot.activeChatTabId)
    hostsStore.setActiveMode(snapshot.activeMode)
    pendingSnapshot = null
    dialogState.value = 'hidden'

    // 工作区恢复后再回填聊天消息：历史缺失或损坏只影响消息正文，
    // 不阻断标签结构本身的恢复
    try {
      const historyResult = await window.electronAPI.chatHistory.load()
      if ('valid' in historyResult && historyResult.valid) {
        chatStore.hydrateChatMessages(historyResult.history)
      }
    } catch {
      console.error('[chatHistory] 恢复聊天历史失败')
    }
    // 历史消息完成回填后再允许保存，避免恢复期间的空状态覆盖磁盘快照。
    decisionMade = true
  }

  async function discardSavedWorkspace(): Promise<void> {
    const result = await window.electronAPI.workspace.clear()
    if (!result.success) {
      dialogReason.value = result.error || '无法丢弃已保存内容'
      return
    }
    // 聊天历史与工作区同生共死：用户明确丢弃时一并清除
    await window.electronAPI.chatHistory.clear()
    // Agent context 独立于工作区文件，需要显式清理，否则重启后会被孤儿认领逻辑复活。
    const contextTabIds = new Set([
      ...snapshotChatTabIds(pendingSnapshot),
      ...chatStore.serializeWorkspaceTabs().map(tab => tab.id)
    ])
    await Promise.all([...contextTabIds].map(chatTabId =>
      window.electronAPI.agent.discardContext({ chatTabId })
    ))
    pendingSnapshot = null
    resetToEmptyWorkspace()
    decisionMade = true
    dialogState.value = 'hidden'
  }

  function snapshotChatTabIds(snapshot: WorkspaceSnapshotV1 | null): string[] {
    return snapshot?.chatTabs.map(tab => tab.id) ?? []
  }

  onMounted(() => {
    unsubscribeReconnectTarget = window.electronAPI.terminal.onReconnectTarget((payload) => {
      if (terminalStore.setReconnectTargetByTabId(payload.tabId, payload.target)) {
        scheduleSave()
      }
    })

    void window.electronAPI.workspace.load().then((result) => {
      if ('found' in result) {
        decisionMade = true
        return
      }
      if (result.recoverable) {
        pendingSnapshot = result.snapshot
        dialogState.value = 'restore'
        return
      }
      dialogReason.value = result.reason
      dialogState.value = 'invalid'
    }).catch(() => {
      dialogReason.value = '读取已保存工作区失败'
      dialogState.value = 'invalid'
    })
  })

  watch(
    [
      () => terminalStore.serializeWorkspaceTabs(),
      () => terminalStore.activeTabIds,
      () => chatStore.serializeWorkspaceTabs(),
      () => chatStore.activeTabId,
      () => hostsStore.activeMode
    ],
    scheduleSave,
    { deep: true }
  )

  // 聊天消息单独去抖保存：watch 只监听轻量信号（消息数 / 流式标志 / 末条状态），
  // 序列化推迟到去抖回调内执行。原实现把 serializeChatHistory() 放进 getter，
  // 流式输出时每个 token 都会触发一次全量 tabs×messages 深拷贝（savedAt 还保证
  // 结果永不相等），长会话下是稳定的 GC 抖动源。
  watch(
    () => chatStore.tabs
      .map(t => `${t.id}:${t.messages.length}:${t.isStreaming ? 1 : 0}:${t.messages[t.messages.length - 1]?.status ?? ''}`)
      .join('|'),
    scheduleChatSave
  )

  onUnmounted(() => {
    if (saveTimer) clearTimeout(saveTimer)
    if (chatSaveTimer) clearTimeout(chatSaveTimer)
    if (unsubscribeReconnectTarget) unsubscribeReconnectTarget()
  })

  return {
    dialogState,
    dialogReason,
    restoreWorkspace,
    discardSavedWorkspace
  }
}
