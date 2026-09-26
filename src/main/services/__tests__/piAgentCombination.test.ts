/**
 * Pi 迁移第二轮组合场景测试(验收退回 F01/F02/F03)。
 *
 * 与单元测试的区别:测试**穿透真实适配层的工具调用链**——
 * mock 的 createAgentSession 捕获生产传入的 options.customTools,
 * stub prompt 像 SDK agent loop 一样真实调用工具 execute;
 * 终端互斥用两个**真实 TerminalBridge** 包同一个 fake session;
 * 降权走**实际 runtime.updateAllowWrite**。
 *
 * 覆盖:
 * - F01:同 tab 第二轮(reuse)与 continueTask 复用会话时,
 *   工具必须读当前轮/当前绑定(旧实现闭包捕获第一轮 turn/bridge → no_bound_terminal);
 * - F02:两个 bridge 包同一 session → 命令串行(锁 key 是底层 session,不是 bridge 包装);
 * - F03:命令排队期间降为只读 → 锁内下发边界重判 → 写命令不下发。
 *
 * mock 边界:模型 SDK(createAgentSession)与终端 I/O(fake session)被 mock;
 * 待验证对象——工具注册、轮次切换、锁、权限传播、事件——全部为生产代码。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'

// ================================================================
//  mock SDK:捕获 customTools;prompt 执行测试注册的脚本
// ================================================================

/** prompt 脚本:接收生产注册的 customTools,像 SDK 循环一样调用工具。 */
type PromptScript = (tools: Array<{ name: string; execute: (id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) => Promise<{ details: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }> }>) => Promise<void>

const promptScripts: PromptScript[] = []
const createdOptions: Array<{ customTools?: unknown[]; sessionManager?: unknown; model?: unknown }> = []

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()
  return {
    ...actual,
    createAgentSession: vi.fn(async (options: Record<string, unknown>) => {
      const listeners: Array<(e: AgentSessionEvent) => void> = []
      const stub = {
        prompts: [] as string[],
        disposed: false,
        prompt: vi.fn(async (text: string) => {
          stub.prompts.push(text)
          const script = promptScripts.shift()
          if (script) {
            await script((options.customTools ?? []) as never)
          }
        }),
        subscribe: vi.fn((listener: (e: AgentSessionEvent) => void) => {
          listeners.push(listener)
          return () => {
            const i = listeners.indexOf(listener)
            if (i >= 0) listeners.splice(i, 1)
          }
        }),
        abort: vi.fn(async () => {}),
        dispose: vi.fn(() => {
          stub.disposed = true
        }),
        getLastAssistantText: vi.fn(() => undefined),
        emit: (event: AgentSessionEvent) => {
          for (const l of [...listeners]) l(event)
        },
      }
      createdOptions.push(options as never)
      return { session: stub as unknown as AgentSession }
    }),
  }
})

// ---- 被测模块(mock 之后 import) ----

import { PiAgentRuntime } from '../piAgentRuntime'
import { createBoundTerminalTools } from '../piAgentTools'
import { TerminalBridge, type AnyTerminalSession } from '../terminalBridge'
import type { AgentGraphCallbacks } from '../agentGraph'
import type { StepRecord } from '../agentGraphState'

// ================================================================
//  fake 终端 session(记录 write,可控延迟与并发峰值)
// ================================================================

interface FakeTerminal {
  session: AnyTerminalSession
  /** write 收到的命令(带换行)。 */
  log: string[]
  /** 并发 write 峰值。 */
  peakWrite: () => number
  /** 挂起某条命令的 write(用于排队场景)。 */
  holdCommand: (cmdPart: string) => { release: () => void }
  setConnected: (v: boolean) => void
}

