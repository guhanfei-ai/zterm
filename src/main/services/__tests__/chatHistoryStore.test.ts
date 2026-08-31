import { describe, expect, it } from 'vitest'
import { normalizeChatHistory, CHAT_HISTORY_VERSION } from '../../model/chatHistory'

describe('chat history schema', () => {
  it('keeps allowlisted message fields and drops runtime state', () => {
    const result = normalizeChatHistory({
      version: CHAT_HISTORY_VERSION,
      savedAt: '2026-08-31T00:00:00.000Z',
      tabs: [{
        id: 'chat-1',
        title: '排查磁盘',
        mode: 'agent',
        messages: [
          {
            id: 'm1',
            role: 'user',
            text: '查看磁盘占用',
            createdAt: '2026-08-31T00:00:01.000Z',
            streaming: true,
            details: { command: 'df -h' },
            thinkingId: 't1',
            apiKey: 'sk-secret'
          }
        ]
      }]
    })

    expect(result.valid).toBe(true)
    if (!result.valid) return
    const message = result.history.tabs[0].messages[0] as unknown as Record<string, unknown>
    expect(message['text']).toBe('查看磁盘占用')
    expect(message['streaming']).toBeUndefined()
    expect(message['details']).toBeUndefined()
    expect(message['thinkingId']).toBeUndefined()
    expect(message['apiKey']).toBeUndefined()
  })

  it('rejects unsupported versions and malformed containers', () => {
    expect(normalizeChatHistory({ version: 99, savedAt: 'x', tabs: [] }).valid).toBe(false)
    expect(normalizeChatHistory(null).valid).toBe(false)
    expect(normalizeChatHistory('nope').valid).toBe(false)
    expect(normalizeChatHistory({ version: CHAT_HISTORY_VERSION }).valid).toBe(false)
  })

  it('truncates oversized message text instead of failing', () => {
    const longText = 'a'.repeat(200 * 1024)
    const result = normalizeChatHistory({
      version: CHAT_HISTORY_VERSION,
      savedAt: '2026-08-31T00:00:00.000Z',
      tabs: [{
        id: 'chat-1',
        title: 't',
        mode: 'chat',
        messages: [{ id: 'm1', role: 'assistant', text: longText, createdAt: '2026-08-31T00:00:00.000Z' }]
      }]
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const text = result.history.tabs[0].messages[0].text
    expect(text.length).toBeLessThan(longText.length)
    expect(text).toContain('已截断')
  })

  it('drops duplicate ids, invalid roles and tabs over the limit', () => {
    const messages = Array.from({ length: 600 }, (_, i) => ({
      id: `m${i}`,
      role: 'user',
      text: 'x',
      createdAt: '2026-08-31T00:00:00.000Z'
    }))
    const result = normalizeChatHistory({
      version: CHAT_HISTORY_VERSION,
      savedAt: '2026-08-31T00:00:00.000Z',
      tabs: [
        { id: 'a', title: 't', mode: 'chat', messages },           // 超过单 tab 上限 → 整个 tab 拒绝
        { id: 'b', title: 't', mode: 'chat', messages: [           // 非法 role → 跳过该条
          { id: 'm1', role: 'hacker', text: 'x', createdAt: '2026-08-31T00:00:00.000Z' },
          { id: 'm2', role: 'user', text: 'x', createdAt: '2026-08-31T00:00:00.000Z' },
          { id: 'm2', role: 'user', text: 'dup', createdAt: '2026-08-31T00:00:00.000Z' }
        ] }
      ]
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.history.tabs).toHaveLength(1)
    expect(result.history.tabs[0].id).toBe('b')
    expect(result.history.tabs[0].messages).toHaveLength(1)
    expect(result.history.tabs[0].messages[0].id).toBe('m2')
  })

  it('keeps agent card markers through normalization', () => {
    const result = normalizeChatHistory({
      version: CHAT_HISTORY_VERSION,
      savedAt: '2026-08-31T00:00:00.000Z',
      tabs: [{
        id: 'chat-1',
        title: 't',
        mode: 'agent',
        messages: [
          { id: 'm1', role: 'system', text: '计划', createdAt: 't', isAgentCard: true, agentCardType: 'plan', stepNumber: 2, bogusCardType: 'hack' }
        ]
      }]
    })
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const message = result.history.tabs[0].messages[0]
    expect(message.isAgentCard).toBe(true)
    expect(message.agentCardType).toBe('plan')
    expect(message.stepNumber).toBe(2)
  })
})
