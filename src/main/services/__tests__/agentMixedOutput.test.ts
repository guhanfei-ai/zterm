import { describe, it, expect } from 'vitest'
import { MemorySaver } from '@langchain/langgraph'
import { parseAIResponse, stripProtocolLines } from '../agentGraphPrompt'
import { buildAgentGraph, type AgentGraphCallbacks, type AgentGraphContext } from '../agentGraph'
import { createInitialState, type StopReason } from '../agentGraphState'
import type { AiClient } from '../aiClient'
import type { TerminalBridge } from '../terminalBridge'

// ================================================================
//  parseAIResponse — 说+干混合输出 / 多命令队列（协议解析不变）
// ================================================================
describe('parseAIResponse', () => {
  it('parses a single PLAN + COMMAND pair (backward compatible)', () => {
    const r = parseAIResponse('PLAN: 查看磁盘\nCOMMAND: df -h')
    expect(r.commands).toEqual([{ plan: '查看磁盘', command: 'df -h' }])
    expect(r.command).toBe('df -h')
    expect(r.plan).toBe('查看磁盘')
    expect(r.done).toBeUndefined()
  })

  it('parses natural language mixed with multiple commands', () => {
    const text = [
      '我先看一下磁盘和内存的使用情况，再给你解释。',
      'PLAN: 查看磁盘占用',
      'COMMAND: df -h',
      'PLAN: 查看内存占用',
      'COMMAND: free -h'
    ].join('\n')
    const r = parseAIResponse(text)
    expect(r.commands).toEqual([
      { plan: '查看磁盘占用', command: 'df -h' },
      { plan: '查看内存占用', command: 'free -h' }
    ])
    expect(r.command).toBe('df -h')
  })

  it('treats pure chat as no commands', () => {
    const r = parseAIResponse('这台机器看起来运行正常，无需操作。')
    expect(r.commands).toEqual([])
    expect(r.command).toBeUndefined()
  })

  it('short-circuits on DONE even with trailing text (legacy habit compat)', () => {
    const r = parseAIResponse('DONE: 任务完成\nCOMMAND: df -h')
    expect(r.done).toBe(true)
    expect(r.commands).toEqual([])
  })

  it('keeps multi-line command body until the next protocol line', () => {
    const text = 'PLAN: 组合查询\nCOMMAND: ps aux | head -5\nfree -h\nPLAN: 下一步\nCOMMAND: uptime'
    const r = parseAIResponse(text)
    expect(r.commands).toEqual([
      { plan: '组合查询', command: 'ps aux | head -5\nfree -h' },
      { plan: '下一步', command: 'uptime' }
    ])
  })

  it('does not split on protocol-like text mid-line', () => {
    const r = parseAIResponse('COMMAND: echo "PLAN: 不是协议行"')
    expect(r.commands).toEqual([{ plan: undefined, command: 'echo "PLAN: 不是协议行"' }])
  })

  it('filters out placeholder commands', () => {
    const r = parseAIResponse('PLAN: 无需执行\nCOMMAND: (无命令)')
    expect(r.commands).toEqual([])
  })
})

// ================================================================
//  stripProtocolLines — 聊天气泡只保留自然语言
// ================================================================
describe('stripProtocolLines', () => {
  it('removes protocol lines and keeps natural language', () => {
    const text = [
      '我先看一下磁盘和内存。',
      'PLAN: 查看磁盘',
      'COMMAND: df -h',
      'PLAN: 查看内存',
      'COMMAND: free -h'
    ].join('\n')
    expect(stripProtocolLines(text)).toBe('我先看一下磁盘和内存。')
  })

  it('strips multi-line command blocks', () => {
    const text = '说明文字\nCOMMAND: ps aux\n| head -5\nDONE: 收尾结论'
    expect(stripProtocolLines(text)).toBe('说明文字')
  })

  it('returns empty string for protocol-only output', () => {
    expect(stripProtocolLines('PLAN: a\nCOMMAND: b')).toBe('')
  })
})

