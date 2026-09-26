import { describe, it, expect } from 'vitest'
import { MemorySaver } from '@langchain/langgraph'
import { buildAgentGraph, type AgentGraphCallbacks, type AgentGraphContext } from '../agentGraph'
import { createInitialState, type AgentGraphState, type StopReason } from '../agentGraphState'
import type { AiClient } from '../aiClient'
import type { TerminalBridge } from '../terminalBridge'

// ================================================================
//  背景：Agent 模式输入"你好"，被旧任务语境带着输出 DONE → summarize
//  用旧任务步骤重新生成正式报告（"80 端口健康检查结论"）。
//  对话优先重构（2026-09-16）后该问题结构性消失：
//  没有 summarize 节点，无命令回复即本轮结束，聊天是默认行为。
// ================================================================

interface GraphHarness {
  graph: ReturnType<typeof buildAgentGraph>
  written: string[]
  messages: { type: string; content: string; stepNumber?: number; details?: Record<string, unknown> }[]
  stateChanges: string[]
  onStepCompleteCalls: { conclusion?: string; stopReason?: StopReason }[]
  replyPrompts: string[]
  stats: { replyCalls: number; repairCalls: number }
}

/**
 * 构建带脚本化模型的 graph。
 * reply 与 repair 按 system prompt 特征区分（repair 带「强制执行修正」）。
 */
function buildScriptedGraph(
  replyResponses: string[],
  options?: { repairResponse?: string }
): GraphHarness {
  const written: string[] = []
  const messages: { type: string; content: string; stepNumber?: number; details?: Record<string, unknown> }[] = []
  const stateChanges: string[] = []
  const onStepCompleteCalls: { conclusion?: string; stopReason?: StopReason }[] = []
  const replyPrompts: string[] = []
  const stats = { replyCalls: 0, repairCalls: 0 }

  const aiClient = {
    sendStream: async (
      request: { messages: { role: string; content: string }[] },
      _session: unknown,
      onChunk: (chunk: { text?: string }) => void
    ) => {
      const system = request.messages[0].content
      if (system.includes('强制执行修正')) {
        stats.repairCalls++
        onChunk({ text: options?.repairResponse ?? 'PLAN: 查看运行服务\nCOMMAND: ps aux' })
        return
      }
      stats.replyCalls++
      replyPrompts.push(request.messages[1].content)
      const reply = replyResponses[Math.min(stats.replyCalls - 1, replyResponses.length - 1)]
      onChunk({ text: reply })
    }
  } as unknown as AiClient

  const terminalSession = {}
  const bridge = {
    isConnected: () => true,
    isDisposed: () => false,
    getTerminalLockKey: () => terminalSession,
    executeAgentCommand: async (cmd: string) => {
      written.push(cmd)
      return { command: cmd, output: 'mock output', duration: 1, completion: 'verified', commandSent: true, exitCode: 0 }
    }
  } as unknown as TerminalBridge

  const callbacks: AgentGraphCallbacks = {
    emitMessage: (msg) => {
      messages.push({ type: msg.type, content: msg.content, stepNumber: msg.stepNumber, details: msg.details })
    },
    emitStateChange: (phase) => { stateChanges.push(phase) },
    getTerminalContext: () => null,
    onStepComplete: (data) => { onStepCompleteCalls.push({ conclusion: data.conclusion, stopReason: data.stopReason }) }
  }

  const ctx: AgentGraphContext = {
    bridge,
    aiClient,
    callbacks,
    abortController: new AbortController()
  }

  return {
    graph: buildAgentGraph(ctx, new MemorySaver()),
    written,
    messages,
    stateChanges,
    onStepCompleteCalls,
    replyPrompts,
    stats
  }
}

async function invokeGraph(
  graph: ReturnType<typeof buildAgentGraph>,
  initialState: AgentGraphState
): Promise<void> {
  await graph.invoke(initialState, {
    configurable: { thread_id: initialState.chatTabId },
    recursionLimit: 100
  })
}

