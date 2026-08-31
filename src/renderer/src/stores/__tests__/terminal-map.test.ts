import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTerminalStore } from '../terminal'
import { useHostsStore } from '../hosts'

describe('Terminal Store — Map index', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('addTab — _tabMap synchronization', () => {
    it('should add tab to both tabs array and _tabMap', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      expect(store.tabs.length).toBe(1)
      expect(store.getTabById(tabId)).toBeDefined()
      expect(store.getTabById(tabId)?.id).toBe(tabId)
      expect(store.getTabById(tabId)?.mode).toBe('direct')
    })

    it('should set activeTabId to newly created tab', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      expect(store.activeTabId).toBe(tabId)
    })

    it('should maintain correct map for multiple tabs', () => {
      const store = useTerminalStore()
      const id1 = store.addTab()
      const id2 = store.addTab('local')
      const id3 = store.addTab('jumpserver')

      expect(store.tabs.length).toBe(3)
      expect(store.getTabById(id1)?.id).toBe(id1)
      expect(store.getTabById(id2)?.id).toBe(id2)
      expect(store.getTabById(id3)?.id).toBe(id3)
    })
  })

  describe('closeTab — _tabMap synchronization', () => {
    it('should remove tab from both tabs array and _tabMap', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      expect(store.getTabById(tabId)).toBeDefined()

      store.closeTab(tabId)
      expect(store.tabs.length).toBe(0)
      expect(store.getTabById(tabId)).toBeUndefined()
    })

    it('should remove correct tab when multiple tabs exist', () => {
      const store = useTerminalStore()
      const id1 = store.addTab()
      const id2 = store.addTab('local')
      const id3 = store.addTab()

      store.closeTab(id2)
      expect(store.tabs.length).toBe(2)
      expect(store.getTabById(id1)?.id).toBe(id1)
      expect(store.getTabById(id2)).toBeUndefined()
      expect(store.getTabById(id3)?.id).toBe(id3)
    })

    it('should switch to adjacent tab when closing active tab', () => {
      const store = useTerminalStore()
      const id1 = store.addTab()
      const id2 = store.addTab()

      // Active tab is id2 (last created)
      store.closeTab(id2)
      expect(store.activeTabId).toBe(id1)
    })

    it('should keep other mode active tabs untouched when closing current mode tab', () => {
      const store = useTerminalStore()
      const hostsStore = useHostsStore()
      const directId = store.addTab('direct')
      const localId = store.addTab('local')

      hostsStore.activeMode = 'local'
      expect(store.activeTabId).toBe(localId)

      hostsStore.activeMode = 'direct'
      store.closeTab(directId)
      expect(store.activeTabId).toBe('')

      hostsStore.activeMode = 'local'
      expect(store.activeTabId).toBe(localId)
    })

    it('should handle closing non-existent tab gracefully', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      store.closeTab('nonexistent-id')
      expect(store.tabs.length).toBe(1)
      expect(store.getTabById(tabId)).toBeDefined()
    })
  })

  describe('getTabById — O(1) lookup', () => {
    it('should return undefined for non-existent tabId', () => {
      const store = useTerminalStore()
      expect(store.getTabById('nonexistent')).toBeUndefined()
    })

    it('should return correct tab for existing tabId', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      const tab = store.getTabById(tabId)
      expect(tab).not.toBeUndefined()
      expect(tab?.id).toBe(tabId)
      expect(tab?.status).toBe('disconnected')
      expect(tab?.hostName).toBe('未连接')
    })

    it('should return same tab object reference (Map behavior)', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      const tab1 = store.getTabById(tabId)
      const tab2 = store.getTabById(tabId)
      // Map stores object references, so both calls return the same object
      expect(tab1).toBe(tab2)
    })
  })

  describe('activeTab — computed via _tabMap.get()', () => {
    it('should return undefined when no tabs exist', () => {
      const store = useTerminalStore()
      expect(store.activeTab).toBeUndefined()
    })

    it('should return the active tab object', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      expect(store.activeTab?.id).toBe(tabId)
    })

    it('should update when activeTabId changes via switchTab', () => {
      const store = useTerminalStore()
      const id1 = store.addTab()
      const id2 = store.addTab()
      expect(store.activeTab?.id).toBe(id2)

      store.switchTab(id1)
      expect(store.activeTab?.id).toBe(id1)
    })

    it('should isolate visible tabs and active tab by mode', () => {
      const store = useTerminalStore()
      const hostsStore = useHostsStore()
      const directId = store.addTab('direct')
      const localId = store.addTab('local')
      const jumpId = store.addTab('jumpserver')

      hostsStore.activeMode = 'direct'
      expect(store.visibleTabs.map(tab => tab.id)).toEqual([directId])
      expect(store.activeTab?.id).toBe(directId)

      hostsStore.activeMode = 'local'
      expect(store.visibleTabs.map(tab => tab.id)).toEqual([localId])
      expect(store.activeTab?.id).toBe(localId)

      hostsStore.activeMode = 'jumpserver'
      expect(store.visibleTabs.map(tab => tab.id)).toEqual([jumpId])
      expect(store.activeTab?.id).toBe(jumpId)
    })
  })

  describe('byTabId methods — O(1) via Map', () => {
    it('should setStatusByTabId using Map lookup', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      const result = store.setStatusByTabId(tabId, 'connecting')
      expect(result).toBe(true)
      expect(store.getTabById(tabId)?.status).toBe('connecting')
    })

    it('should return false for setStatusByTabId with invalid tabId', () => {
      const store = useTerminalStore()
      expect(store.setStatusByTabId('invalid', 'connecting')).toBe(false)
    })

    it('should setCurrentHostByTabId using Map lookup', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      const result = store.setCurrentHostByTabId(tabId, 'host-1', 'My Server')
      expect(result).toBe(true)
      expect(store.getTabById(tabId)?.hostId).toBe('host-1')
      expect(store.getTabById(tabId)?.hostName).toBe('My Server')
      expect(store.getTabById(tabId)?.title).toBe('My Server')
    })

    it('should setErrorByTabId using Map lookup', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      const result = store.setErrorByTabId(tabId, 'Connection failed')
      expect(result).toBe(true)
      expect(store.getTabById(tabId)?.error).toBe('Connection failed')
    })

    it('should setRecentOutputByTabId using Map lookup', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      const result = store.setRecentOutputByTabId(tabId, 'output data')
      expect(result).toBe(true)
      expect(store.getTabById(tabId)?.recentOutput).toBe('output data')
    })

    it('should clearStateByTabId using Map lookup', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      store.setCurrentHostByTabId(tabId, 'host-1', 'Server')
      store.setStatusByTabId(tabId, 'connected')
      store.setErrorByTabId(tabId, 'some error')

      store.clearStateByTabId(tabId)
      const tab = store.getTabById(tabId)
      expect(tab?.status).toBe('disconnected')
      expect(tab?.hostId).toBe('host-1')
      expect(tab?.hostName).toBe('Server')
      expect(tab?.error).toBeNull()
      expect(tab?.recentOutput).toBe('')
    })

    it('should clearConnectionByTabId preserving error and status', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      store.setStatusByTabId(tabId, 'disconnected')
      store.setErrorByTabId(tabId, 'Connection timed out')
      store.setCurrentHostByTabId(tabId, 'host-1', 'Server')

      store.clearConnectionByTabId(tabId)
      const tab = store.getTabById(tabId)
      expect(tab?.status).toBe('disconnected') // preserved
      expect(tab?.error).toBe('Connection timed out') // preserved
      expect(tab?.hostId).toBe('host-1') // reconnect metadata preserved
      expect(tab?.hostName).toBe('Server') // reconnect metadata preserved
      expect(tab?.recentOutput).toBe('') // cleared
      expect(tab?.generation).toBe(0) // cleared
    })

    it('should preserve a reconnect target when connection state is cleared', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      store.setCurrentHostByTabId(tabId, 'host-1', 'Server')

      store.clearConnectionByTabId(tabId)

      expect(store.getTabById(tabId)?.reconnectTarget).toEqual({ kind: 'direct', hostId: 'host-1' })
    })

    it('should setGenerationByTabId using Map lookup', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      const result = store.setGenerationByTabId(tabId, 5)
      expect(result).toBe(true)
      expect(store.getTabById(tabId)?.generation).toBe(5)
    })

    it('should reject generation equal to current', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      store.setGenerationByTabId(tabId, 5)
      const result = store.setGenerationByTabId(tabId, 5)
      expect(result).toBe(false)
    })

    it('should reject generation less than current', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      store.setGenerationByTabId(tabId, 10)
      const result = store.setGenerationByTabId(tabId, 5)
      expect(result).toBe(false)
    })

    it('should isGenerationValid return true for matching generation', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      store.setGenerationByTabId(tabId, 7)
      expect(store.isGenerationValid(tabId, 7)).toBe(true)
      expect(store.isGenerationValid(tabId, 6)).toBe(false)
    })

    it('should canAcceptConnectingByTabId accept higher generation', () => {
      const store = useTerminalStore()
      const tabId = store.addTab()
      store.setGenerationByTabId(tabId, 3)
      expect(store.canAcceptConnectingByTabId(tabId, 5)).toBe(true)
      expect(store.canAcceptConnectingByTabId(tabId, 3)).toBe(false)
      expect(store.canAcceptConnectingByTabId(tabId, 1)).toBe(false)
    })
  })

  describe('deprecated methods', () => {
    it('should still work for backward-compatible setStatus', () => {
      const store = useTerminalStore()
      store.addTab()
      // setStatus operates on activeTab
      const result = store.setStatus('connecting')
      expect(result).toBe(true)
      expect(store.activeTab?.status).toBe('connecting')
    })

    it('should return false when no active tab', () => {
      const store = useTerminalStore()
      expect(store.setStatus('connecting')).toBe(false)
    })
  })
})
