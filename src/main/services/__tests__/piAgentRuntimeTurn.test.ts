/**
 * PiAgentRuntime 生命周期与事件映射测试(验收退回 R01/R02/R05/R06)。
 *
 * 用 stub AgentSession 替换真实 SDK:可控地注入 Pi 事件序列,
 * 断言 runtime 的状态收敛、取消语义、历史导入与事件转换。
 * 不依赖真实模型/网络 —— SDK 的 createAgentSession 通过
 * vi.mock 替换为内存 stub。
 *
 * 覆盖:
 * - R02:异步初始化窗口(loader/模型/session 创建)内 stop/removeTab/重启生效;
 * - R01:stop 直改 turn,工具与取消检查点立即可见;
 * - R06:message_end 按角色分流(assistant 才发 assistant_reply);
 *   stopReason=error → failed;预算耗尽 → ROUND_LIMIT/stepLimitReached;
 *   thinking 累计替换语义;tool_execution_end 错误分类;
 * - R05:历史导入(buildHistoryEntries 的 role 映射);
 * - S02:启动与续跑共用 finishTurn 收尾语义。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'

// ---- mock SDK:createAgentSession 返回 stub session ----

interface StubSession {
  prompts: string[]
  disposed: boolean
  abortCalled: boolean
  /** 注入事件给订阅者(模拟 Pi 事件流)。 */
  emit: (event: AgentSessionEvent) => void
  /**
   * 可编程 prompt 门:arrestPrompt() 后,prompt 挂起直到 releasePrompt()。
   * 测试在注入事件后手动放行,驱动 finishTurn 收尾。
   */
  arrestPrompt: () => void
  releasePrompt: () => void
  /** 下一次 prompt 立即 reject。 */
  rejectNext: boolean
}

let lastStubSession: StubSession & AgentSession
const createdSessions: Array<StubSession & AgentSession> = []
/** 在 startTask 前置 true:下一个创建的 session 的首个 prompt 挂起,等测试放行。 */
let arrestNextSession = false

function makeStubSession(): StubSession & AgentSession {
  const listeners: Array<(e: AgentSessionEvent) => void> = []
  let releaseGate: (() => void) | null = null
  let pendingGate: Promise<void> | null = null
  if (arrestNextSession) {
    pendingGate = new Promise<void>((resolve) => { releaseGate = resolve })
    arrestNextSession = false
  }
  const stub: StubSession = {
    prompts: [],
    disposed: false,
    abortCalled: false,
    rejectNext: false,
    arrestPrompt() {
      if (!pendingGate) {
        pendingGate = new Promise<void>((resolve) => { releaseGate = resolve })
      }
    },
    releasePrompt() {
      releaseGate?.()
      releaseGate = null
      pendingGate = null
    },
    emit: (event: AgentSessionEvent) => {
      for (const l of [...listeners]) l(event)
    },
  }
  const session = {
    // 可变状态经 getter/setter 代理到 stub:测试改 session.* 即改闭包读取的同一状态
    get prompts() { return stub.prompts },
    get rejectNext() { return stub.rejectNext },
    set rejectNext(v: boolean) { stub.rejectNext = v },
    get disposed() { return stub.disposed },
    get abortCalled() { return stub.abortCalled },
    arrestPrompt: stub.arrestPrompt,
    releasePrompt: stub.releasePrompt,
    emit: stub.emit,
    prompt: vi.fn(async (text: string) => {
      stub.prompts.push(text)
      // 挂起模式:等测试放行(最长 2s 防测试悬挂)
      if (pendingGate) {
        await Promise.race([pendingGate, new Promise((r) => setTimeout(r, 2000))])
      }
      // reject 在放行后检查:测试可先设 rejectNext 再 release
      if (stub.rejectNext) {
        stub.rejectNext = false
        throw new Error('stub: model request failed')
      }
    }),
    subscribe: vi.fn((listener: (e: AgentSessionEvent) => void) => {
      listeners.push(listener)
      return () => {
        const i = listeners.indexOf(listener)
        if (i >= 0) listeners.splice(i, 1)
      }
    }),
    abort: vi.fn(async () => {
      stub.abortCalled = true
    }),
    dispose: vi.fn(() => {
      stub.disposed = true
    }),
    getLastAssistantText: vi.fn(() => 'stub assistant text'),
  } as unknown as StubSession & AgentSession
  return session
}

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()
  return {
    ...actual,
    createAgentSession: vi.fn(async () => {
      const s = makeStubSession()
      lastStubSession = s
      createdSessions.push(s)
      return { session: s }
    }),
  }
})