function makeFakeSession(): FakeTerminal {
  const log: string[] = []
  let inFlight = 0
  let peak = 0
  let connected = true
  let output = 'READY'
  let seq = 0
  const events = new EventEmitter()
  const held = new Map<string, () => void>()
  const session = {
    connected,
    tabId: `fake-${Math.random().toString(36).slice(2, 8)}`,
    sessionMeta: undefined,
    currentHost: undefined,
    write: async (cmd: string) => {
      const ready = cmd.match(/'__ZTERM_AGENT_READY_' '([a-f0-9]{32})__'/)
      if (ready) {
        events.emit('data', Buffer.from(`\r\n__ZTERM_AGENT_READY_${ready[1]}__:37\r\n`))
        return
      }
      inFlight++
      peak = Math.max(peak, inFlight)
      log.push(cmd)
      const key = [...held.keys()].find((k) => cmd.includes(k))
      if (key) {
        await new Promise<void>((resolve) => {
          const prev = held.get(key)
          held.set(key, () => { prev?.(); resolve() })
        })
      } else {
        await new Promise((r) => setTimeout(r, 5))
      }
      inFlight--
      output = `DONE-${++seq}`
      const done = cmd.match(/'__ZTERM_AGENT_END_' '([a-f0-9]{32})__'/)
      events.emit('data', Buffer.from(done
        ? `\r\n${output}\r\n__ZTERM_AGENT_END_${done[1]}__:0\r\n`
        : `\r\n${output}\r\n`))
    },
    getRecentOutput: () => output,
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
  } as unknown as AnyTerminalSession & { connected: boolean }
  Object.defineProperty(session, 'connected', { get: () => connected })
  return {
    session,
    log,
    peakWrite: () => peak,
    holdCommand: (cmdPart: string) => {
      const gate = { release: () => {} }
      const p = new Promise<void>((resolve) => { gate.release = resolve })
      // held 登记后,write 中匹配该片段的命令等待 release
      held.set(cmdPart, () => {})
      return {
        release: () => {
          const fn = held.get(cmdPart)
          held.delete(cmdPart)
          fn?.()
          void p
        },
      }
    },
    setConnected: (v: boolean) => { connected = v },
  }
}

// ================================================================
//  通用脚手架
// ================================================================

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
      cb.stepCompletions.push({ steps: data.steps, stopReason: data.stopReason, conclusion: data.conclusion })
    },
  } as AgentGraphCallbacks & RecordedCallbacks
}

function makeConfig(overrides?: Record<string, string>) {
  return {
    providerType: 'openai-compatible' as const,
    label: 'test',
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: 'k',
    model: 'm',
    enableStreaming: false,
    reasoningMode: 'auto' as const,
    ...overrides,
  }
}

/** 调用生产注册的工具(与 SDK 调用签名一致)。 */
async function execTool(
  tools: Parameters<PromptScript>[0],
  toolCallId: string,
  params: Record<string, unknown>
) {
  const t = tools.find((x) => x.name === 'execute_bound_terminal')
  if (!t) throw new Error('execute_bound_terminal not registered')
  return t.execute(toolCallId, params, undefined, undefined, undefined)
}

beforeEach(() => {
  promptScripts.length = 0
  createdOptions.length = 0
})

afterEach(() => {
  promptScripts.length = 0
})

// ================================================================
//  F01:第二轮 reuse / continueTask 复用会话时的工具调用
// ================================================================

