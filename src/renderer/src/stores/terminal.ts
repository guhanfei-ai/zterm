import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { useHostsStore, type ActiveMode } from './hosts'
import type { ReconnectTarget, TerminalTabSnapshot } from '../../../main/model/workspace'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

export interface TerminalTab {
  id: string
  title: string
  /** 本 tab 创建时分配的默认标题；断开后 title 恢复为它，避免按位置重算导致重号 */
  defaultTitle: string
  status: ConnectionStatus
  hostId: string | null
  hostName: string
  error: string | null
  recentOutput: string
  generation: number // 当前标签绑定的真实连接代际，由主进程生成
  mode: ActiveMode
  reconnectTarget: ReconnectTarget | null
}

function createTerminalTab(mode: ActiveMode, override?: Partial<TerminalTab>): TerminalTab {
  return {
    id: uuidv4(),
    title: '终端',
    defaultTitle: '终端',
    status: 'disconnected',
    hostId: null,
    hostName: '未连接',
    error: null,
    recentOutput: '',
    generation: 0,
    mode,
    reconnectTarget: null,
    ...override
  }
}

export const useTerminalStore = defineStore('terminal', () => {
  const hostsStore = useHostsStore()
  const tabs = ref<TerminalTab[]>([])
  const activeTabIds = ref<Record<ActiveMode, string>>({
    direct: '',
    jumpserver: '',
    local: ''
  })

  // ---- Internal Map index for O(1) tab lookup ----
  const _tabMap = new Map<string, TerminalTab>()

  // 单调递增的标题编号（关闭中间标签后新建不重号）
  let tabSerial = 0

  /** Public: get a tab by its id in O(1) */
  function getTabById(id: string): TerminalTab | undefined {
    return _tabMap.get(id)
  }

  function getTabsByMode(mode: ActiveMode): TerminalTab[] {
    return tabs.value.filter(tab => tab.mode === mode)
  }

  function getDefaultTabTitle(mode: ActiveMode, tabId?: string): string {
    const modeTabs = getTabsByMode(mode)
    if (!tabId) {
      // 单调递增编号：关闭中间标签后新建不与既有标签重号
      return `终端 ${++tabSerial}`
    }
    // 重置场景：恢复该 tab 创建时分配的默认标题（而非按当前位置重算，避免重号）
    const tab = modeTabs.find(t => t.id === tabId)
    if (tab?.defaultTitle) return tab.defaultTitle
    return `终端 ${++tabSerial}`
  }

  function getActiveTabIdByMode(mode: ActiveMode): string {
    const activeId = activeTabIds.value[mode]
    const activeTab = activeId ? _tabMap.get(activeId) : undefined
    if (activeTab?.mode === mode) {
      return activeId
    }
    return getTabsByMode(mode)[0]?.id || ''
  }

  function getActiveTabByMode(mode: ActiveMode): TerminalTab | undefined {
    const id = getActiveTabIdByMode(mode)
    return id ? _tabMap.get(id) : undefined
  }

  const visibleTabs = computed(() => getTabsByMode(hostsStore.activeMode))
  const activeTabId = computed(() => getActiveTabIdByMode(hostsStore.activeMode))
  const activeTab = computed(() => getActiveTabByMode(hostsStore.activeMode))

  // ---- Compatibility accessors (used by existing components) ----
  const status = computed(() => activeTab.value?.status || 'disconnected')
  const currentHostId = computed(() => activeTab.value?.hostId ?? null)
  const currentHostName = computed(() => activeTab.value?.hostName || '未连接')
  const error = computed(() => activeTab.value?.error ?? null)
  const recentOutput = computed(() => activeTab.value?.recentOutput || '')

  // ---- Tab management ----
  function addTab(mode: ActiveMode = hostsStore.activeMode): string {
    const tab = createTerminalTab(mode, { title: getDefaultTabTitle(mode) })
    tab.defaultTitle = tab.title
    tabs.value.push(tab)
    // Store the reactive proxy from the array, not the raw object
    _tabMap.set(tab.id, tabs.value[tabs.value.length - 1])
    activeTabIds.value[mode] = tab.id
    return tab.id
  }

  function switchTab(id: string): void {
    const tab = _tabMap.get(id)
    if (tab) {
      activeTabIds.value[tab.mode] = id
    }
  }

  function closeTab(id: string): void {
    const idx = tabs.value.findIndex(t => t.id === id)
    if (idx < 0) return
    const tab = tabs.value[idx]
    const modeTabsBeforeClose = getTabsByMode(tab.mode)
    const modeIndex = modeTabsBeforeClose.findIndex(item => item.id === id)
    tabs.value.splice(idx, 1)
    _tabMap.delete(id)
    // 如果关闭的是当前模式的活动标签，切换到该模式相邻标签
    if (activeTabIds.value[tab.mode] === id) {
      const modeTabsAfterClose = getTabsByMode(tab.mode)
      const newIdx = Math.min(modeIndex, modeTabsAfterClose.length - 1)
      activeTabIds.value[tab.mode] = modeTabsAfterClose[newIdx]?.id || ''
    }
  }

  // ---- State mutation helpers (activeTab) — return boolean ----
  /**
   * @deprecated Use setStatusByTabId(tabId, status) instead for multi-tab safety.
   */
  function setStatus(s: ConnectionStatus): boolean {
    const tab = activeTab.value
    if (!tab) return false
    tab.status = s
    return true
  }

  /**
   * @deprecated Use setCurrentHostByTabId(tabId, hostId, hostName) instead for multi-tab safety.
   */
  function setCurrentHost(hostId: string | null, hostName?: string): boolean {
    const tab = activeTab.value
    if (!tab) return false
    tab.hostId = hostId
    tab.hostName = hostName || '未连接'
    if (hostName) {
      tab.title = hostName
    }
    if (hostId === '__local__') {
      tab.reconnectTarget = { kind: 'local' }
    } else if (hostId) {
      tab.reconnectTarget = { kind: 'direct', hostId }
    }
    return true
  }

  /**
   * @deprecated Use setErrorByTabId(tabId, err) instead for multi-tab safety.
   */
  function setError(err: string | null): boolean {
    const tab = activeTab.value
    if (!tab) return false
    tab.error = err
    return true
  }

  /**
   * @deprecated Use setRecentOutputByTabId(tabId, output) instead for multi-tab safety.
   */
  function setRecentOutput(output: string): boolean {
    const tab = activeTab.value
    if (!tab) return false
    tab.recentOutput = output
    return true
  }

  /**
   * @deprecated Use clearStateByTabId(tabId) instead for multi-tab safety.
   */
  function clearState(): boolean {
    const tab = activeTab.value
    if (!tab) return false
    tab.status = 'disconnected'
    tab.hostId = null
    tab.hostName = '未连接'
    tab.error = null
    tab.recentOutput = ''
    if (!tab.reconnectTarget) {
      tab.title = getDefaultTabTitle(tab.mode, tab.id)
    }
    return true
  }

  // ---- State mutation by tabId (multi-tab safe) — O(1) via _tabMap ----
  function setStatusByTabId(tabId: string, s: ConnectionStatus): boolean {
    const tab = _tabMap.get(tabId)
    if (!tab) return false
    tab.status = s
    return true
  }

  function setCurrentHostByTabId(tabId: string, hostId: string | null, hostName?: string): boolean {
    const tab = _tabMap.get(tabId)
    if (!tab) return false
    tab.hostId = hostId
    tab.hostName = hostName || '未连接'
    if (hostName) {
      tab.title = hostName
    }
    if (hostId === '__local__') {
      tab.reconnectTarget = { kind: 'local' }
    } else if (hostId) {
      tab.reconnectTarget = { kind: 'direct', hostId }
    }
    return true
  }

  function setReconnectTargetByTabId(tabId: string, target: ReconnectTarget): boolean {
    const tab = _tabMap.get(tabId)
    if (!tab) return false
    tab.reconnectTarget = target
    return true
  }

  function setErrorByTabId(tabId: string, err: string | null): boolean {
    const tab = _tabMap.get(tabId)
    if (!tab) return false
    tab.error = err
    return true
  }

  function setRecentOutputByTabId(tabId: string, output: string): boolean {
    const tab = _tabMap.get(tabId)
    if (!tab) return false
    tab.recentOutput = output
    return true
  }

  /** 清除运行时连接字段，保留可重连标签的安全身份元数据。 */
  function clearConnectionByTabId(tabId: string): boolean {
    const tab = _tabMap.get(tabId)
    if (!tab) return false
    if (!tab.reconnectTarget) {
      tab.hostId = null
      tab.hostName = '未连接'
    }
    tab.recentOutput = ''
    tab.generation = 0
    return true
  }

  function clearStateByTabId(tabId: string): boolean {
    const tab = _tabMap.get(tabId)
    if (!tab) return false
    tab.status = 'disconnected'
    tab.error = null
    tab.recentOutput = ''
    if (!tab.reconnectTarget) {
      tab.hostId = null
      tab.hostName = '未连接'
      tab.title = getDefaultTabTitle(tab.mode, tab.id)
    }
    return true
  }

  function serializeWorkspaceTabs(): TerminalTabSnapshot[] {
    return tabs.value.map((tab) => ({
      id: tab.id,
      title: tab.title,
      defaultTitle: tab.defaultTitle,
      mode: tab.mode,
      hostId: tab.hostId,
      hostName: tab.hostName,
      reconnectTarget: tab.reconnectTarget ? { ...tab.reconnectTarget } : null
    }))
  }

  function hydrateWorkspaceTabs(
    snapshots: TerminalTabSnapshot[],
    restoredActiveTabIds: Record<ActiveMode, string>
  ): void {
    const hydrated = snapshots.map((snapshot) => createTerminalTab(snapshot.mode, {
      id: snapshot.id,
      title: snapshot.title,
      defaultTitle: snapshot.defaultTitle,
      hostId: snapshot.hostId,
      hostName: snapshot.hostName,
      reconnectTarget: snapshot.reconnectTarget ? { ...snapshot.reconnectTarget } : null,
      status: 'disconnected',
      error: null,
      recentOutput: '',
      generation: 0
    }))

    tabs.value.splice(0, tabs.value.length, ...hydrated)
    _tabMap.clear()
    for (const tab of tabs.value) {
      _tabMap.set(tab.id, tab)
    }
    activeTabIds.value = {
      direct: restoredActiveTabIds.direct,
      jumpserver: restoredActiveTabIds.jumpserver,
      local: restoredActiveTabIds.local
    }
    tabSerial = Math.max(
      0,
      ...tabs.value.map((tab) => {
        const match = tab.defaultTitle.match(/(\d+)$/)
        return match ? Number(match[1]) : 0
      })
    )
  }

  function setGenerationByTabId(tabId: string, generation: number): boolean {
    const tab = _tabMap.get(tabId)
    if (!tab || generation <= tab.generation) return false
    tab.generation = generation
    return true
  }

  function canAcceptConnectingByTabId(tabId: string, generation: number): boolean {
    const tab = _tabMap.get(tabId)
    if (!tab) return false
    // 只看 generation：状态切换是 onConnecting 回调的职责，不是本函数的职责。
    // 否则首次连接时 onConnecting 还没把 status 改成 'connecting'，永远会被本函数拦掉。
    return generation > tab.generation
  }

  function isGenerationValid(tabId: string, generation: number): boolean {
    const tab = _tabMap.get(tabId)
    if (!tab) return false
    return tab.generation === generation
  }

  return {
    tabs,
    visibleTabs,
    activeTabIds,
    activeTabId,
    activeTab,
    // Compatibility
    status,
    currentHostId,
    currentHostName,
    error,
    recentOutput,
    // Tab management
    addTab,
    switchTab,
    closeTab,
    // Public O(1) lookup
    getTabById,
    getTabsByMode,
    getActiveTabIdByMode,
    getActiveTabByMode,
    // State mutation (activeTab) — boolean return
    setStatus,
    setCurrentHost,
    setError,
    setRecentOutput,
    clearState,
    // State mutation by tabId — boolean return, O(1) via Map
    setStatusByTabId,
    setCurrentHostByTabId,
    setReconnectTargetByTabId,
    setErrorByTabId,
    setRecentOutputByTabId,
    clearStateByTabId,
    clearConnectionByTabId,
    setGenerationByTabId,
    canAcceptConnectingByTabId,
    isGenerationValid,
    serializeWorkspaceTabs,
    hydrateWorkspaceTabs
  }
})
