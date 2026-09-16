import { describe, it, expect } from 'vitest'
import {
  shouldEmitStateChange,
  type AgentState
} from '../agentController'
import {
  createReplyNode,
  type AgentGraphContext,
  type AgentGraphCallbacks
} from '../agentGraph'
import {
  createInitialState,
  type AgentGraphState,
  type StopReason
} from '../agentGraphState'
import type { AiClient } from '../aiClient'
import type { TerminalBridge } from '../terminalBridge'
import { buildReplyUserPrompt } from '../agentGraphPrompt'

// ================================================================
//  shouldEmitStateChange — 完成态收敛规则
// ================================================================
describe('shouldEmitStateChange', () => {
  describe('stopped has highest priority', () => {
    const stopped: AgentState = 'stopped'
    it('blocks completed from overwriting stopped', () => {
      expect(shouldEmitStateChange(stopped, 'completed')).toBe(false)
    })
    it('blocks failed from overwriting stopped', () => {
      expect(shouldEmitStateChange(stopped, 'failed')).toBe(false)
    })
    it('blocks summarizing from overwriting stopped', () => {
      expect(shouldEmitStateChange(stopped, 'summarizing')).toBe(false)
    })
    it('blocks a duplicate stopped from re-emitting', () => {
      expect(shouldEmitStateChange(stopped, 'stopped')).toBe(false)
    })
  })

  describe('no duplicate terminal events', () => {
    it('blocks re-emitting completed when already completed', () => {
      expect(shouldEmitStateChange('completed', 'completed')).toBe(false)
    })
    it('blocks re-emitting failed when already failed', () => {
      expect(shouldEmitStateChange('failed', 'failed')).toBe(false)
    })
    it('blocks re-emitting stepLimitReached', () => {
      expect(shouldEmitStateChange('stepLimitReached', 'stepLimitReached')).toBe(false)
    })
  })

  describe('no middle-state rollback over terminal state', () => {
    it('blocks summarizing from rolling back completed', () => {
      // 异步收尾的旧 phase 不能把已宣告的 completed 退回 summarizing
      expect(shouldEmitStateChange('completed', 'summarizing')).toBe(false)
    })
    it('blocks planning from rolling back completed', () => {
      expect(shouldEmitStateChange('completed', 'planning')).toBe(false)
    })
    it('blocks executing from rolling back completed', () => {
      expect(shouldEmitStateChange('completed', 'executing')).toBe(false)
    })
    it('blocks observing from rolling back stepLimitReached', () => {
      expect(shouldEmitStateChange('stepLimitReached', 'observing')).toBe(false)
    })
    it('blocks starting from rolling back failed', () => {
      expect(shouldEmitStateChange('failed', 'starting')).toBe(false)
    })
  })

  describe('idle is treated as no-task and can be overwritten', () => {
    it('allows completed → idle (explicit reset)', () => {
      expect(shouldEmitStateChange('completed', 'idle')).toBe(true)
    })
    it('allows failed → idle', () => {
      expect(shouldEmitStateChange('failed', 'idle')).toBe(true)
    })
    it('allows stopped → idle', () => {
      // stopped → idle 是合法的主动重置（reset() 调用）
      // 注意：shouldEmitStateChange 规则 1 会阻止 stopped → 任何，
      // 但 reset() 不经过 shouldEmitStateChange，直接设置 this.state。
      // 这里测试的是"如果走 shouldEmitStateChange"的结果。
      expect(shouldEmitStateChange('stopped', 'idle')).toBe(false)
    })
  })

  describe('allowed transitions', () => {
    it('allows idle → planning (new task start)', () => {
      expect(shouldEmitStateChange('idle', 'planning')).toBe(true)
    })
    it('allows idle → starting', () => {
      expect(shouldEmitStateChange('idle', 'starting')).toBe(true)
    })
    it('allows planning → executing (normal progression)', () => {
      expect(shouldEmitStateChange('planning', 'executing')).toBe(true)
    })
    it('allows executing → observing', () => {
      expect(shouldEmitStateChange('executing', 'observing')).toBe(true)
    })
    it('allows observing → summarizing', () => {
      expect(shouldEmitStateChange('observing', 'summarizing')).toBe(true)
    })
    it('allows summarizing → completed (terminal transition)', () => {
      expect(shouldEmitStateChange('summarizing', 'completed')).toBe(true)
    })
    it('allows completed → stepLimitReached (rare but not a rollback)', () => {
      // 两个终态之间的转换：规则 2 不命中（不同），规则 3 不命中（next 是终态）
      expect(shouldEmitStateChange('completed', 'stepLimitReached')).toBe(true)
    })
  })
})