describe('F01 第二轮与续跑的真实工具调用', () => {
  it('reuse 第二轮:工具用当前 bridge/turn 执行成功,预算从 0,步骤连续,旧 bridge 不再使用', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const fake1 = makeFakeSession()
    const fake2 = makeFakeSession()
    const bridge1 = new TerminalBridge(fake1.session)
    const bridge2 = new TerminalBridge(fake2.session)
    const callbacks = makeCallbacks()

    // ---- 第一轮:rebuild,工具对 bridge1 正常执行 ----
    promptScripts.push(async (tools) => {
      const r = await execTool(tools, 't1', { command: 'uptime' })
      expect(r.details.error).toBeUndefined()
    })
    await runtime.startTask('tab-f1', '任务', 25, bridge1, callbacks, { userMessage: '第一轮' })
    expect(fake1.log.some((l) => l.includes('uptime'))).toBe(true)
    expect(callbacks.states).toContain('completed') // 有命令执行 → completed

    // ---- 第二轮:reuse + 重新绑定 bridge2 ----
    promptScripts.push(async (tools) => {
      const r = await execTool(tools, 't2', { command: 'df -h' })
      // F01 核心:不能是 no_bound_terminal(旧实现闭包读第一轮已停止的 turn)
      expect(r.details.error).toBeUndefined()
    })
    await runtime.startTask(
      'tab-f1', '任务', 25, bridge2, callbacks,
      {
        userMessage: '第二轮追问',
        sessionPolicy: 'reuse',
        restoredState: { steps: [{ stepNumber: 1, plan: '', command: 'uptime', observation: 'o', status: 'done' }], currentStep: 1, systemDetected: false, stopReason: null },
      }
    )
    // 命令落在当前 bridge2,不是旧 bridge1
    expect(fake2.log.some((l) => l.includes('df -h'))).toBe(true)
    const writesToOld = fake1.log.filter((l) => l.includes('df -h')).length
    expect(writesToOld).toBe(0)
    // 步骤连续:第二轮新步骤号 = 2(基于 restoredState 的 1)
    const last = callbacks.stepCompletions[callbacks.stepCompletions.length - 1]
    expect(last.steps.some((s) => s.stepNumber === 2 && s.command === 'df -h')).toBe(true)
  })

  it('reuse 第二轮预算从 0 起:maxSteps=1 时第二条被拒', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const fake = makeFakeSession()
    const bridge = new TerminalBridge(fake.session)
    const callbacks = makeCallbacks()

    promptScripts.push(async () => {})
    await runtime.startTask('tab-f1b', '任务', 25, bridge, callbacks)

    promptScripts.push(async (tools) => {
      const r1 = await execTool(tools, 't1', { command: 'uptime' })
      expect(r1.details.error).toBeUndefined()
      const r2 = await execTool(tools, 't2', { command: 'df -h' })
      // 第二轮预算 1:第二条耗尽
      expect(r2.details.error).toBe('budget_exhausted')
    })
    await runtime.startTask('tab-f1b', '任务', 1, bridge, callbacks, {
      userMessage: '追问', sessionPolicy: 'reuse',
    })
    // 第二轮预算 1:uptime 放行、df -h 被拒 → 本轮恰好 1 条 write
    expect(fake.log.filter((l) => l.trim()).length).toBe(1)
    expect(fake.log.some((l) => l.includes('uptime'))).toBe(true)
    expect(fake.log.some((l) => l.includes('df -h'))).toBe(false)
  })

  it('continueTask 实际执行工具(当前轮/当前绑定)', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const fake = makeFakeSession()
    const bridge = new TerminalBridge(fake.session)
    const callbacks = makeCallbacks()

    promptScripts.push(async () => {})
    await runtime.startTask('tab-f1c', '任务', 25, bridge, callbacks)

    promptScripts.push(async (tools) => {
      const r = await execTool(tools, 't-cont', { command: 'free -m' })
      expect(r.details.error).toBeUndefined()
    })
    await runtime.continueTask('tab-f1c', 5)
    expect(fake.log.some((l) => l.includes('free -m'))).toBe(true)
  })
})

// ================================================================
//  F02:互斥锁锁底层 session,不是 bridge 包装
// ================================================================

describe('F02 两个 bridge 包同一 session:真实终端互斥', () => {
  it('并发执行区间不重叠(峰值 1);不同 session 互不阻塞', async () => {
    const shared = makeFakeSession()
    const bridgeA = new TerminalBridge(shared.session)
    const bridgeB = new TerminalBridge(shared.session)
    // 不同 session:独立执行
    const other = makeFakeSession()

    const makeCtx = (bridge: TerminalBridge) => {
      const turn = {
        running: true, stopped: false, cancelled: false,
        maxSteps: 25, commandsUsed: 0, readCallsUsed: 0,
        budgetExhausted: false, readLimitExhausted: false, uncertainResult: false,
        steps: [] as StepRecord[],
        allowWrite: false, boundHost: 'h',
        executedToolCallIds: new Set<string>(),
        unknownWriteCommands: new Set<string>(),
        callbacks: {
          emitMessage() {},
          emitStateChange() {},
          getTerminalContext() { return null },
          onStepComplete() {},
        },
      }
      // G01 后 ctx 只含 bridge/turn(记录由 bindCallContext 用绑定 turn)
      return { bridge, turn }
    }

    const toolsA = createBoundTerminalTools(makeCtx(bridgeA))
    const toolsB = createBoundTerminalTools(makeCtx(bridgeB))
    const toolsOther = createBoundTerminalTools(makeCtx(new TerminalBridge(other.session)))
    const exec = (tools: ReturnType<typeof createBoundTerminalTools>, id: string, cmd: string) => {
      const t = tools.find((x) => x.name === 'execute_bound_terminal')!
      return (t as unknown as { execute: (i: string, p: unknown, s?: AbortSignal, u?: unknown, c?: unknown) => Promise<{ details: Record<string, unknown> }> })
        .execute(id, { command: cmd }, undefined, undefined, undefined)
    }

    // 同一 session 的两个 bridge:并发 → 串行
    await Promise.all([
      exec(toolsA, 'a1', 'uptime'),
      exec(toolsB, 'b1', 'df -h'),
    ])
    // F02 核心:峰值必须是 1(旧实现对 bridge 包装加锁 → 2)
    expect(shared.peakWrite()).toBe(1)

    // 不同 session:互不阻塞(两条并行,各自峰值 1)
    await Promise.all([
      exec(toolsOther, 'o1', 'uptime'),
      exec(toolsA, 'a2', 'uptime'),
    ])
    expect(shared.peakWrite()).toBe(1)
    expect(other.peakWrite()).toBe(1)
  })
})

