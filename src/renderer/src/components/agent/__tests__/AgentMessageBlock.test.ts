import { describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import AgentMessageBlock from '../AgentMessageBlock.vue'
import type { ChatMessage } from '../../../types/chat'

// 此处只验消息分支和复制入口。
vi.mock('../../chat/MarkdownContent.vue', () => ({ default: { render: () => null } }))

const message: ChatMessage = { id: 'reply', role: 'assistant', text: '## 结论\n\n| 服务 | 端口 |\n| --- | --- |\n| nginx | 80 |', status: 'done', createdAt: '' }

describe('回复卡片的 Markdown 复制入口', () => {
  it.each([
    { isAgentNaturalReply: true },
    { isAgentConclusion: true },
    {}
  ])('当前回复、旧总结以及助手消息都显示复制入口：%j', async flags => {
    const html = await renderToString(createSSRApp(AgentMessageBlock, { msg: { ...message, ...flags } }))
    expect(html).toContain('aria-label="复制 Markdown 原文"')
    expect(html).toContain('复制 Markdown</span>')
    expect(html).not.toContain('disabled')
  })

  it.each([
    { role: 'user' as const, isAgentUserTurn: true },
    { role: 'system' as const, isAgentCard: true, agentCardType: 'thinking' as const }
  ])('用户消息与思考过程不显示结论复制入口：%j', async flags => {
    const html = await renderToString(createSSRApp(AgentMessageBlock, { msg: { ...message, ...flags } }))
    expect(html).not.toContain('aria-label="复制 Markdown 原文"')
  })
})