// ================================================================
//  图级流程：reply 主循环（对话优先重构）
//  - think/analyze/summarize 已收敛为 reply 单节点：
//    2 条命令只需 2 次 reply 模型调用（旧架构需 think×1 + analyze×2 + summarize×1 = 4 次）
//  - 观察结果作为工具回合回填对话，第二次 reply 能看到
// ================================================================
describe('agent graph reply loop (chat-first)', () => {
  function buildScriptedGraph(
    replyResponses: string[],
    options?: {
      repairResponse?: string
      maxSteps?: number
      commandResult?: {
        completion: 'verified' | 'timedOut' | 'aborted' | 'disconnected' | 'unsupported'
        commandSent: boolean
        exitCode?: number
      }
      persistExecutingError?: boolean
      commandResults?: Record<string, { output: string; exitCode: number }>
    }
  ): {
    graph: ReturnType<typeof buildAgentGraph>
    written: string[]
    messages: { type: string; content: string; stepNumber?: number; details?: Record<string, unknown> }[]
    stateChanges: string[]
    onStepCompleteCalls: { conclusion?: string; stopReason?: StopReason }[]
    replyPrompts: string[]
    stats: { replyCalls: number; repairCalls: number }
  } {
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
        return {
          command: cmd,
          output: options?.commandResults?.[cmd]?.output ?? 'mock output',
          duration: 1,
          completion: options?.commandResult?.completion ?? 'verified',
          commandSent: options?.commandResult?.commandSent ?? true,
          exitCode: options?.commandResults?.[cmd]?.exitCode ?? options?.commandResult?.exitCode ?? (options?.commandResult ? undefined : 0),
        }
      }
    } as unknown as TerminalBridge

    const callbacks: AgentGraphCallbacks = {
      emitMessage: (msg) => {
        messages.push({ type: msg.type, content: msg.content, stepNumber: msg.stepNumber, details: msg.details })
      },
      emitStateChange: (phase) => { stateChanges.push(phase) },
      getTerminalContext: () => null,
      onStepComplete: (data) => {
        if (options?.persistExecutingError && data.steps.some((step) => step.status === 'executing')) {
          throw new Error('persist failed')
        }
        onStepCompleteCalls.push({ conclusion: data.conclusion, stopReason: data.stopReason })
      }
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

  it('chat + queued commands: observations feed the conversation, no per-command model call', async () => {
    const h = buildScriptedGraph([
      '我先看下磁盘和内存使用情况。\nPLAN: 查看磁盘\nCOMMAND: df -h\nPLAN: 查看内存\nCOMMAND: free -h',
      '磁盘和内存都正常，没有异常。'
    ])
    const { graph, written, messages, stateChanges, onStepCompleteCalls, replyPrompts } = h

    const initialState = createInitialState()
    initialState.taskDescription = '查看磁盘和内存'
    initialState.userMessage = '查看磁盘和内存'
    initialState.chatTabId = 't-reply-loop'
    initialState.maxSteps = 25
    initialState.conversationHistory = [
      { role: 'user', content: '查看磁盘和内存', createdAt: new Date().toISOString() }
    ]

    await graph.invoke(initialState, {
      configurable: { thread_id: 't-reply-loop' },
      recursionLimit: 100
    })

    // 两条命令按序执行
    expect(written).toEqual(['df -h', 'free -h'])
    // 关键：2 条命令只花 2 次 reply 调用（旧架构需 4 次模型调用），repair 未触发
    expect(h.stats.replyCalls).toBe(2)
    expect(h.stats.repairCalls).toBe(0)
    // 第二次 reply 的 prompt 能看到：第一次的聊天气泡 + 两条工具结果（对话是上下文主轴）
    expect(replyPrompts[1]).toContain('我先看下磁盘和内存使用情况')
    expect(replyPrompts[1]).toContain('工具结果（`df -h`）')
    expect(replyPrompts[1]).toContain('工具结果（`free -h`）')
    expect(replyPrompts[1]).toContain('用户本轮请求：查看磁盘和内存')
    // 聊天气泡：边聊边干的说明 + 最终回复
    const replies = messages.filter(m => m.type === 'assistant_reply')
    expect(replies.some(m => m.content.includes('我先看下磁盘和内存使用情况'))).toBe(true)
    expect(replies.some(m => m.content.includes('磁盘和内存都正常'))).toBe(true)
    // 执行卡片步号分别为 1、2；观察卡片携带命令（前端终结 running 态 + 工具回合持久化）
    const executions = messages.filter(m => m.type === 'execution')
    expect(executions.map(m => m.content)).toEqual(['df -h', 'free -h'])
    expect(executions.map(m => m.stepNumber)).toEqual([1, 2])
    const observations = messages.filter(m => m.type === 'observation')
    expect(observations).toHaveLength(2)
    expect(observations[0].details?.command).toBe('df -h')
    // 对话优先：不再生成正式总结卡片（conclusion）
    expect(messages.some(m => m.type === 'conclusion')).toBe(false)
    // 完成态：completed + 完成文案；最终回复文本作为 conclusion 持久化
    expect(stateChanges[stateChanges.length - 1]).toBe('completed')
    expect(messages.some(m => m.type === 'status' && m.content === '本轮完成，共执行 2 条命令')).toBe(true)
    const completedCall = onStepCompleteCalls.find(c => c.stopReason === 'COMPLETED')
    expect(completedCall?.conclusion).toBe('磁盘和内存都正常，没有异常。')
  })

  it('Graph fallback does not dispatch when pre-send executing evidence cannot persist', async () => {
    const h = buildScriptedGraph(
      ['PLAN: 读取负载\nCOMMAND: uptime'],
      { persistExecutingError: true }
    )
    const initialState = createInitialState()
    initialState.taskDescription = '读取负载'
    initialState.userMessage = '读取负载'
    initialState.chatTabId = 't-graph-persist-fail'

    const finalState = await h.graph.invoke(initialState, {
      configurable: { thread_id: 't-graph-persist-fail' },
      recursionLimit: 100
    })

    expect(h.written).toEqual([])
    expect(finalState.phase).toBe('failed')
    expect(h.messages.some((message) => message.type === 'error' && message.content.includes('执行前异常'))).toBe(true)
  })

  it('Graph fallback requires the shared completion protocol and fails closed on unverified result', async () => {
    const h = buildScriptedGraph(
      ['PLAN: 写入并检查\nCOMMAND: printf ok\nPLAN: 不得继续\nCOMMAND: whoami'],
      { commandResult: { completion: 'timedOut', commandSent: true } }
    )
    const initialState = createInitialState()
    initialState.taskDescription = '执行检查'
    initialState.userMessage = '执行检查'
    initialState.chatTabId = 't-graph-unverified'
    initialState.maxSteps = 25

    const finalState = await h.graph.invoke(initialState, {
      configurable: { thread_id: 't-graph-unverified' },
      recursionLimit: 100
    })

    expect(h.written).toEqual(['printf ok'])
    expect(h.stateChanges[h.stateChanges.length - 1]).toBe('failed')
    expect(h.onStepCompleteCalls.some((call) => call.stopReason === 'ERROR')).toBe(true)
    expect(h.messages.some((message) => message.type === 'error' && message.content.includes('完成未获验证'))).toBe(true)
    expect(finalState.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'printf ok', status: 'executing' })
    ]))
  })

  it('Graph fallback does not report COMPLETED when the final verified exit code is nonzero', async () => {
    const h = buildScriptedGraph(
      ['PLAN: 重启服务\nCOMMAND: systemctl restart demo', '服务处理结束。'],
      { commandResult: { completion: 'verified', commandSent: true, exitCode: 1 } }
    )
    const initialState = createInitialState()
    initialState.taskDescription = '重启服务'
    initialState.userMessage = '重启服务'
    initialState.chatTabId = 't-graph-nonzero'
    initialState.allowWrite = true

    const finalState = await h.graph.invoke(initialState, {
      configurable: { thread_id: 't-graph-nonzero' },
      recursionLimit: 100
    })

    expect(h.written).toEqual(['systemctl restart demo'])
    expect(finalState.phase).toBe('failed')
    expect(finalState.stopReason).toBe('ERROR')
    expect(h.stateChanges[h.stateChanges.length - 1]).toBe('failed')
    expect(h.messages.some((message) => message.type === 'error' && message.content.includes('退出码为 1'))).toBe(true)
    expect(h.onStepCompleteCalls.some((call) => call.stopReason === 'COMPLETED')).toBe(false)
  })

  it('Graph 只读盘点缺失可选探测工具时带警告完成', async () => {
    const h = buildScriptedGraph(
      ['PLAN: 看内核\nCOMMAND: uname -a\nPLAN: 看容器\nCOMMAND: docker ps -a', '没有安装 Docker；内核信息已读取。'],
      { commandResults: {
        'uname -a': { output: 'Linux', exitCode: 0 },
        'docker ps -a': { output: 'sh: docker: command not found', exitCode: 127 },
      } }
    )
    const initialState = createInitialState()
    initialState.taskDescription = '看看这台服务器上有啥'
    initialState.userMessage = initialState.taskDescription
    initialState.chatTabId = 't-graph-optional-probe'
    const finalState = await h.graph.invoke(initialState, {
      configurable: { thread_id: 't-graph-optional-probe' }, recursionLimit: 100
    })
    expect(finalState.phase).toBe('completed')
    expect(finalState.stopReason).toBe('COMPLETED')
    expect(h.messages.some((message) => message.type === 'status' && message.content.includes('有警告'))).toBe(true)
  })

  it('queue budget: second queued command hits the step limit', async () => {
    const h = buildScriptedGraph(
      ['PLAN: 查看磁盘\nCOMMAND: df -h\nPLAN: 查看内存\nCOMMAND: free -h'],
      { maxSteps: 1 }
    )
    const { graph, written, stateChanges, onStepCompleteCalls } = h

    const initialState = createInitialState()
    initialState.taskDescription = '查看磁盘和内存'
    initialState.userMessage = '查看磁盘和内存'
    initialState.chatTabId = 't-reply-budget'
    initialState.maxSteps = 1

    await graph.invoke(initialState, {
      configurable: { thread_id: 't-reply-budget' },
      recursionLimit: 100
    })

    // 预算 1：第一条命令执行，第二条预排命令触顶作废
    expect(written).toEqual(['df -h'])
    expect(h.stats.replyCalls).toBe(1)
    expect(stateChanges).toContain('stepLimitReached')
    // ROUND_LIMIT 持久化（continueTask 可续跑）
    expect(onStepCompleteCalls.some(c => c.stopReason === 'ROUND_LIMIT')).toBe(true)
  })

  // ================================================================
  //  单轮预算语义（2026-09-16）：maxSteps = 一次人类介入后无人值守下
  //  最多执行的命令轮数；人类介入（新一轮 turn）即重置，从零重记。
  // ================================================================
  it('turn budget: at most maxSteps commands per unattended turn, across replies', async () => {
    // 脚本每次 reply 都想再执行一条命令（无人值守下模型持续想干活）
    const h = buildScriptedGraph([
      'PLAN: 查看磁盘\nCOMMAND: df -h',
      'PLAN: 查看内存\nCOMMAND: free -h',
      'PLAN: 查看负载\nCOMMAND: uptime'
    ])
    const { graph, written, stateChanges } = h

    const initialState = createInitialState()
    initialState.taskDescription = '巡检这台机器'
    initialState.userMessage = '巡检这台机器'
    initialState.chatTabId = 't-turn-budget'
    initialState.maxSteps = 2
    initialState.turnStartStepCount = 0

    await graph.invoke(initialState, {
      configurable: { thread_id: 't-turn-budget' },
      recursionLimit: 100
    })

    // 预算 2：前两条命令执行，第 3 条触顶截停（无人值守下最多 2 轮）
    expect(written).toEqual(['df -h', 'free -h'])
    expect(h.stats.replyCalls).toBe(3)
    expect(stateChanges).toContain('stepLimitReached')
  })

  it('turn budget resets on human intervention: old accumulated steps no longer count', async () => {
    // 场景：上一轮已触顶（2 条 done + 第 3 条被截停空占编号 3）。
    // 人类再次发消息 → 新一轮 turn，基准重置为 2，预算从零重记。
    const h = buildScriptedGraph([
      'PLAN: 查看进程\nCOMMAND: ps aux',
      'PLAN: 查看端口\nCOMMAND: ss -tlpn',
      'PLAN: 查看日志\nCOMMAND: journalctl -xe'
    ])
    const { graph, written, stateChanges } = h

    const initialState = createInitialState()
    initialState.taskDescription = '排查服务问题'
    initialState.userMessage = '继续排查'
    initialState.chatTabId = 't-turn-budget-reset'
    initialState.maxSteps = 2
    // 上一轮遗留：2 条已完成业务步骤 + 触顶截停空占的编号 3
    initialState.steps = [
      { stepNumber: 1, plan: '查磁盘', command: 'df -h', observation: 'ok', status: 'done' },
      { stepNumber: 2, plan: '查内存', command: 'free -h', observation: 'ok', status: 'done' }
    ]
    initialState.currentStep = 3
    // 人类介入：本轮基准 = 已有业务步骤数（runtime.startTask 同口径重算）
    initialState.turnStartStepCount = 2
    initialState.conversationHistory = [
      { role: 'user', content: '排查服务问题', createdAt: new Date().toISOString() },
      { role: 'user', content: '继续排查', createdAt: new Date().toISOString() }
    ]

    await graph.invoke(initialState, {
      configurable: { thread_id: 't-turn-budget-reset' },
      recursionLimit: 100
    })

    // 历史累计不再拦截：新一轮重新拿到满额 2 条预算（而非沿用旧的绝对上限）
    // 且本轮内仍受 2 条约束：第 3 条新命令再次触顶截停
    expect(written).toEqual(['ps aux', 'ss -tlpn'])
    expect(h.stats.replyCalls).toBe(3)
    expect(stateChanges).toContain('stepLimitReached')
  })
})