// ================================================================
//  F03:命令排队期间降权,写命令不得下发
// ================================================================

describe('F03 排队期间降为只读', () => {
  it('写命令在队列中等待时 updateAllowWrite(false) → 锁内重判 → 不下发且报安全拦截', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const fake = makeFakeSession()
    const bridge = new TerminalBridge(fake.session)
    const callbacks = makeCallbacks()

    // 第一条命令占住锁(hold),第二条写命令排队,排队后降权
    const held = fake.holdCommand('cat /etc/hostname')
    let resultB: { details: Record<string, unknown> } | undefined
    promptScripts.push(async (tools) => {
      const pA = execTool(tools, 'a', { command: 'cat /etc/hostname' })
      // 等 A 真正占锁(write 已进入)
      await vi.waitFor(() => {
        if (!fake.log.some((l) => l.includes('cat /etc/hostname'))) throw new Error('not yet')
      }, { timeout: 2000 })
      // B:写命令在写模式下先排队(锁被 A 占用)
      const pB = execTool(tools, 'b', { command: 'touch /tmp/mock-not-actually-created' })
      // 排队期间:用户降权(走真实 runtime API)
      runtime.updateAllowWrite('tab-f3', false)
      held.release()
      resultB = await pB
      await pA
    })

    await runtime.startTask('tab-f3', '任务', 25, bridge, callbacks, {
      userMessage: '检查', allowWrite: true,
    })

    // F03 核心:写命令不得下发
    expect(fake.log.some((l) => l.includes('touch /tmp/mock-not-actually-created'))).toBe(false)
    // 且以安全拦截结果返回(不是静默成功)
    expect(resultB?.details.blocked).toBe(true)
    // 只读命令正常执行,锁可继续服务
    expect(fake.log.some((l) => l.includes('cat /etc/hostname'))).toBe(true)
  })
})

// ================================================================
//  F04:配置传播(真实配置更新入口 → 新轮拿到 B)
// ================================================================

describe('F04 配置变化传播到新轮', () => {
  it('reuse 分支:配置变化强制 rebuild,新轮用配置 B(受控 fixture 见 createdOptions)', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig({ baseUrl: 'http://a/v1', apiKey: 'key-a', model: 'model-a' }))
    const fake = makeFakeSession()
    const bridge = new TerminalBridge(fake.session)
    const callbacks = makeCallbacks()

    // 第一轮:配置 A
    promptScripts.push(async () => {})
    await runtime.startTask('tab-f4', '任务', 25, bridge, callbacks)
    // 传给 createAgentSession 的 model 是 A
    const firstOpts = createdOptions[createdOptions.length - 1] as { model?: { baseUrl?: string; id?: string } }
    expect(firstOpts?.model?.baseUrl).toBe('http://a/v1')
    expect(firstOpts?.model?.id).toBe('model-a')

    // 配置更新入口(F04:真实路径是 controller.init → runtime.updateConfig)
    runtime.updateConfig(makeConfig({ baseUrl: 'http://b/v1', apiKey: 'key-b', model: 'model-b' }))

    // 第二轮:reuse 政策 —— 但配置指纹变化必须 rebuild,新轮用 B
    promptScripts.push(async () => {})
    await runtime.startTask('tab-f4', '任务', 25, bridge, callbacks, {
      userMessage: '追问', sessionPolicy: 'reuse',
    })
    const secondOpts = createdOptions[createdOptions.length - 1] as { model?: { baseUrl?: string; id?: string } }
    expect(secondOpts?.model?.baseUrl).toBe('http://b/v1')
    expect(secondOpts?.model?.id).toBe('model-b')
    // rebuild 发生:两个不同的 session 实例(stub 每次 createAgentSession 新建)
    // 通过 createdOptions 数量增长断言新会话创建
    expect(createdOptions.length).toBeGreaterThanOrEqual(2)
  })
})

