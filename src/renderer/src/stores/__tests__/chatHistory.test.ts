import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatStore } from '../chat'

describe('chat history serialization model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('serializes messages while dropping runtime and sensitive fields', () => {
    const chatStore = useChatStore()
    const tab = chatStore.activeTab
    tab.messages.push(
      {
        id: 'm1',
        role: 'user',
        text: '帮我查一下磁盘',
        status: 'done',
        createdAt: '2026-08-31T00:00:00.000Z'
      },
      {
        id: 'm2',
        role: 'system',
        text: '执行 df -h',
        status: 'done',
        createdAt: '2026-08-31T00:00:01.000Z',
        isAgentCard: true,
        agentCardType: 'execution',
        stepNumber: 1,
        streaming: false,
        collapsed: true,
        thinkingId: 't1',
        details: { command: 'df -h', running: false }
      }
    )

    const history = chatStore.serializeChatHistory()
    expect(history.version).toBe(1)
    expect(history.tabs).toHaveLength(1)
    const serialized = history.tabs[0].messages[1] as unknown as Record<string, unknown>
    expect(serialized['isAgentCard']).toBe(true)
    expect(serialized['agentCardType']).toBe('execution')
    expect(serialized['stepNumber']).toBe(1)
    // 运行态与卡片 details 不允许进入持久化
    expect(serialized['streaming']).toBeUndefined()
    expect(serialized['collapsed']).toBeUndefined()
    expect(serialized['thinkingId']).toBeUndefined()
    expect(serialized['details']).toBeUndefined()
  })

  it('hydrates messages only into empty tabs and marks them done', () => {
    const chatStore = useChatStore()
    const tab = chatStore.activeTab
    tab.messages.push({
      id: 'existing',
      role: 'user',
      text: '已有消息',
      status: 'done',
      createdAt: '2026-08-31T00:00:00.000Z'
    })

    chatStore.hydrateChatMessages({
      version: 1,
      savedAt: '2026-08-31T00:00:02.000Z',
      tabs: [
        {
          id: tab.id,
          title: tab.title,
          mode: 'agent',
          messages: [
            {
              id: 'm1',
              role: 'user',
              text: '历史消息',
              createdAt: '2026-08-30T00:00:00.000Z'
            },
            {
              id: 'm2',
              role: 'assistant',
              text: '思考结论',
              createdAt: '2026-08-30T00:00:01.000Z',
              isAgentCard: true,
              agentCardType: 'thinking'
            }
          ]
        },
        {
          // 工作区中已不存在的 tab：应被忽略
          id: 'missing-tab',
          title: '已关闭',
          mode: 'chat',
          messages: []
        }
      ]
    })

    // 已有消息的 tab 不被覆盖
    expect(tab.messages).toHaveLength(1)
    expect(tab.messages[0].id).toBe('existing')

    // 空标签可正常回填，thinking 卡片默认折叠
    chatStore.hydrateWorkspaceTabs(
      [
        { id: 'chat-2', title: '新标签', mode: 'chat', includeTerminalContext: false, linkedTerminalTabId: null },
        { id: 'chat-3', title: '历史标签', mode: 'agent', includeTerminalContext: false, linkedTerminalTabId: null }
      ],
      new Set(),
      'chat-2'
    )
    // 先恢复一个空标签结构再回填
    chatStore.hydrateChatMessages({
      version: 1,
      savedAt: '2026-08-31T00:00:03.000Z',
      tabs: [
        {
          id: 'chat-3',
          title: '历史标签',
          mode: 'agent',
          messages: [
            { id: 'h1', role: 'user', text: '历史问题', createdAt: '2026-08-29T00:00:00.000Z' }
          ]
        }
      ]
    })
    const restored = chatStore.tabs.find((t) => t.id === 'chat-3')
    expect(restored?.messages).toHaveLength(1)
    expect(restored?.messages[0].status).toBe('done')
  })

  it('clearAllMessages empties every tab', () => {
    const chatStore = useChatStore()
    chatStore.addTab()
    for (const tab of chatStore.tabs) {
      tab.messages.push({
        id: `msg-${tab.id}`,
        role: 'user',
        text: 'x',
        status: 'done',
        createdAt: '2026-08-31T00:00:00.000Z'
      })
    }
    chatStore.clearAllMessages()
    for (const tab of chatStore.tabs) {
      expect(tab.messages).toHaveLength(0)
    }
  })
})