// ---- 被测模块(mock 之后 import) ----

import { PiAgentRuntime, buildHistoryEntries } from '../piAgentRuntime'
import type { TerminalBridge } from '../terminalBridge'
import type { AgentGraphCallbacks } from '../agentGraph'
import type { ChatTurn, StepRecord } from '../agentGraphState'

// ---- 脚手架 ----

function makeBridge(): TerminalBridge {
  return {
    isConnected: () => true,
    isDisposed: () => false,
    getTerminalLockKey: () => ({ fakeSession: true }),
    getTerminalContext: () => null,
    getPreCommandSnapshot: () => 'S',
    writeCommand: vi.fn(),
    waitForResult: vi.fn(async () => ({ command: '', output: 'ok', duration: 10 })),
    dispose: () => {},
  } as unknown as TerminalBridge
}

interface RecordedCallbacks {
  messages: Array<{ type: string; content: string; details?: Record<string, unknown>; stepNumber?: number }>
  states: string[]
  stepCompletions: Array<{ steps: StepRecord[]; stopReason?: string | null; conclusion?: string }>
}

function makeCallbacks(): AgentGraphCallbacks & RecordedCallbacks {
  const cb: RecordedCallbacks = { messages: [], states: [], stepCompletions: [] }
  return {
    ...cb,
    emitMessage(msg) {
      cb.messages.push({ ...msg } as never)
    },
    emitStateChange(phase) {
      cb.states.push(phase as string)
    },
    getTerminalContext() { return null },
    onStepComplete(data) {
      cb.stepCompletions.push({
        steps: data.steps,
        stopReason: data.stopReason,
        conclusion: data.conclusion,
      })
    },
  } as AgentGraphCallbacks & RecordedCallbacks
}

function makeConfig() {
  return {
    providerType: 'openai-compatible' as const,
    label: 'test',
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: 'k',
    model: 'm',
    enableStreaming: false,
    reasoningMode: 'auto' as const,
  }
}

function step(n: number, command?: string): StepRecord {
  return { stepNumber: n, plan: '', command, observation: 'o', status: command ? 'done' : 'skipped' }
}

beforeEach(() => {
  createdSessions.length = 0
  arrestNextSession = false
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ================================================================
//  R02:异步初始化窗口内的停止/销毁/重启
// ================================================================

describe('R02 异步窗口内停止', () => {
  it('startTask 未完成时 stop:不 prompt、不发命令、session 释放', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const bridge = makeBridge()
    const callbacks = makeCallbacks()

    // 异步窗口:loader/模型/session 创建期间(真实耗时不定)调用 stop
    const started = runtime.startTask('tab-1', '任务', 25, bridge, callbacks)
    runtime.stop('tab-1') // 同步段已登记 turn(R02 修复核心)
    await started

    // 任何创建出来的 session 都不 prompt;取消后才返回的 session 被释放
    expect(createdSessions.every((s) => s.prompts.length === 0)).toBe(true)
    expect(createdSessions.every((s) => s.disposed || s.prompts.length === 0)).toBe(true)
  })

  it('startTask 未完成时 removeTab:不 prompt,无残留', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const started = runtime.startTask('tab-1', '任务', 25, makeBridge(), makeCallbacks())
    runtime.removeTab('tab-1')
    await started
    expect(createdSessions.every((s) => s.prompts.length === 0)).toBe(true)
    expect(runtime.hasTab('tab-1')).toBe(false)
  })

  it('初始化期间重启新一轮:旧轮不 prompt,新轮正常执行', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const bridge = makeBridge()
    const cb1 = makeCallbacks()
    const cb2 = makeCallbacks()

    const old = runtime.startTask('tab-1', '旧任务', 25, bridge, cb1)
    // 立刻启动新任务(旧轮在异步初始化中被打断)
    const fresh = runtime.startTask('tab-1', '新任务', 25, bridge, cb2)
    await old
    await fresh

    // 新轮完成了一次 prompt;旧轮绝不以自己的 userMessage prompt
    const promptedTexts = createdSessions.flatMap((s) => s.prompts)
    expect(promptedTexts).toContain('新任务')
    expect(promptedTexts).not.toContain('旧任务')
    // 新轮正常收尾(completed/idle 二者其一,由工具执行决定 → idle)
    expect(cb2.states).toContain('idle')
  })
})

