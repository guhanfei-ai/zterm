import { useHostsStore } from '@/stores/hosts'
import { useTerminalStore } from '@/stores/terminal'
import { useChatStore } from '@/stores/chat'
import { estimateTerminalSize } from '@/utils/terminalSize'

/**
 * Composable that provides tab creation, closing, and disconnect handlers
 * for both terminal and chat tabs.
 */
export function useTabSync() {
  const hostsStore = useHostsStore()
  const terminalStore = useTerminalStore()
  const chatStore = useChatStore()

  /** 终端标签栏新增按钮：本地模式走本地终端创建，其它模式走普通新标签 */
  async function onAddTab(): Promise<void> {
    if (hostsStore.activeMode === 'local') {
      await onAddLocalTab()
    } else {
      terminalStore.addTab(hostsStore.activeMode)
    }
  }

  /** 新建本地终端标签（与 HostList.vue onLocalTerminal 逻辑同源） */
  async function onAddLocalTab(): Promise<void> {
    const targetTabId = terminalStore.addTab('local')
    terminalStore.switchTab(targetTabId)
    terminalStore.setCurrentHostByTabId(targetTabId, '__local__', '本地终端')
    terminalStore.setStatusByTabId(targetTabId, 'connecting')

    const container = document.querySelector('.terminal-container')
    const { cols, rows } = estimateTerminalSize(container as HTMLElement | null)

    const result = await window.electronAPI.terminal.connectLocal(targetTabId, cols, rows)
    if (typeof result.generation === 'number') {
      terminalStore.setGenerationByTabId(targetTabId, result.generation)
    }
    if (!result.success) {
      terminalStore.setErrorByTabId(targetTabId, result.error || '启动本地终端失败')
      terminalStore.setStatusByTabId(targetTabId, 'disconnected')
    }
  }

  async function onCloseTerminalTab(id: string): Promise<void> {
    const tab = terminalStore.getTabById(id)
    if (tab && tab.status !== 'disconnected') {
      await window.electronAPI.terminal.disconnect(id)
    }
    terminalStore.closeTab(id)
  }

  function onCloseChatTab(id: string): void {
    chatStore.closeTab(id)
  }

  async function handleDisconnect(): Promise<void> {
    if (!terminalStore.activeTabId) return
    await window.electronAPI.terminal.disconnect(terminalStore.activeTabId)
  }

  return {
    onAddTab,
    onAddLocalTab,
    onCloseTerminalTab,
    onCloseChatTab,
    handleDisconnect
  }
}