// ================================================================
//  F06:历史导入合法性(真实 SessionManager → 真实消息转换)
// ================================================================

describe('F06 历史转换:无孤立 tool role,当前问句恰一次', () => {
  it('真实 buildSessionContext 转换导入历史:tool 回合转 user 标注文本,无孤立 toolResult', async () => {
    const { buildHistoryEntries } = await import('../piAgentRuntime')
    const { SessionManager: RealSessionManager } = await import('@earendil-works/pi-coding-agent')

    const history = [
      { role: 'user', content: '检查负载', createdAt: '2026-09-25T00:00:00.000Z' },
      { role: 'assistant', content: '我来查看 uptime', createdAt: '2026-09-25T00:00:01.000Z' },
      { role: 'tool', content: 'load average: 0.5', command: 'uptime', createdAt: '2026-09-25T00:00:02.000Z' },
      { role: 'user', content: '现在内存呢?', createdAt: '2026-09-25T00:00:03.000Z' },
    ] as never[]

    // 当前问句剔除:导入历史尾部不再是"现在内存呢?"
    const entries = buildHistoryEntries(history as never, {
      dropTrailingUserMessage: '现在内存呢?',
    })
    // 真实 SessionManager + 真实 buildSessionContext 转换
    const sm = RealSessionManager.inMemory('/tmp/zterm-pi-agent', undefined, entries)
    const ctx = sm.buildSessionContext()
    const roles = ctx.messages.map((m: { role: string }) => m.role)

    // 无孤立 toolResult(F06 核心:旧实现合成 toolResult → role:'tool')
    expect(roles).not.toContain('toolResult')
    expect(roles).not.toContain('tool')
    // user / assistant / user(标注文本) —— tool 回合转 user 文本
    expect(roles.filter((r: string) => r === 'user').length).toBe(2)
    expect(roles.filter((r: string) => r === 'assistant').length).toBe(1)
    // 旧命令正文与输出证据保留在标注文本里
    const allText = ctx.messages
      .map((m) => {
        const c = (m as { content: unknown }).content
        return typeof c === 'string' ? c : ''
      })
      .join('\n')
    expect(allText).toContain('uptime')
    expect(allText).toContain('load average: 0.5')
    expect(allText).toContain('历史命令执行记录')
    // 当前问句不再重复出现
    expect(allText).not.toContain('现在内存呢?')
  })
})

// ================================================================
//  F07:工具正文进入 observation 事件
// ================================================================

describe('F07 真实工具输出进入 observation', () => {
  it('tool_execution_end 的 result.content(CPU=17%)进入 observation 正文', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const fake = makeFakeSession()
    const bridge = new TerminalBridge(fake.session)
    const callbacks = makeCallbacks()

    // 脚本:真实执行工具(uptime),然后注入一个带 content 的
    // tool_execution_end(SDK 真实形状:result.content 有文本)
    promptScripts.push(async (tools) => {
      await execTool(tools, 't1', { command: 'uptime' })
    })
    await runtime.startTask('tab-f7', '任务', 25, bridge, callbacks)
    const session = runtimeTabSession(runtime as never)
    session.emit({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'execute_bound_terminal',
      result: {
        content: [{ type: 'text', text: 'CPU=17% load=0.42' }],
        details: { command: 'uptime', stepNumber: 1, duration: 250, fidelity: 'observed' },
      },
      isError: false,
    } as never)

    const obs = callbacks.messages.find((m) => m.type === 'observation')
    // F07 核心:真实输出进入 observation,不再是固定"命令执行完成"
    expect(obs).toBeTruthy()
    expect(obs?.content).toContain('CPU=17%')
    expect(obs?.content).toContain('load=0.42')
  })
})

/** 测试辅助:从 runtime 内部 tabs 拿当前 session(触发事件注入)。 */
function runtimeTabSession(runtime: never): { emit: (e: never) => void } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tabs = (runtime as unknown as { tabs: Map<string, { session: { emit: (e: never) => void } | null }> }).tabs
  for (const tab of tabs.values()) {
    if (tab.session) return tab.session
  }
  throw new Error('no session in runtime tabs')
}