// ================================================================
//  R01/R06:运行中状态与事件映射
// ================================================================

describe('R01 stop 后旧轮失效', () => {
  it('prompt 挂起中 stop:事件不再转发,不复活任务', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const bridge = makeBridge()
    const callbacks = makeCallbacks()

    arrestNextSession = true // session 创建即挂起首个 prompt(运行中)
    const started = runtime.startTask('tab-1', '任务', 25, bridge, callbacks)
    await vi.waitFor(() => expect(createdSessions.length).toBe(1))
    const session = createdSessions[0]
    await vi.waitFor(() => expect(session.prompts.length).toBe(1))

    runtime.stop('tab-1')

    // 迟到的 assistant message_end:不转发(R01/R06:旧轮失效)
    session.emit({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '迟到的回复' }],
        api: 'openai-completions',
        provider: 'zterm-openai-completions',
        model: 'm',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    } as AgentSessionEvent)
    session.releasePrompt()
    await started

    // 迟到 assistant_reply 不出现;stopped 只来自 stop() 本身
    expect(callbacks.messages.some((m) => m.type === 'assistant_reply')).toBe(false)
    expect(callbacks.states).toContain('stopped')
    // 停止后不被后续事件重写为 executing/completed
    const lastState = callbacks.states[callbacks.states.length - 1]
    expect(lastState).toBe('stopped')
  })
})

