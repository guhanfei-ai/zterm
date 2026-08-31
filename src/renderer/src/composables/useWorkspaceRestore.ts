import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { WorkspaceSnapshotV1 } from '../../../main/model/workspace'
import { WORKSPACE_SNAPSHOT_VERSION } from '../../../main/model/workspace'
import { useHostsStore } from '@/stores/hosts'
import { useTerminalStore } from '@/stores/terminal'
import { useChatStore } from '@/stores/chat'

export type WorkspaceRestoreDialogState = 'hidden' | 'restore' | 'invalid'

const SAVE_DELAY_MS = 500

export function useWorkspaceRestore() {
  const hostsStore = useHostsStore()
  const terminalStore = useTerminalStore()
  const chatStore = useChatStore()
  const dialogState = ref<WorkspaceRestoreDialogState>('hidden')
  const dialogReason = ref('')

  let pendingSnapshot: WorkspaceSnapshotV1 | null = null
  let decisionMade = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
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

  function scheduleSave(): void {
    if (!decisionMade || dialogState.value !== 'hidden') return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void saveWorkspace()
    }, SAVE_DELAY_MS)
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
  }

  async function discardSavedWorkspace(): Promise<void> {
    const result = await window.electronAPI.workspace.clear()
    if (!result.success) {
      dialogReason.value = result.error || '无法丢弃已保存内容'
      return
    }
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

  onUnmounted(() => {
    if (saveTimer) clearTimeout(saveTimer)
    if (unsubscribeReconnectTarget) unsubscribeReconnectTarget()
  })

  return {
    dialogState,
    dialogReason,
    restoreWorkspace,
    discardSavedWorkspace
  }
}