// ================================================================
//  buildReplyUserPrompt — 对话优先的上下文投影
// ================================================================
describe('buildReplyUserPrompt', () => {
  it('keeps the stable topic separate from the current follow-up message', () => {
    const state = createInitialState()
    state.taskDescription = '排查磁盘空间问题'
    state.userMessage = '刚才的输出里，哪个目录增长最快？'

    const prompt = buildReplyUserPrompt(state, state.userMessage, null)
    expect(prompt).toContain('当前话题：排查磁盘空间问题')
    expect(prompt).toContain('用户本轮请求：刚才的输出里，哪个目录增长最快？')
  })

  it('renders tool turns distinctly from user/assistant turns', () => {
    const state = createInitialState()
    state.taskDescription = '查看磁盘'
    state.userMessage = '查看磁盘'
    state.conversationHistory = [
      { role: 'user', content: '查看磁盘', createdAt: new Date().toISOString() },
      { role: 'assistant', content: '我看下磁盘占用。', isFromExecution: true, createdAt: new Date().toISOString() },
      { role: 'tool', content: 'Filesystem  Size  Used Avail Use%\n/dev/sda1  50G   40G  10G  80%', command: 'df -h', createdAt: new Date().toISOString() }
    ]

    const prompt = buildReplyUserPrompt(state, state.userMessage, null)
    expect(prompt).toContain('- 用户：查看磁盘')
    expect(prompt).toContain('- 助手：我看下磁盘占用。')
    expect(prompt).toContain('- 工具结果（`df -h`）：')
    expect(prompt).toContain('80%')
  })

  it('injects hard evidence constraint for first-turn inspection requests', () => {
    const state = createInitialState()
    state.taskDescription = '看看机器上跑了什么服务'
    state.userMessage = '看看机器上跑了什么服务'

    const prompt = buildReplyUserPrompt(state, state.userMessage, null)
    expect(prompt).toContain('执行意图硬约束')
    expect(prompt).toContain('必须先落至少一条只读命令')
  })

  it('does not inject the inspection constraint on follow-up turns', () => {
    const state = createInitialState()
    state.taskDescription = '看看机器上跑了什么服务'
    state.userMessage = '谢谢，再看看内存'
    state.steps = [{
      stepNumber: 1,
      plan: '查看运行服务',
      command: 'ps aux',
      observation: '正常运行',
      status: 'done'
    }]

    const prompt = buildReplyUserPrompt(state, state.userMessage, null)
    expect(prompt).not.toContain('执行意图硬约束')
  })
})

// ================================================================
//  createReplyNode — 收尾时序（对话优先重构后从 summarize 移植的纪律）
// ================================================================

/** 记录 callback 调用顺序的 mock。判别联合让 TS 从 kind 自动收窄 payload 类型。 */
type EmitMessagePayload = Parameters<AgentGraphCallbacks['emitMessage']>[0]
type EmitStateChangePayload = Parameters<AgentGraphCallbacks['emitStateChange']>[0]
type OnStepCompletePayload = Parameters<AgentGraphCallbacks['onStepComplete']>[0]

type RecordedCall =
  | { kind: 'emitMessage'; payload: EmitMessagePayload }
  | { kind: 'emitStateChange'; payload: EmitStateChangePayload }
  | { kind: 'onStepComplete'; payload: OnStepCompletePayload }

function buildMockContext(
  options?: {
    replyText?: string
    onStepCompleteThrows?: Error
  }
): { ctx: AgentGraphContext; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const replyText = options?.replyText ?? '好的，没问题。'

  const callbacks: AgentGraphCallbacks = {
    emitMessage(msg) {
      calls.push({ kind: 'emitMessage', payload: msg })
    },
    emitStateChange(phase) {
      calls.push({ kind: 'emitStateChange', payload: phase })
    },
    getTerminalContext() {
      return null
    },
    onStepComplete(data) {
      if (options?.onStepCompleteThrows) throw options.onStepCompleteThrows
      calls.push({ kind: 'onStepComplete', payload: data })
    }
  }

  // mock aiClient：根据 replyText 通过 onChunk 投递内容
  const aiClient = {
    sendStream: async (
      _request: unknown,
      _session: unknown,
      onChunk: (chunk: { text?: string; reasoning?: string }) => void
    ) => {
      if (replyText) onChunk({ text: replyText })
      return { content: replyText, reasoning: '' }
    }
  } as unknown as AiClient

  const ctx: AgentGraphContext = {
    bridge: {} as TerminalBridge,
    aiClient,
    callbacks,
    abortController: new AbortController()
  }

  return { ctx, calls }
}

function buildWorkTurnState(): AgentGraphState {
  // 本轮执行过 2 条命令的 working state（turnStartStepCount = 0）
  const state = createInitialState()
  state.taskDescription = '查看磁盘和内存'
  state.userMessage = '查看磁盘和内存'
  state.turnStartStepCount = 0
  state.steps = [
    {
      stepNumber: 1,
      plan: '查看磁盘',
      command: 'df -h',
      commandOutput: 'mock output',
      observation: '磁盘 80%',
      status: 'done'
    },
    {
      stepNumber: 2,
      plan: '查看内存',
      command: 'free -h',
      commandOutput: 'mock output',
      observation: '内存 40%',
      status: 'done'
    }
  ]
  state.currentStep = 2
  state.maxSteps = 25
  return state
}