// ================================================================
//  F08:重试终态与 thinking 跨轮卡片
// ================================================================

describe('F08 重试终态与 thinking 卡片生命周期', () => {
  it('error → 重试成功:终态 completed,不是 failed', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const fake = makeFakeSession()
    const bridge = new TerminalBridge(fake.session)
    const callbacks = makeCallbacks()

    promptScripts.push(async () => {})
    // 先挂起会话:直接用 arrestNextSession 机制不可用(本文件 stub 无门控),
    // 改为在脚本中同步注入事件后立即返回(prompt 尚未 resolve 时事件已处理)
    // —— 事件处理是同步的,prompt resolve 前 emit 即可
    const started = runtime.startTask('tab-f8a', '任务', 25, bridge, callbacks)
    // 注入:error 后 auto_retry 成功
    const session = (await vi.waitFor(() => {
      const s = runtimeTabSession(runtime as never)
      if (!s) throw new Error('waiting')
      return s
    })) as { emit: (e: never) => void }
    session.emit({
      type: 'message_end',
      message: {
        role: 'assistant', content: [], api: 'openai-completions',
        provider: 'zterm-openai-completions', model: 'm',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'error', errorMessage: '过载', timestamp: Date.now(),
      },
    } as never)
    session.emit({ type: 'auto_retry_end', success: true } as never)
    session.emit({
      type: 'message_end',
      message: {
        role: 'assistant', content: [{ type: 'text', text: '重试后成功回复' }],
        api: 'openai-completions', provider: 'zterm-openai-completions', model: 'm',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop', timestamp: Date.now(),
      },
    } as never)
    await started

    // F08:重试成功 → 不判失败
    expect(callbacks.states[callbacks.states.length - 1]).not.toBe('failed')
    expect(callbacks.messages.some((m) => m.type === 'assistant_reply' && m.content.includes('重试后成功'))).toBe(true)
  })

  it('thinkingId 带轮次 uid:连续两轮的 thinking 卡片各自保留', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const fake = makeFakeSession()
    const bridge = new TerminalBridge(fake.session)
    const callbacks = makeCallbacks()

    // 两轮,每轮注入一段 thinking_delta + message_end
    for (let round = 0; round < 2; round++) {
      promptScripts.push(async () => {})
      const sessionCountBefore = createdOptions.length
      const started = runtime.startTask('tab-f8b', `任务${round}`, 25, bridge, callbacks, {
        userMessage: `第${round + 1}轮`,
      })
      // rebuild:等待本轮的新 session 创建完成再注入事件
      await vi.waitFor(() => {
        if (createdOptions.length <= sessionCountBefore) throw new Error('waiting new session')
      })
      const session = runtimeTabSession(runtime as never)
      session.emit({
        type: 'message_update',
        message: { role: 'assistant', content: [], api: 'openai-completions', provider: 'p', model: 'm', usage: null, stopReason: 'stop', timestamp: Date.now() },
        assistantMessageEvent: { type: 'thinking_delta', delta: `第${round + 1}轮思考` },
      } as never)
      session.emit({
        type: 'message_end',
        message: {
          role: 'assistant', content: [{ type: 'text', text: `第${round + 1}轮回复` }],
          api: 'openai-completions', provider: 'zterm-openai-completions', model: 'm',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop', timestamp: Date.now(),
        },
      } as never)
      await started
    }

    // F08:两轮的 thinking thinkingId 不同(uid 递增),renderer 不会互相覆盖
    const streamings = callbacks.messages.filter((m) => m.type === 'thinking' && m.details?.streaming === true)
    expect(streamings.length).toBe(2)
    const ids = new Set(streamings.map((m) => m.details?.thinkingId as string))
    expect(ids.size).toBe(2)
    expect(streamings[0].content).toBe('第1轮思考')
    expect(streamings[1].content).toBe('第2轮思考')
  })
})

// ================================================================
//  G05/I02:loader 隔离(构造注入,非环境变量冒充;邻居配置不变)
// ================================================================

