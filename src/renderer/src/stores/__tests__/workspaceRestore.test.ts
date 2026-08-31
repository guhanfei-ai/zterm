import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatStore } from '../chat'
import { useTerminalStore } from '../terminal'

describe('workspace store hydration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('hydrates terminal tabs as disconnected without runtime output or generations', () => {
    const terminalStore = useTerminalStore()
    terminalStore.hydrateWorkspaceTabs([
      {
        id: 'terminal-1',
        title: '主机 A',
        defaultTitle: '终端 1',
        mode: 'direct',
        hostId: 'host-1',
        hostName: '主机 A',
        reconnectTarget: { kind: 'direct', hostId: 'host-1' }
      }
    ], { direct: 'terminal-1', jumpserver: '', local: '' })

    const tab = terminalStore.getTabById('terminal-1')
    expect(tab?.status).toBe('disconnected')
    expect(tab?.recentOutput).toBe('')
    expect(tab?.generation).toBe(0)
    expect(tab?.reconnectTarget).toEqual({ kind: 'direct', hostId: 'host-1' })
    expect(terminalStore.activeTabId).toBe('terminal-1')
  })

  it('keeps the reconnect target and title after a disconnect state cleanup', () => {
    const terminalStore = useTerminalStore()
    terminalStore.hydrateWorkspaceTabs([
      {
        id: 'terminal-1',
        title: '主机 A',
        defaultTitle: '终端 1',
        mode: 'direct',
        hostId: 'host-1',
        hostName: '主机 A',
        reconnectTarget: { kind: 'direct', hostId: 'host-1' }
      }
    ], { direct: 'terminal-1', jumpserver: '', local: '' })

    terminalStore.clearStateByTabId('terminal-1')
    const tab = terminalStore.getTabById('terminal-1')
    expect(tab?.title).toBe('主机 A')
    expect(tab?.reconnectTarget).toEqual({ kind: 'direct', hostId: 'host-1' })
  })

  it('hydrates chat metadata while discarding agent and message runtime state', () => {
    const chatStore = useChatStore()
    chatStore.hydrateWorkspaceTabs([
      {
        id: 'chat-1',
        title: '部署讨论',
        mode: 'agent',
        includeTerminalContext: true,
        linkedTerminalTabId: 'terminal-1'
      }
    ], new Set(['terminal-1']), 'chat-1')

    const tab = chatStore.activeTab
    expect(tab.id).toBe('chat-1')
    expect(tab.messages).toEqual([])
    expect(tab.isStreaming).toBe(false)
    expect(tab.agentState).toBe('idle')
    expect(tab.pendingContext).toBeNull()
    expect(tab.linkedTerminalTabId).toBe('terminal-1')
  })
})