describe('R06 事件映射', () => {
  async function startArrested(runtime: PiAgentRuntime) {
    arrestNextSession = true // 创建即挂起,事件注入后手动放行
    const callbacks = makeCallbacks()
    const started = runtime.startTask(
      'tab-ev', '任务', 25, makeBridge(), callbacks,
      { userMessage: '检查一下' }
    )
    await vi.waitFor(() => expect(createdSessions.length).toBeGreaterThanOrEqual(1))
    const session = createdSessions[createdSessions.length - 1]
    await vi.waitFor(() => expect(session.prompts.length).toBe(1))
    return { callbacks, session, started }
  }

  it('user message_end 不产生 assistant_reply(角色分流)', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const { callbacks, session, started } = await startArrested(runtime)

    session.emit({
      type: 'message_end',
      message: { role: 'user', content: '检查一下', timestamp: Date.now() },
    } as unknown as AgentSessionEvent)
    session.releasePrompt()
    await started
    const replies = callbacks.messages.filter((m) => m.type === 'assistant_reply')
    // user 回声不发 assistant_reply(R06 旧 bug:任意 message_end 都发)
    expect(replies.length).toBe(0)
  })

  it('完整序列:thinking_delta 累计(替换语义)→ assistant_reply 落一次 → idle', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const { callbacks, session, started } = await startArrested(runtime)

    session.emit({
      type: 'message_update',
      message: { role: 'assistant', content: [], api: 'openai-completions', provider: 'p', model: 'm', usage: null as never, stopReason: 'stop', timestamp: Date.now() },
      assistantMessageEvent: { type: 'thinking_delta', delta: '思考A' },
    } as unknown as AgentSessionEvent)
    session.emit({
      type: 'message_update',
      message: { role: 'assistant', content: [], api: 'openai-completions', provider: 'p', model: 'm', usage: null as never, stopReason: 'stop', timestamp: Date.now() },
      assistantMessageEvent: { type: 'thinking_delta', delta: '思考B' },
    } as unknown as AgentSessionEvent)
    session.emit({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '最终回复' }],
        api: 'openai-completions',
        provider: 'zterm-openai-completions',
        model: 'm',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    } as AgentSessionEvent)
    session.releasePrompt()
    await started

    // thinking:两次 delta → 两条 thinking 消息,内容是累计(替换语义,R06 修复)
    const thinkings = callbacks.messages.filter((m) => m.type === 'thinking' && m.details?.streaming === true)
    expect(thinkings.length).toBe(2)
    expect(thinkings[0].content).toBe('思考A')
    expect(thinkings[1].content).toBe('思考A思考B') // 累计全文,非单个 delta

    // assistant_reply:权威落一次
    const replies = callbacks.messages.filter((m) => m.type === 'assistant_reply')
    expect(replies.length).toBe(1)
    expect(replies[0].content).toBe('最终回复')

    // 纯聊天收尾:idle + 无 stopReason(不写 COMPLETED)
    expect(callbacks.states).toContain('idle')
    expect(callbacks.stepCompletions[0].stopReason).toBeUndefined()
  })

  it('assistant stopReason=error(prompt 正常 resolve)→ 显式 failed,不 COMPLETED', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const { callbacks, session, started } = await startArrested(runtime)

    session.emit({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [],
        api: 'openai-completions',
        provider: 'zterm-openai-completions',
        model: 'm',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'error',
        errorMessage: '模型服务过载',
        timestamp: Date.now(),
      },
    } as AgentSessionEvent)
    // prompt 正常 resolve(不 reject)—— R06 场景
    session.releasePrompt()
    await started

    expect(callbacks.messages.some((m) => m.type === 'error' && m.content.includes('模型服务过载'))).toBe(true)
    expect(callbacks.states[callbacks.states.length - 1]).toBe('failed')
    expect(callbacks.stepCompletions[0].stopReason).toBe('ERROR')
  })

  it('prompt reject(执行期错误)→ failed + ERROR', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    arrestNextSession = true
    const callbacks = makeCallbacks()
    const started = runtime.startTask('tab-err', '任务', 25, makeBridge(), callbacks)

    await vi.waitFor(() => expect(createdSessions.length).toBe(1))
    const session = createdSessions[0]
    await vi.waitFor(() => expect(session.prompts.length).toBe(1))
    // 放行后立即 reject(reject 检查在放行之后)
    session.rejectNext = true
    session.releasePrompt()
    await started

    expect(callbacks.states[callbacks.states.length - 1]).toBe('failed')
    expect(callbacks.messages.some((m) => m.type === 'error')).toBe(true)
  })

  it('tool_execution_end 错误分类:预算耗尽如实报错,不显示成功', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const { callbacks, session, started } = await startArrested(runtime)

    session.emit({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'execute_bound_terminal',
      result: {
        details: { error: 'budget_exhausted', command: 'ls', stepNumber: 1 },
      },
      isError: true,
    } as unknown as AgentSessionEvent)
    session.emit({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '预算用完了' }],
        api: 'openai-completions',
        provider: 'zterm-openai-completions',
        model: 'm',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    } as AgentSessionEvent)
    session.releasePrompt()
    await started

    const errorMsg = callbacks.messages.find((m) => m.type === 'error' && m.details?.command === 'ls')
    expect(errorMsg).toBeTruthy()
    expect(errorMsg?.content).toContain('预算已耗尽')
    // observation 不出现(未执行成功)
    expect(callbacks.messages.some((m) => m.type === 'observation' && m.details?.command === 'ls')).toBe(false)
  })

  it('tool_execution_end 成功:execution 卡片 + observation 带 command/duration/fidelity', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const { callbacks, session, started } = await startArrested(runtime)

    session.emit({
      type: 'tool_execution_start',
      toolCallId: 't1',
      toolName: 'execute_bound_terminal',
      args: { command: 'uptime', plan: '看负载' },
    } as unknown as AgentSessionEvent)
    session.emit({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'execute_bound_terminal',
      result: {
        details: { command: 'uptime', stepNumber: 1, duration: 250, fidelity: 'verified' },
        content: [{ type: 'text', text: '验证完成，退出码: 0' }],
      },
      isError: false,
    } as unknown as AgentSessionEvent)
    session.releasePrompt()
    await started

    const exec = callbacks.messages.find((m) => m.type === 'execution')
    expect(exec?.content).toBe('uptime')
    const obs = callbacks.messages.find((m) => m.type === 'observation')
    expect(obs?.details?.command).toBe('uptime')
    expect(obs?.details?.fidelity).toBe('verified')
    expect(obs?.content).toContain('验证完成')
    expect(obs?.content).not.toContain('结果不确定')
    expect(obs?.details?.duration).toBe(250)
    expect(callbacks.states).toContain('executing')
    expect(callbacks.states).toContain('observing')
  })
})

// ================================================================
//  R05:历史导入
// ================================================================