/** 旧任务"检查 80 端口"已完成一步后的 follow-up 场景 */
function buildFollowupGreetingState(): AgentGraphState {
  const state = createInitialState()
  state.taskDescription = '检查 80 端口'
  state.userMessage = '你好'
  state.chatTabId = 't-chatty-followup'
  state.maxSteps = 25
  state.steps = [{
    stepNumber: 1,
    plan: '检查 80 端口监听',
    command: 'ss -tlpn',
    commandOutput: 'LISTEN 0 128 *:80',
    observation: '80 端口正常监听',
    status: 'done'
  }]
  state.currentStep = 1
  state.turnStartStepCount = 1
  state.conversationHistory = [
    { role: 'user', content: '检查 80 端口', createdAt: new Date().toISOString() },
    { role: 'assistant', content: '80 端口正常监听。', isFromExecution: true, createdAt: new Date().toISOString() },
    { role: 'user', content: '你好', createdAt: new Date().toISOString() }
  ]
  return state
}

describe('agent graph chat-first turns', () => {
  it('follow-up greeting: chat reply only — no commands, no conclusion card, idle', async () => {
    const { graph, written, messages, stateChanges } = buildScriptedGraph([
      '你好！我在。刚才 80 端口查过了是正常的，还需要我看点别的吗？'
    ])

    await invokeGraph(graph, buildFollowupGreetingState())

    // 不执行任何命令、不生成正式总结卡片（修复前会冒出"80 端口健康检查结论"）
    expect(written).toEqual([])
    expect(messages.some(m => m.type === 'conclusion')).toBe(false)
    // 直接聊天回复
    const reply = messages.find(m => m.type === 'assistant_reply')
    expect(reply).toBeDefined()
    expect(reply!.content).toContain('还需要我看点别的吗')
    // 本轮没干活 → idle 收尾，不出现"本轮完成"文案
    expect(stateChanges[stateChanges.length - 1]).toBe('idle')
    expect(messages.some(m => m.type === 'status' && m.content.startsWith('本轮完成'))).toBe(false)
  })

  it('legacy DONE habit on greeting is stripped and answered as chat', async () => {
    // 模型仍按旧协议输出 DONE: 前缀 —— 剥掉后按普通聊天回复处理
    const { graph, written, messages, stateChanges } = buildScriptedGraph([
      'DONE: 你好呀！需要我帮你看看这台服务器吗？'
    ])

    await invokeGraph(graph, buildFollowupGreetingState())

    expect(written).toEqual([])
    expect(messages.some(m => m.type === 'conclusion')).toBe(false)
    const reply = messages.find(m => m.type === 'assistant_reply')
    expect(reply).toBeDefined()
    expect(reply!.content).toBe('你好呀！需要我帮你看看这台服务器吗？')
    expect(reply!.content).not.toMatch(/^DONE/)
    expect(stateChanges[stateChanges.length - 1]).toBe('idle')
  })

  it('first-turn inspection request with chatty DONE still gathers evidence first', async () => {
    // 执行纪律回归：首轮检查型请求即使模型想直接闲聊收尾，也必须先取证
    const h = buildScriptedGraph([
      'DONE: 应该是在跑 java 吧',           // reply#1：想直接给结论
      '主要是 java 和 sshd 在跑。'           // reply#2：取证后的最终回复
    ])
    const { graph, written, messages, stateChanges, onStepCompleteCalls } = h

    const initialState = createInitialState()
    initialState.taskDescription = '看看机器上跑了什么服务'
    initialState.userMessage = '看看机器上跑了什么服务'
    initialState.chatTabId = 't-inspection-guard'
    initialState.maxSteps = 25

    await invokeGraph(graph, initialState)

    // repair 强制取证命令被执行
    expect(written).toEqual(['ps aux'])
    expect(h.stats.replyCalls).toBe(2)
    expect(h.stats.repairCalls).toBe(1)
    // 取证前的草率结论不应作为聊天气泡出现
    const replies = messages.filter(m => m.type === 'assistant_reply')
    expect(replies).toHaveLength(1)
    expect(replies[0].content).toContain('主要是 java 和 sshd')
    // 本轮执行过 1 条命令 → completed + 完成文案 + conclusion 持久化为最终回复
    expect(stateChanges[stateChanges.length - 1]).toBe('completed')
    expect(messages.some(m => m.type === 'status' && m.content === '本轮完成，共执行 1 条命令')).toBe(true)
    const completedCall = onStepCompleteCalls.find(c => c.stopReason === 'COMPLETED')
    expect(completedCall?.conclusion).toBe('主要是 java 和 sshd 在跑。')
  })

  it('blocked command feeds back into the conversation and the model adjusts', async () => {
    // 拦截反馈作为工具回合进对话：reply 看得到"为什么被拦"并调整方案，不再原样重试
    const h = buildScriptedGraph([
      '好的，我来执行。\nPLAN: 执行用户要求的命令\nCOMMAND: foo-bar-qux',
      '这条命令不认识，没法执行。你是想看什么？我可以帮你查进程或日志。'
    ])
    const { graph, written, messages, stateChanges, replyPrompts } = h

    const initialState = createInitialState()
    initialState.taskDescription = '帮我跑一下 foo-bar-qux'
    initialState.userMessage = '帮我跑一下 foo-bar-qux'
    initialState.chatTabId = 't-blocked-feedback'
    initialState.maxSteps = 25

    await invokeGraph(graph, initialState)

    // 命令被拦截，从未真正执行
    expect(written).toEqual([])
    // 拦截错误卡片出现，且带命令（供前端终结 execution 卡 + 工具回合持久化）
    const error = messages.find(m => m.type === 'error')
    expect(error).toBeDefined()
    expect(error!.content).toContain('被拦截')
    expect(error!.details?.command).toBe('foo-bar-qux')
    // 第二次 reply 的 prompt 里能看到拦截反馈（对话是上下文主轴）
    expect(replyPrompts[1]).toContain('被拦截')
    expect(replyPrompts[1]).toContain('foo-bar-qux')
    // 模型调整后以聊天收尾（本轮没有成功执行的命令 → idle）
    expect(h.stats.replyCalls).toBe(2)
    expect(stateChanges[stateChanges.length - 1]).toBe('idle')
    const reply = messages.find(m => m.type === 'assistant_reply' && m.content.includes('没法执行'))
    expect(reply).toBeDefined()
  })

  it('greeting then work in the same conversation keeps task context via history', async () => {
    // 聊天与干活在同一对话里自然切换：问候被正常回复；紧接着的工作请求基于历史接续
    const { graph, written, messages } = buildScriptedGraph([
      '你好！我在的，有什么需要我帮忙的？',
      '好的，我看下磁盘占用。\nPLAN: 查看磁盘\nCOMMAND: df -h',
      '磁盘用了 80%，/var/log 是大头，建议清理。'
    ])

    // 第一轮：纯问候
    const s1 = createInitialState()
    s1.taskDescription = '你好'
    s1.userMessage = '你好'
    s1.chatTabId = 't-greet-then-work'
    s1.maxSteps = 25
    s1.conversationHistory = [
      { role: 'user', content: '你好', createdAt: new Date().toISOString() }
    ]
    await invokeGraph(graph, s1)
    expect(written).toEqual([])

    // 第二轮：follow-up 工作请求（带第一轮对话历史）
    const s2 = createInitialState()
    s2.taskDescription = '你好'
    s2.userMessage = '帮我看看磁盘占用'
    s2.chatTabId = 't-greet-then-work'
    s2.maxSteps = 25
    s2.turnStartStepCount = 0
    s2.conversationHistory = [
      { role: 'user', content: '你好', createdAt: new Date().toISOString() },
      { role: 'assistant', content: '你好！我在的，有什么需要我帮忙的？', createdAt: new Date().toISOString() },
      { role: 'user', content: '帮我看看磁盘占用', createdAt: new Date().toISOString() }
    ]
    await invokeGraph(graph, s2)

    // 第二轮真实执行了命令并给出结论性回复
    expect(written).toEqual(['df -h'])
    const finalReply = messages.find(m => m.type === 'assistant_reply' && m.content.includes('80%'))
    expect(finalReply).toBeDefined()
  })
})