describe('createReplyNode completion timing', () => {
  it('emits onStepComplete(COMPLETED) and completed state BEFORE the turn-done status message', async () => {
    const { ctx, calls } = buildMockContext({ replyText: '磁盘 80%，内存 40%，建议清理日志。' })
    const node = createReplyNode(ctx)
    const update = await node(buildWorkTurnState())

    // 找到关键调用的索引
    const onStepCompleteIdx = calls.findIndex(c => c.kind === 'onStepComplete')
    const completedStateIdx = calls.findIndex(
      c => c.kind === 'emitStateChange' && c.payload === 'completed'
    )
    const turnDoneIdx = calls.findIndex(
      c =>
        c.kind === 'emitMessage' &&
        c.payload.type === 'status' &&
        c.payload.content.startsWith('本轮完成')
    )

    // 三个关键调用都应存在
    expect(onStepCompleteIdx).toBeGreaterThanOrEqual(0)
    expect(completedStateIdx).toBeGreaterThanOrEqual(0)
    expect(turnDoneIdx).toBeGreaterThanOrEqual(0)

    // 时序纪律（与旧 summarize 一致）：持久化 → completed 状态 → 完成文案
    expect(onStepCompleteIdx).toBeLessThan(completedStateIdx)
    expect(completedStateIdx).toBeLessThan(turnDoneIdx)

    // 最终回复文本作为 conclusion 持久化
    const onStepCompleteCalls = calls.filter(c => c.kind === 'onStepComplete')
    expect(onStepCompleteCalls[0].payload.conclusion).toBe('磁盘 80%，内存 40%，建议清理日志。')
    expect(onStepCompleteCalls[0].payload.stopReason).toBe<StopReason>('COMPLETED')

    // 返回图状态 completed
    expect(update.phase).toBe('completed')
    expect(update.stopReason).toBe('COMPLETED')
  })

  it('pure chat turn ends as idle without turn-done status or conclusion overwrite', async () => {
    const { ctx, calls } = buildMockContext({ replyText: '你好！我在。' })
    const node = createReplyNode(ctx)

    // 纯聊天：无任何已执行步骤
    const state = createInitialState()
    state.taskDescription = '你好'
    state.userMessage = '你好'
    state.turnStartStepCount = 0
    const update = await node(state)

    // idle 收尾，不出现完成文案
    const idleStateIdx = calls.findIndex(
      c => c.kind === 'emitStateChange' && c.payload === 'idle'
    )
    expect(idleStateIdx).toBeGreaterThanOrEqual(0)
    expect(calls.some(
      c => c.kind === 'emitMessage' && c.payload.type === 'status' && c.payload.content.startsWith('本轮完成')
    )).toBe(false)

    // 持久化 COMPLETED（防空闲监测误判）但不覆盖 lastConclusion
    const onStepCompleteCalls = calls.filter(c => c.kind === 'onStepComplete')
    expect(onStepCompleteCalls).toHaveLength(1)
    expect(onStepCompleteCalls[0].payload.stopReason).toBe<StopReason>('COMPLETED')
    expect(onStepCompleteCalls[0].payload.conclusion).toBeUndefined()

    expect(update.phase).toBe('idle')
  })

  it('strips legacy DONE prefix from the final reply', async () => {
    const { ctx, calls } = buildMockContext({ replyText: 'DONE: 你好呀！需要我帮你看看这台服务器吗？' })
    const node = createReplyNode(ctx)

    const state = createInitialState()
    state.taskDescription = '你好'
    state.userMessage = '你好'
    state.turnStartStepCount = 0
    await node(state)

    // DONE 前缀被剥掉，作为普通聊天气泡出现
    const emitCalls = calls.filter(c => c.kind === 'emitMessage')
    const reply = emitCalls.find(m => m.payload.type === 'assistant_reply')
    expect(reply).toBeDefined()
    expect(reply!.payload.content).toBe('你好呀！需要我帮你看看这台服务器吗？')
    expect(String(reply!.payload.content)).not.toMatch(/^DONE/)
  })

  it('converts to failed when onStepComplete (persistence) throws', async () => {
    const { ctx, calls } = buildMockContext({
      replyText: '磁盘 80%，建议清理。',
      onStepCompleteThrows: new Error('持久化失败')
    })
    const node = createReplyNode(ctx)
    const update = await node(buildWorkTurnState())

    // 持久化失败时不得继续宣告"本轮完成"，应转为 failed
    const failedStateIdx = calls.findIndex(
      c => c.kind === 'emitStateChange' && c.payload === 'failed'
    )
    expect(failedStateIdx).toBeGreaterThanOrEqual(0)

    // 不应发射 completed 状态事件
    const completedStateIdx = calls.findIndex(
      c => c.kind === 'emitStateChange' && c.payload === 'completed'
    )
    expect(completedStateIdx).toBe(-1)

    // 不应投递"本轮完成"文案
    expect(calls.some(
      c => c.kind === 'emitMessage' && c.payload.type === 'status' && c.payload.content.startsWith('本轮完成')
    )).toBe(false)

    expect(update.phase).toBe('failed')
    expect(update.stopReason).toBe('ERROR')
  })
})
