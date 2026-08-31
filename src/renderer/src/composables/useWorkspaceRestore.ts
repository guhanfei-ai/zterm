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
    decisionMade = true
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
  }

  async function discardSavedWorkspace(): Promise<void> {
    const result = await window.electronAPI.workspace.clear()
    if (!result.success) {
      dialogReason.value = result.error || '无法丢弃已保存内容'
      return
    }
    // 聊天历史与工作区同生共死：用户明确丢弃时一并清除
    await window.electronAPI.chatHistory.clear()
    pendingSnapshot = null
    resetToEmptyWorkspace()
    decisionMade = true
    dialogState.value = 'hidden'
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

  // 聊天消息单独去抖保存：流式输出期间消息体高频变化，用更长间隔合并写入
  watch(
    () => chatStore.serializeChatHistory(),
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
