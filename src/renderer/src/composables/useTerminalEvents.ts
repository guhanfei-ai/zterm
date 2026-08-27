import { onMounted, onUnmounted } from 'vue'
import { useHostsStore } from '@/stores/hosts'
import { useKeysStore } from '@/stores/keys'
import { useTerminalStore } from '@/stores/terminal'
import { useUpdateStore } from '@/stores/update'

/**
 * Composable that manages terminal IPC lifecycle subscriptions
 * (onConnecting/onConnected/onError/onClosed/onShellClosed),
 * initial data fetching, and periodic update checks.
 *
 * All cleanup is handled in onUnmounted.
 */
export function useTerminalEvents() {
  const hostsStore = useHostsStore()
  const keysStore = useKeysStore()
  const terminalStore = useTerminalStore()
  const updateStore = useUpdateStore()

  let cleanupTerminal: (() => void) | null = null
  let checkInterval: ReturnType<typeof setInterval> | null = null
  let initialCheckTimer: ReturnType<typeof setTimeout> | null = null

  onMounted(() => {
    // ---- Register IPC listeners FIRST (synchronous, must always succeed) ----
    const unsubConnecting = window.electronAPI.terminal.onConnecting((payload) => {
      // 不设 generation 前置检查：每个 tabId 是唯一 UUID，旧会话事件不会发到新 tabId；
      // 同 tabId 重连时旧会话已在主进程 createSession 中被 disconnect() 销毁。
      terminalStore.setGenerationByTabId(payload.tabId, payload.generation)
      terminalStore.setStatusByTabId(payload.tabId, 'connecting')
      terminalStore.setErrorByTabId(payload.tabId, null)
    })

    const unsubConnected = window.electronAPI.terminal.onConnected((payload) => {
      if (terminalStore.isGenerationValid(payload.tabId, payload.generation)) {
        terminalStore.setStatusByTabId(payload.tabId, 'connected')
      }
    })

    const unsubError = window.electronAPI.terminal.onError((payload) => {
      if (terminalStore.isGenerationValid(payload.tabId, payload.generation)) {
        terminalStore.setErrorByTabId(payload.tabId, payload.error)
        terminalStore.setStatusByTabId(payload.tabId, 'disconnected')
      }
    })

    const unsubClosed = window.electronAPI.terminal.onClosed((payload) => {
      if (terminalStore.isGenerationValid(payload.tabId, payload.generation)) {
        const tab = terminalStore.getTabById(payload.tabId)
        if (tab?.error) {
          // 保留 error 信息，仅更新 status 和清除连接字段
          terminalStore.setStatusByTabId(payload.tabId, 'disconnected')
          terminalStore.clearConnectionByTabId(payload.tabId)
        } else {
          terminalStore.clearStateByTabId(payload.tabId)
        }
      }
    })

    const unsubShellClosed = window.electronAPI.terminal.onShellClosed((payload) => {
      if (terminalStore.isGenerationValid(payload.tabId, payload.generation)) {
        const exitCode = payload.exitCode
        if (exitCode !== undefined && exitCode !== 0) {
          // 非零退出：设置错误提示
          const signal = payload.signal
          terminalStore.setErrorByTabId(payload.tabId, `本地 shell 进程退出，code=${exitCode}，signal=${signal ?? 'N/A'}`)
          terminalStore.setStatusByTabId(payload.tabId, 'disconnected')
          terminalStore.clearConnectionByTabId(payload.tabId)
        } else {
          terminalStore.clearStateByTabId(payload.tabId)
        }
      }
    })

    cleanupTerminal = () => {
      unsubConnecting()
      unsubConnected()
      unsubError()
      unsubClosed()
      unsubShellClosed()
    }

    // ---- Data fetching (fire-and-forget, errors must not block listeners) ----
    updateStore.fetchCurrentVersion().catch(() => {})
    updateStore.loadDismissedVersion().catch(() => {})
    hostsStore.fetchHosts().catch(() => {})
    keysStore.fetchKeys().catch(() => {})

    // 启动后延迟 3 秒自动静默检查更新
    initialCheckTimer = setTimeout(() => {
      initialCheckTimer = null
      updateStore.silentCheck()
    }, 3000)

    // 每小时静默轮询一次（3600000 ms）
    checkInterval = setInterval(() => {
      updateStore.silentCheck()
    }, 3600000)
  })

  onUnmounted(() => {
    if (cleanupTerminal) {
      cleanupTerminal()
      cleanupTerminal = null
    }
    if (checkInterval) {
      clearInterval(checkInterval)
      checkInterval = null
    }
    if (initialCheckTimer) {
      clearTimeout(initialCheckTimer)
      initialCheckTimer = null
    }
  })
}
