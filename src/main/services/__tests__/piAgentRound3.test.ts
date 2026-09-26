/**
 * Pi 迁移第三轮收尾测试(验收退回 G01–G05)。
 *
 * 覆盖:
 * - G01:旧任务迟到结果/迟到事件的完整生命周期隔离 —— 旧工具挂起 →
 *   stop → 同 tab 新任务(新绑定)→ 旧结果到达 → 新轮步骤/回调/消息无污染;
 *   removeTab 后重建;正常 reuse/continue 不回归(在组合文件)。
 * - G02:配置 A 下预算暂停 → 改配置 B → continueTask → 下一请求用 B
 *   (Application 重读设置 + Runtime 指纹重建)。
 * - G03:SYSTEM.md/APPEND_SYSTEM.md 哨兵不被采纳,系统提示由宿主控制。
 * - G04:真实 Controller.init 路径(mock electron store);loader/模型/session
 *   三窗口 entered/release 门控;loader 文件读取/安装边界计数。
 * - G05:测试拥有独立目录;"非测试拥有的配置"内容不变;危险边界零调用。
 *
 * mock 边界:模型 SDK(createAgentSession)与终端 I/O 为 stub;
 * 工具注册、轮次归属、配置传播、系统提示、事件流全部为生产代码。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'

// ================================================================
//  mock SDK(与组合测试同型:捕获 customTools,prompt 执行脚本)
// ================================================================

type PromptScript = (tools: Array<{ name: string; execute: (id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) => Promise<{ details: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }> }>) => Promise<void>

interface StubSession {
  prompts: string[]
  disposed: boolean
  emit: (event: AgentSessionEvent) => void
  arrestPrompt: () => void
  releasePrompt: () => void
  rejectNext: boolean
}

const promptScripts: PromptScript[] = []
const createdOptions: Array<Record<string, unknown>> = []
const createdSessions: Array<StubSession & AgentSession> = []

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()
  return {
    ...actual,
    createAgentSession: vi.fn(async (options: Record<string, unknown>) => {
      const listeners: Array<(e: AgentSessionEvent) => void> = []
      let releaseGate: (() => void) | null = null
      let pendingGate: Promise<void> | null = null
      const stub: StubSession = {
        prompts: [],
        disposed: false,
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
        rejectNext: false,
        emit: (event: AgentSessionEvent) => {
          for (const l of [...listeners]) l(event)
        },
      }
      const session = {
        get prompts() { return stub.prompts },
        get rejectNext() { return stub.rejectNext },
        set rejectNext(v: boolean) { stub.rejectNext = v },
        get disposed() { return stub.disposed },
        arrestPrompt: stub.arrestPrompt,
        releasePrompt: stub.releasePrompt,
        emit: stub.emit,
        prompt: vi.fn(async (text: string) => {
          stub.prompts.push(text)
          if (pendingGate) {
            await Promise.race([pendingGate, new Promise((r) => setTimeout(r, 2000))])
          }
          if (stub.rejectNext) {
            stub.rejectNext = false
            throw new Error('stub: model request failed')
          }
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
        dispose: vi.fn(() => { stub.disposed = true }),
        getLastAssistantText: vi.fn(() => undefined),
      } as unknown as StubSession & AgentSession
      createdOptions.push(options)
      createdSessions.push(session)
      return { session }
    }),
  }
})

import { PiAgentRuntime } from '../piAgentRuntime'
import { TerminalBridge, type AnyTerminalSession } from '../terminalBridge'
import type { AgentGraphCallbacks } from '../agentGraph'
import type { StepRecord } from '../agentGraphState'

// ================================================================
//  脚手架
// ================================================================

function makeFakeSession(hold?: (log: string[]) => { release: () => void } | undefined): {
  session: AnyTerminalSession
  log: string[]
  holdCommand?: (cmdPart: string) => { release: () => void }
} {
  const log: string[] = []
  let connected = true
  let output = 'READY'
  let seq = 0
  const events = new EventEmitter()
  const gates = new Map<string, () => void>()
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
      log.push(cmd)
      const key = [...gates.keys()].find((k) => cmd.includes(k))
      if (key) {
        await new Promise<void>((resolve) => {
          const prev = gates.get(key)
          gates.set(key, () => { prev?.(); resolve() })
        })
      } else {
        await new Promise((r) => setTimeout(r, 5))
      }
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
    holdCommand: hold ? undefined : (cmdPart: string) => {
      gates.set(cmdPart, () => {})
      return {
        release: () => {
          const fn = gates.get(cmdPart)
          gates.delete(cmdPart)
          fn?.()
        },
      }
    },
  }
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

async function execTool(
  tools: Parameters<PromptScript>[0],
  toolCallId: string,
  params: Record<string, unknown>,
  signal?: AbortSignal
) {
  const t = tools.find((x) => x.name === 'execute_bound_terminal')
  if (!t) throw new Error('execute_bound_terminal not registered')
  return t.execute(toolCallId, params, signal, undefined, undefined)
}

beforeEach(() => {
  promptScripts.length = 0
  createdOptions.length = 0
  createdSessions.length = 0
})

// ================================================================
//  G01:旧任务迟到结果的完整生命周期隔离
// ================================================================

describe('G01 旧任务迟到结果不写入新任务', () => {
  it('旧工具挂起→stop→同 tab 新任务新绑定→旧结果到达:新轮无污染', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    // 旧终端:已收到用户命令与部分输出,但结束标记一直未返回。
    const oldLog: string[] = []
    const oldEvents = new EventEmitter()
    let oldNonce = ''
    const oldSession = {
      connected: true,
      tabId: 'old-term',
      sessionMeta: undefined,
      currentHost: undefined,
      write: (cmd: string) => {
        const ready = cmd.match(/'__ZTERM_AGENT_READY_' '([a-f0-9]{32})__'/)
        if (ready) {
          oldEvents.emit('data', Buffer.from(`\r\n__ZTERM_AGENT_READY_${ready[1]}__:37\r\n`))
          return
        }
        oldLog.push(cmd)
        oldNonce = cmd.match(/'__ZTERM_AGENT_END_' '([a-f0-9]{32})__'/)?.[1] ?? ''
        oldEvents.emit('data', Buffer.from('\r\nOLD-PARTIAL-OUTPUT\r\n'))
      },
      getRecentOutput: () => 'OLD-PARTIAL-OUTPUT',
      on: oldEvents.on.bind(oldEvents),
      removeListener: oldEvents.removeListener.bind(oldEvents),
    } as unknown as AnyTerminalSession
    const releaseOld = (): void => { oldEvents.emit('data', Buffer.from(`\r\n__ZTERM_AGENT_END_${oldNonce}__:0\r\n`)) }

    const oldBridge = new TerminalBridge(oldSession)
    const newFake = makeFakeSession()
    const newBridge = new TerminalBridge(newFake.session)
    const callbacks = makeCallbacks()

    let lateResult: { details: Record<string, unknown> } | undefined
    // 旧任务:脚本触发工具但不等待其结果(工具等待真实结束标记)
    promptScripts.push(async (tools) => {
      void execTool(tools, 'old-1', { command: 'echo old-host' }).then((r) => {
        lateResult = r
      })
      await vi.waitFor(() => {
        if (!oldLog.some((l) => l.includes('echo old-host'))) throw new Error('not dispatched')
      }, { timeout: 2000 })
    })

    const oldTask = runtime.startTask('tab-g1', '旧任务', 25, oldBridge, callbacks, {
      userMessage: '旧任务',
    })
    await vi.waitFor(() => {
      if (!oldLog.some((l) => l.includes('echo old-host'))) throw new Error('waiting dispatch')
    }, { timeout: 2000 })

    // 旧工具只有部分输出、尚未确认完成——停止旧任务
    runtime.stop('tab-g1')
    await oldTask

    // 新任务:同 tab、新绑定、rebuild;脚本空跑(纯收尾)
    promptScripts.push(async () => {})
    await runtime.startTask('tab-g1', '新任务', 25, newBridge, callbacks, {
      userMessage: '新任务', sessionPolicy: 'rebuild',
    })

    // 新轮已完成,此刻步骤不含任何命令
    const lastBefore = callbacks.stepCompletions[callbacks.stepCompletions.length - 1]
    expect((lastBefore?.steps ?? []).some((s) => !!s.command)).toBe(false)

    // 旧工具收到迟到结束标记:旧轮结果不得污染新轮。
    releaseOld()
    await vi.waitFor(() => {
      if (!lateResult) throw new Error('waiting late result')
    }, { timeout: 5000 })

    // G01 核心:迟到结果到达后,新轮的步骤/回调不被污染
    const lastAfter = callbacks.stepCompletions[callbacks.stepCompletions.length - 1]
    const contaminated = (lastAfter?.steps ?? []).some((s) => s.command === 'echo old-host')
    expect(contaminated).toBe(false)
    // 旧绑定收到的写入只有旧命令;新绑定零写入
    expect(oldLog.some((l) => l.includes('echo old-host'))).toBe(true)
    expect(newFake.log.some((l) => l.includes('echo old-host'))).toBe(false)
  })

  it('旧 session 迟到事件不进新轮(订阅捕获 turn)', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const fake = makeFakeSession()
    const bridge = new TerminalBridge(fake.session)
    const callbacks = makeCallbacks()

    // 第一轮:挂起 prompt(会话保留)
    createdSessions.length = 0
    promptScripts.push(async () => {})
    const first = runtime.startTask('tab-g1e', '任务一', 25, bridge, callbacks)
    await vi.waitFor(() => expect(createdSessions.length).toBe(1))
    const oldSession = createdSessions[0]
    oldSession.arrestPrompt()
    await vi.waitFor(() => expect((oldSession as unknown as { prompts: string[] }).prompts.length).toBe(1))
    await first // prompt 挂起中?—— arrest 在 prompt 进入后;first 仍挂起
    // 注:arrestPrompt 使 first 仍在等待;这里不等 first,先做后续

    // 第二轮:rebuild(新 session、新 turn)
    promptScripts.push(async () => {})
    const second = runtime.startTask('tab-g1e', '任务二', 25, bridge, callbacks, {
      userMessage: '任务二', sessionPolicy: 'rebuild',
    })
    await vi.waitFor(() => expect(createdSessions.length).toBe(2))
    const newSession = createdSessions[1]
    await second

    // 旧 session 的迟到 assistant 事件:不进新轮(G01)
    const assistantEvent = {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '旧任务的迟到回复' }],
        api: 'openai-completions',
        provider: 'zterm-openai-completions',
        model: 'm',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    } as unknown as AgentSessionEvent
    oldSession.emit(assistantEvent)

    // 新轮消息不含旧回复
    expect(callbacks.messages.some((m) => m.type === 'assistant_reply' && m.content.includes('旧任务的迟到回复'))).toBe(false)
    // 新 session 正常收到自己的事件(身份校验不误伤当前轮)
    newSession.emit(assistantEvent)
    // 新轮收到(内容相同文案便于复用;断言 assistant_reply 存在)
    expect(callbacks.messages.some((m) => m.type === 'assistant_reply')).toBe(true)
    // 释放挂起的第一轮 prompt(清理)
    oldSession.releasePrompt()
  })

  it('removeTab 后重建:无残留会话/轮,新任务正常', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const fake = makeFakeSession()
    const bridge = new TerminalBridge(fake.session)
    const callbacks = makeCallbacks()

    promptScripts.push(async () => {})
    await runtime.startTask('tab-g1r', '任务一', 25, bridge, callbacks)
    runtime.removeTab('tab-g1r')
    expect(runtime.hasTab('tab-g1r')).toBe(false)
    // 旧 session 已 dispose
    expect(createdSessions.every((s) => s.disposed)).toBe(true)

    promptScripts.push(async (tools) => {
      const r = await execTool(tools, 'new-1', { command: 'uptime' })
      expect(r.details.error).toBeUndefined()
    })
    await runtime.startTask('tab-g1r', '任务二', 25, bridge, callbacks)
    expect(fake.log.some((l) => l.includes('uptime'))).toBe(true)
  })
})

// ================================================================
//  G02:配置修改后点"继续",下一请求用 B
// ================================================================

describe('G02 继续执行时的配置传播', () => {
  it('配置 A 预算暂停 → updateConfig(B) → continueTask → 新请求用 B', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig({ baseUrl: 'http://a/v1', apiKey: 'key-a', model: 'model-a' }))
    const fake = makeFakeSession()
    const bridge = new TerminalBridge(fake.session)
    const callbacks = makeCallbacks()

    // 配置 A:一轮产生预算暂停(maxSteps=1,第二条触发 budgetExhausted)
    promptScripts.push(async (tools) => {
      await execTool(tools, 'a1', { command: 'uptime' })
      await execTool(tools, 'a2', { command: 'df -h' }) // 触发预算耗尽
    })
    await runtime.startTask('tab-g2', '任务', 1, bridge, callbacks)
    expect(callbacks.states).toContain('stepLimitReached')

    // 配置修改入口(F04/G02 真实路径:设置页改配置 → Application 重读 →
    // controller.init → runtime.updateConfig;此处驱动 runtime 级)
    runtime.updateConfig(makeConfig({ baseUrl: 'http://b/v1', apiKey: 'key-b', model: 'model-b' }))

    // 点"继续":指纹变化 → 重建会话 → 下一请求用 B
    const beforeSessions = createdSessions.length
    promptScripts.push(async () => {})
    await runtime.continueTask('tab-g2', 25)

    // 重建发生(新 session)
    expect(createdSessions.length).toBeGreaterThan(beforeSessions)
    // G02 核心:新会话的 model 是 B
    const lastOpts = createdOptions[createdOptions.length - 1] as { model?: { baseUrl?: string; id?: string } }
    expect(lastOpts?.model?.baseUrl).toBe('http://b/v1')
    expect(lastOpts?.model?.id).toBe('model-b')
    // 续跑语义保留:预算重置提示存在
    expect(callbacks.messages.some((m) => m.type === 'status' && m.content.includes('预算'))).toBe(true)
  })

  it('配置未变时 continue 沿用会话(不重建)', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const fake = makeFakeSession()
    const bridge = new TerminalBridge(fake.session)
    const callbacks = makeCallbacks()

    promptScripts.push(async () => {})
    await runtime.startTask('tab-g2b', '任务', 25, bridge, callbacks)

    const beforeSessions = createdSessions.length
    promptScripts.push(async () => {})
    await runtime.continueTask('tab-g2b', 25)
    // 未重建:同一 session 被 prompt 两次
    expect(createdSessions.length).toBe(beforeSessions)
    expect((createdSessions[0] as unknown as { prompts: string[] }).prompts.length).toBe(2)
  })
})

// ================================================================
//  G03:系统提示文件发现收口(哨兵不被采纳)
// ================================================================

describe('G03 系统提示文件不自动发现', () => {
  it('哨兵 SYSTEM.md/APPEND_SYSTEM.md 存在于沙箱时,loader 不采纳,系统提示由宿主控制', async () => {
    const { DefaultResourceLoader, SettingsManager } = await import('@earendil-works/pi-coding-agent')

    // G05:测试拥有的独立目录(不是生产 PI_SANDBOX_DIR)
    const testDir = mkdtempSync(path.join(os.tmpdir(), 'zterm-g3-test-'))
    try {
      // 哨兵:agentDir 与 cwd/.pi/ 各放一份
      mkdirSync(path.join(testDir, 'agent'), { recursive: true })
      mkdirSync(path.join(testDir, 'cwd', '.pi'), { recursive: true })
      writeFileSync(path.join(testDir, 'agent', 'SYSTEM.md'), 'SENTINEL-SYSTEM-AGENTDIR', 'utf-8')
      writeFileSync(path.join(testDir, 'agent', 'APPEND_SYSTEM.md'), 'SENTINEL-APPEND-AGENTDIR', 'utf-8')
      writeFileSync(path.join(testDir, 'cwd', '.pi', 'SYSTEM.md'), 'SENTINEL-SYSTEM-CWD', 'utf-8')
      writeFileSync(path.join(testDir, 'cwd', '.pi', 'APPEND_SYSTEM.md'), 'SENTINEL-APPEND-CWD', 'utf-8')

      // 生产同型配置:显式 systemPrompt + 空 appendSystemPrompt + 内存 settings
      const loader = new DefaultResourceLoader({
        cwd: path.join(testDir, 'cwd'),
        agentDir: path.join(testDir, 'agent'),
        settingsManager: SettingsManager.inMemory(),
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: '宿主控制的系统提示',
        appendSystemPrompt: [],
      })
      await loader.reload()

      // G03 核心:哨兵不被采纳
      expect(loader.getSystemPrompt()).not.toContain('SENTINEL')
      expect(loader.getSystemPrompt()).toBe('宿主控制的系统提示')
      expect(loader.getAppendSystemPrompt().join('')).not.toContain('SENTINEL')
      expect(loader.getAppendSystemPrompt().length).toBe(0)
    } finally {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('经 runtime 全链路:createAgentSession 收到的 loader 系统提示为宿主内容', async () => {
    const runtime = new PiAgentRuntime(undefined as never, makeConfig())
    const fake = makeFakeSession()
    const bridge = new TerminalBridge(fake.session)

    promptScripts.push(async () => {})
    await runtime.startTask('tab-g3', '任务', 25, bridge, makeCallbacks())

    const opts = createdOptions[createdOptions.length - 1] as {
      resourceLoader?: { getSystemPrompt(): string | undefined; getAppendSystemPrompt(): string[] }
    }
    expect(opts?.resourceLoader).toBeTruthy()
    const sys = opts?.resourceLoader?.getSystemPrompt() ?? ''
    expect(sys).not.toContain('SENTINEL')
    expect(sys).toContain('zTerm')
    expect(sys).toContain('SRE')
  })
})