describe('G05/I02 loader 全链路隔离(构造注入)', () => {
  it('独立测试目录写入 packages 配置不被采纳;相邻"非测试拥有配置"保持不变', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')

    // 测试拥有目录(沙箱 TMPDIR 内,非生产 PI_SANDBOX_DIR)
    const ownDir = mkdtempSync(path.join(os.tmpdir(), 'zterm-g5-own-'))
    // 相邻的"非测试拥有"目录:预置配置并断言其内容在测试全程不变
    const neighborDir = mkdtempSync(path.join(os.tmpdir(), 'zterm-g5-neighbor-'))
    const neighborSettings = JSON.stringify({ packages: ['neighbor-owned-pkg'], model: 'neighbor-model' })
    fs.writeFileSync(path.join(neighborDir, 'settings.json'), neighborSettings, 'utf-8')

    try {
      // 测试拥有的 fixture:ownDir 下写入含 packages 的 settings.json
      fs.writeFileSync(path.join(ownDir, 'settings.json'), JSON.stringify({ packages: ['some-missing-pkg'] }), 'utf-8')

      // I02:经**生产构造选项**注入 agentDir(不再用 PI_AGENT_DIR 环境变量
      // 冒充被测 loader 目录 —— 生产 loader 目录是常量,环境变量不改变它)
      const runtime = new PiAgentRuntime(undefined as never, makeConfig(), { agentDir: ownDir })
      const fake = makeFakeSession()
      const bridge = new TerminalBridge(fake.session)
      const callbacks = makeCallbacks()

      promptScripts.push(async () => {})
      await runtime.startTask('tab-g5', '任务', 25, bridge, callbacks)

      // 会话正常创建、无错误(隔离不破坏正常路径)
      expect(callbacks.messages.some((m) => m.type === 'error')).toBe(false)
      // 注入的 settings 来源是宿主内存实例,packages 不被采纳
      const opts = createdOptions[createdOptions.length - 1] as {
        settingsManager?: { getGlobalSettings?: () => unknown }
      }
      expect(opts?.settingsManager).toBeTruthy()
      const global = opts?.settingsManager?.getGlobalSettings?.() as { packages?: string[] } | undefined
      expect(global?.packages ?? []).not.toContain('some-missing-pkg')
      // 被测 loader 的目录正是注入的 ownDir(注入直接证明)
      const runtimeAny = runtime as unknown as { loader?: { cwd?: string; agentDir?: string } }
      expect(runtimeAny.loader?.cwd).toBe(ownDir)
      expect(runtimeAny.loader?.agentDir).toBe(ownDir)

      // G05 核心:相邻"非测试拥有配置"内容保持不变
      const after = fs.readFileSync(path.join(neighborDir, 'settings.json'), 'utf-8')
      expect(after).toBe(neighborSettings)
    } finally {
      // cleanup 只作用于本次拥有的路径
      rmSync(ownDir, { recursive: true, force: true })
      rmSync(neighborDir, { recursive: true, force: true })
    }
  })
})

// ================================================================
//  S01 欠的断言:ROUND_LIMIT 实断言
// ================================================================

describe('S01 补充:ROUND_LIMIT 收尾实断言', () => {
  it('预算耗尽工具触发后:stopReason=ROUND_LIMIT,状态 stepLimitReached,不被 completed 覆盖', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const fake = makeFakeSession()
    const bridge = new TerminalBridge(fake.session)
    const callbacks = makeCallbacks()

    // maxSteps=1:第一条放行,第二条触发预算耗尽(budgetExhausted 置位)
    promptScripts.push(async (tools) => {
      await execTool(tools, 't1', { command: 'uptime' })
      await execTool(tools, 't2', { command: 'df -h' })
    })
    await runtime.startTask('tab-s1a', '任务', 1, bridge, callbacks)

    // ROUND_LIMIT 落库
    const last = callbacks.stepCompletions[callbacks.stepCompletions.length - 1]
    expect(last.stopReason).toBe('ROUND_LIMIT')
    // 状态收敛到 stepLimitReached
    expect(callbacks.states[callbacks.states.length - 1]).toBe('stepLimitReached')
    // 之后没有 completed(不被覆盖)
    expect(callbacks.states).not.toContain('completed')
    // 预算耗尽的状态提示消息存在
    expect(callbacks.messages.some((m) => m.type === 'status' && m.content.includes('预算已耗尽'))).toBe(true)
    // 第一条命令实际执行了(预算 1 用在真实执行上)
    expect(fake.log.some((l) => l.includes('uptime'))).toBe(true)
    expect(fake.log.some((l) => l.includes('df -h'))).toBe(false)
  })
})

// ================================================================
//  G04:三处初始化窗口的 entered/release 门控真测
//  (每个窗口:先等待"确实进入",再停止,再放行,断言 no prompt/dispose)
// ================================================================