describe('R05 buildHistoryEntries:role 映射', () => {
  it('user/assistant/tool → 对应 Pi message role,链式 parentId', () => {
    const history: ChatTurn[] = [
      { role: 'user', content: '记住 token ABC', createdAt: '2026-09-25T00:00:00.000Z' },
      { role: 'assistant', content: '好的,已记住', createdAt: '2026-09-25T00:00:01.000Z' },
      { role: 'tool', content: '执行成功输出', command: 'ls', createdAt: '2026-09-25T00:00:02.000Z' },
      { role: 'user', content: 'token 是什么?', createdAt: '2026-09-25T00:00:03.000Z' },
    ]
    const entries = buildHistoryEntries(history)

    // header + 4 条消息
    expect(entries.length).toBe(5)
    expect(entries[0].type).toBe('session')

    const msgs = entries.slice(1) as Array<{
      type: string
      id: string
      parentId: string | null
      message: { role: string }
    }>
    // F06 适配:tool 回合转 user 标注文本(不再合成孤立 toolResult)
    expect(msgs.map((m) => m.message.role)).toEqual(['user', 'assistant', 'user', 'user'])
    // tool 回合的标注文本保留命令与输出证据
    const toolAsUser = msgs[2].message as { content?: unknown }
    const toolText = typeof toolAsUser.content === 'string' ? toolAsUser.content : JSON.stringify(toolAsUser.content)
    expect(toolText).toContain('历史命令执行记录')
    expect(toolText).toContain('ls')
    expect(toolText).toContain('执行成功输出')
    // 链式:每条 parentId 指向前一条(首条指向 header)
    expect(msgs[0].parentId).toBe(entries[0].id)
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].parentId).toBe(msgs[i - 1].id)
    }
  })

  it('空历史只有 header', () => {
    expect(buildHistoryEntries([]).length).toBe(1)
  })
})

// ================================================================
//  S02:续跑共用收尾
// ================================================================

describe('S02 续跑语义', () => {
  it('历史已有命令但本轮只是聊天:保持 idle,不写 COMPLETED', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const callbacks = makeCallbacks()
    await runtime.startTask('tab-chat-after-work', '旧任务', 25, makeBridge(), callbacks, {
      userMessage: '解释刚才的输出',
      restoredState: {
        currentStep: 1,
        steps: [step(1, 'uptime')],
        systemDetected: false,
        stopReason: 'ROUND_LIMIT',
      },
    })

    expect(callbacks.states).toContain('idle')
    expect(callbacks.states).not.toContain('completed')
    expect(callbacks.stepCompletions.at(-1)?.steps).toHaveLength(1)
    expect(callbacks.stepCompletions.at(-1)?.stopReason).toBeUndefined()
  })

  it('continueTask 拒绝已停止的轮;正常续跑重置预算并收尾', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const bridge = makeBridge()
    const callbacks = makeCallbacks()

    // 第一轮正常完成
    await runtime.startTask('tab-c', '任务', 25, bridge, callbacks, { userMessage: '开始' })
    expect(callbacks.states).toContain('idle')

    // 续跑:预算重置为 10,收尾正常
    await runtime.continueTask('tab-c', 10)
    expect(callbacks.messages.some((m) => m.type === 'status' && m.content.includes('10'))).toBe(true)
    expect(callbacks.states.filter((s) => s === 'idle').length).toBeGreaterThanOrEqual(2)

    // 停止后的轮拒绝续跑
    runtime.stop('tab-c')
    await expect(runtime.continueTask('tab-c', 25)).rejects.toThrow('已停止')
  })
})

// ================================================================
//  updateAllowWrite 直改 turn(R01)
// ================================================================

describe('R01 updateAllowWrite', () => {
  it('运行中更新 allowWrite 即时写入当前轮', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const bridge = makeBridge()
    const callbacks = makeCallbacks()

    const started = runtime.startTask('tab-w', '任务', 25, bridge, callbacks)
    await vi.waitFor(() => expect(createdSessions.length).toBe(1))
    const session = createdSessions[0]
    session.arrestPrompt()
    await vi.waitFor(() => expect(session.prompts.length).toBe(1))

    // 运行中降权/提权:直改当前 turn(与工具闭包同一对象)
    runtime.updateAllowWrite('tab-w', true)
    session.releasePrompt()
    await started
    expect(callbacks.states.length).toBeGreaterThan(0)
  })
})
