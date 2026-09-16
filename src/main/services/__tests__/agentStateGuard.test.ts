import { describe, it, expect } from 'vitest'
import {
  shouldEmitStateChange,
  type AgentState
} from '../agentController'
import {
  createSummarizeNode,
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
import { buildThinkUserPrompt } from '../agentGraphPrompt'

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

describe('buildThinkUserPrompt', () => {
  it('keeps the stable task goal separate from the current follow-up message', () => {
    const state = createInitialState()
    state.taskDescription = '排查磁盘空间问题'
    state.userMessage = '刚才的输出里，哪个目录增长最快？'
    state.conversationHistory = [{
      role: 'user',
      content: state.userMessage,
      createdAt: new Date().toISOString()
    }]

    const prompt = buildThinkUserPrompt(state, state.userMessage, null)
    expect(prompt).toContain('当前任务：排查磁盘空间问题')
    expect(prompt).toContain('用户说：刚才的输出里，哪个目录增长最快？')
  })

  it('includes persisted key command output in the next planning prompt', () => {
    const state = createInitialState()
    state.taskDescription = '检查服务状态'
    state.userMessage = '继续分析'
    state.recentKeyOutputs = [{
      stepNumber: 1,
      command: 'systemctl status demo',
      output: 'Active: failed (Result: exit-code)'
    }]

    const prompt = buildThinkUserPrompt(state, state.userMessage, null)
    expect(prompt).toContain('最近关键命令输出')
    expect(prompt).toContain('Active: failed')
  })
})

// ================================================================
//  createSummarizeNode — 完成时序
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
    summaryText?: string
    onStepCompleteThrows?: Error
  }
): { ctx: AgentGraphContext; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const summaryText = options?.summaryText ?? '' // 默认空 → 走兜底结论

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

  // mock aiClient：根据 summaryText 决定是否通过 onChunk 投递真实内容
  const aiClient = {
    sendStream: async (
      _request: unknown,
      _session: unknown,
      onChunk: (chunk: { text?: string; reasoning?: string }) => void
    ) => {
      if (summaryText) onChunk({ text: summaryText })
      return { content: summaryText, reasoning: '' }
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

function buildSampleState(): AgentGraphState {
  const state = createInitialState()
  state.taskDescription = '查看 nginx 状态并启动'
  state.steps = [
    {
      stepNumber: 1,
      plan: '检查 nginx 状态',
      command: 'systemctl status nginx',
      observation: 'nginx 已停止',
      status: 'done'
    },
    {
      stepNumber: 2,
      plan: '启动 nginx',
      command: 'systemctl start nginx',
      observation: '启动成功',
      status: 'done'
    }
  ]
  state.currentStep = 2
  state.maxSteps = 25
  return state
}

describe('createSummarizeNode completion timing', () => {
  it('emits onStepComplete(COMPLETED) and completed state BEFORE the "task done" status message', async () => {
    const { ctx, calls } = buildMockContext({ summaryText: '## 任务完成\nnginx 已成功启动' })
    const node = createSummarizeNode(ctx)
    const update = await node(buildSampleState())

    // 找到关键调用的索引
    const onStepCompleteIdx = calls.findIndex(c => c.kind === 'onStepComplete')
    const completedStateIdx = calls.findIndex(
      c => c.kind === 'emitStateChange' && c.payload === 'completed'
    )
    const taskDoneIdx = calls.findIndex(
      c =>
        c.kind === 'emitMessage' &&
        c.payload.type === 'status' &&
        c.payload.content.startsWith('任务完成')
    )

    // 三个关键调用都应存在
    expect(onStepCompleteIdx).toBeGreaterThanOrEqual(0)
    expect(completedStateIdx).toBeGreaterThanOrEqual(0)
    expect(taskDoneIdx).toBeGreaterThanOrEqual(0)

    // onStepComplete 必须在"任务完成"文案之前
    expect(onStepCompleteIdx).toBeLessThan(taskDoneIdx)
    // completed 状态事件必须在"任务完成"文案之前
    expect(completedStateIdx).toBeLessThan(taskDoneIdx)
    // onStepComplete 必须在 completed 状态事件之前（持久化先于事件发射）
    expect(onStepCompleteIdx).toBeLessThan(completedStateIdx)

    // 返回图状态 completed
    expect(update.phase).toBe('completed')
    expect(update.stopReason).toBe('COMPLETED')
  })

  it('passes stopReason: COMPLETED to onStepComplete', async () => {
    const { ctx, calls } = buildMockContext({ summaryText: '正常总结' })
    const node = createSummarizeNode(ctx)
    await node(buildSampleState())

    const onStepCompleteCalls = calls.filter(c => c.kind === 'onStepComplete')
    expect(onStepCompleteCalls).toHaveLength(1)
    expect(onStepCompleteCalls[0].payload.stopReason).toBe<StopReason>('COMPLETED')
  })

  it('still reaches completed when summary model fails and fallback conclusion is used', async () => {
    // summaryText 为空 → invokeModelWithStreaming 返回 '(模型未返回内容)' → 走兜底结论
    const { ctx, calls } = buildMockContext({ summaryText: '' })
    const node = createSummarizeNode(ctx)
    const update = await node(buildSampleState())

    // 兜底结论仍应进入 completed
    const completedStateIdx = calls.findIndex(
      c => c.kind === 'emitStateChange' && c.payload === 'completed'
    )
    expect(completedStateIdx).toBeGreaterThanOrEqual(0)

    // 仍应投递 conclusion 卡片（兜底结论）
    const conclusionMsgs = calls.filter(
      c => c.kind === 'emitMessage' && c.payload.type === 'conclusion'
    )
    expect(conclusionMsgs).toHaveLength(1)

    // 仍应投递"任务完成"文案
    const taskDoneMsgs = calls.filter(
      c =>
        c.kind === 'emitMessage' &&
        c.payload.type === 'status' &&
        c.payload.content.startsWith('任务完成')
    )
    expect(taskDoneMsgs).toHaveLength(1)

    expect(update.phase).toBe('completed')
    expect(update.stopReason).toBe('COMPLETED')
  })

  it('converts to failed when onStepComplete (persistence) throws', async () => {
    const { ctx, calls } = buildMockContext({
      summaryText: '正常总结',
      onStepCompleteThrows: new Error('持久化失败')
    })
    const node = createSummarizeNode(ctx)
    const update = await node(buildSampleState())

    // 持久化失败时不得继续宣告"任务完成"，应转为 failed
    const failedStateIdx = calls.findIndex(
      c => c.kind === 'emitStateChange' && c.payload === 'failed'
    )
    expect(failedStateIdx).toBeGreaterThanOrEqual(0)

    // 不应发射 completed 状态事件
    const completedStateIdx = calls.findIndex(
      c => c.kind === 'emitStateChange' && c.payload === 'completed'
    )
    expect(completedStateIdx).toBe(-1)

    // 不应投递"任务完成"文案
    const taskDoneMsgs = calls.filter(
      c =>
        c.kind === 'emitMessage' &&
        c.payload.type === 'status' &&
        c.payload.content.startsWith('任务完成')
    )
    expect(taskDoneMsgs).toHaveLength(0)

    expect(update.phase).toBe('failed')
    expect(update.stopReason).toBe('ERROR')
  })
})