describe('G04 初始化窗口门控真测', () => {
  it('窗口 1(loader reload):等待进入后停止,session 从未创建', async () => {
    const { DefaultResourceLoader } = await import('@earendil-works/pi-coding-agent')
    const origReload = DefaultResourceLoader.prototype.reload
    let entered = false
    let releaseLoader: () => void = () => {}
    const gate = new Promise<void>((r) => { releaseLoader = r })
    DefaultResourceLoader.prototype.reload = async function (this: unknown) {
      entered = true // G04:entered 信号 —— 生产代码确实到达本窗口
      await gate
      return (origReload as () => Promise<void>).apply(this)
    } as never

    try {
      const runtime = new PiAgentRuntime(undefined as never, makeConfig())
      const started = runtime.startTask('tab-w1', '任务', 25, new TerminalBridge(makeFakeSession().session), makeCallbacks())
      // G04:先等生产代码确实进入 loader 窗口,再停止
      await vi.waitFor(() => { if (!entered) throw new Error('not entered') }, { timeout: 2000 })
      runtime.stop('tab-w1')
      releaseLoader()
      await started
      // loader 窗口内取消:session 从未创建
      expect(createdOptions.length).toBe(0)
    } finally {
      DefaultResourceLoader.prototype.reload = origReload
    }
  })

  it('窗口 2(模型初始化):等待进入后停止,session 从未创建', async () => {
    const mod = await import('../piModelAdapter')
    const orig = mod.buildPiModelSetup
    let entered = false
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const spy = vi.spyOn(mod, 'buildPiModelSetup').mockImplementation(async (c) => {
      entered = true // G04:entered 信号
      await gate
      return orig(c)
    })

    try {
      const runtime = new PiAgentRuntime(undefined as never, makeConfig())
      const started = runtime.startTask('tab-w2', '任务', 25, new TerminalBridge(makeFakeSession().session), makeCallbacks())
      await vi.waitFor(() => { if (!entered) throw new Error('not entered') }, { timeout: 2000 })
      runtime.stop('tab-w2')
      release()
      await started
      expect(createdOptions.length).toBe(0)
      expect(entered).toBe(true) // 到达次数:模型初始化确实被进入
    } finally {
      spy.mockRestore()
    }
  })

  it('窗口 3(session 创建):挂起 createAgentSession,取消后返回的 session 被立即 dispose 且不 prompt', async () => {
    const { createAgentSession } = await import('@earendil-works/pi-coding-agent')
    const orig = createAgentSession as unknown as ReturnType<typeof vi.fn>
    let entered = false
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    // 本窗口的 stub session 记录(组合文件作用域)
    const window3Sessions: Array<{ prompts: string[]; disposed: boolean }> = []
    const mocked = orig as unknown as { mockImplementation: (fn: unknown) => void }
    mocked.mockImplementation(async (options: Record<string, unknown>) => {
      entered = true // G04:entered 信号 —— 生产代码确实进入 session 创建窗口
      await gate
      const stub = {
        prompts: [] as string[],
        disposed: false,
        prompt: async (text: string) => { stub.prompts.push(text) },
        subscribe: () => () => {},
        abort: async () => {},
        dispose: () => { stub.disposed = true },
        getLastAssistantText: () => undefined,
      }
      createdOptions.push(options)
      window3Sessions.push(stub)
      return { session: stub }
    })

    try {
      const runtime = new PiAgentRuntime(undefined as never, makeConfig())
      const started = runtime.startTask('tab-w3', '任务', 25, new TerminalBridge(makeFakeSession().session), makeCallbacks())
      await vi.waitFor(() => { if (!entered) throw new Error('not entered') }, { timeout: 2000 })
      // session 创建挂起中停止
      runtime.stop('tab-w3')
      release()
      await started
      // 取消后才返回的 session:立即 dispose、零 prompt
      expect(window3Sessions.length).toBe(1)
      expect(window3Sessions[0].disposed).toBe(true)
      expect(window3Sessions[0].prompts.length).toBe(0)
    } finally {
      // 恢复原始 mock 实现(交还文件顶部工厂行为)
      mocked.mockImplementation(async (options: Record<string, unknown>) => {
        return (orig as unknown as (o: Record<string, unknown>) => Promise<unknown>)(options)
      })
    }
  })
})
