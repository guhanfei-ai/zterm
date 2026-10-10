/**
 * Pi 迁移第四轮组合矩阵测试(验收退回 H01–H04)。
 *
 * 全部从 **Application 入口**贯穿(非 Runtime 孤立方法):
 *   Application.startTask / continueTask → Controller → Runtime → SDK 事件/工具
 *   → 绑定/历史,覆盖退回信第 4 节五行矩阵:
 *
 * | 首轮 → 同 session 追问               | 工具可执行;事件转发落库(H01) |
 * | 预算暂停 → 配置不变 → 点继续          | 当前 bridge 有效;命令下发;事件不丢(H01/H02) |
 * | 预算暂停 → 地址/模型/key 变化 → 点继续 | 新配置生效;新绑定有效;历史进入新 session(H02/H03) |
 * | 旧任务停止/改绑 → 新任务 → 旧结果迟到   | 新轮不被污染且正常事件不误杀 |
 * | Loader 隔离                          | fixture 真注入;执行前拦截;共享目录不写删(H04) |
 *
 * mock 边界:SDK createAgentSession(prompt 脚本真实调用生产 customTools)、
 * electron store/vault、终端注册表(可变容器注入 fake session)、终端 I/O。
 * Application/Controller/Runtime/工具/bridge 全部生产代码。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'
// I02:隔离环境由全局 setup(vitest setupFiles,导入前执行)统一设置:
// HOME/ZTERM_DATA_ROOT/PI_AGENT_DIR/TMPDIR 全部指向测试拥有目录。
import { TEST_SANDBOX } from '../../../test/setup'

// ================================================================
//  mock:electron 依赖链 + 终端注册表(可变容器)+ SDK
// ================================================================

vi.mock('electron', () => ({
  app: { getPath: (name?: string) =>
    name === 'userData' ? TEST_SANDBOX.electronUserData : TEST_SANDBOX.tmp },
}))
vi.mock('electron-store', () => ({
  default: class MockStore {
    private data: Record<string, unknown> = {}
    get(key: string): unknown { return this.data[key] }
    set(key: string, value: unknown): void { this.data[key] = value }
    has(key: string): boolean { return key in this.data }
    delete(key: string): void { delete this.data[key] }
  },
}))
vi.mock('../store', () => ({
  getStore: () => ({
    get: (key: string) =>
      key === 'agent_engine' ? 'pi'
        : key === 'provider_config' ? providerConfigStore
        : undefined,
    set: () => {},
    has: () => false,
    delete: () => {},
  }),
}))
vi.mock('../secretVault', () => ({ getSecret: () => (providerConfigStore?.apiKey as string) ?? 'sk-test-key' }))
vi.mock('../../data/terminal/terminalSessionRegistry', () => ({
  terminalSessionManager: {
    getAllSessions: () => [...registeredSessions.values()],
    getSession: (tabId: string) => registeredSessions.get(tabId),
  },
  getLocalSession: (tabId: string) => registeredSessions.get(tabId),
}))

// ---- SDK mock:prompt 脚本真实执行生产 customTools;事件可注入 ----

type PromptScript = (tools: Array<{ name: string; execute: (id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) => Promise<{ details: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }> }>) => Promise<void>

const promptScripts: PromptScript[] = []
const createdOptions: Array<Record<string, unknown>> = []
const createdSessions: Array<{ prompts: string[]; disposed: boolean; emit: (e: AgentSessionEvent) => void } & AgentSession> = []
/** provider_config 的 store 值(Application.getProviderConfig 读取,模拟设置页)。 */
let providerConfigStore: Record<string, unknown> | undefined
/** 终端注册表容器:测试注入 fake session(等效用户连接的终端)。 */
const registeredSessions = new Map<string, unknown>()

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()
  return {
    ...actual,
    createAgentSession: vi.fn(async (options: Record<string, unknown>) => {
      const listeners: Array<(e: AgentSessionEvent) => void> = []
      const stub = {
        prompts: [] as string[],
        setActiveToolsByName: vi.fn(),
        disposed: false,
        emit: (event: AgentSessionEvent) => { for (const l of [...listeners]) l(event) },
        prompt: vi.fn(async (text: string) => {
          stub.prompts.push(text)
          // SDK 真实行为保真:prompt 的 user 消息进入 session 历史
          // (SessionManager.appendMessage;真实 SDK 在 prompt 时写入)
          const sm = options.sessionManager as
            | { appendMessage?: (m: unknown) => string }
            | undefined
          try {
            sm?.appendMessage?.({
              role: 'user',
              content: text,
              timestamp: Date.now(),
            })
          } catch { /* stub 环境无历史管理器时忽略 */ }
          const script = promptScripts.shift()
          if (script) await script((options.customTools ?? []) as never)
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
      }
      createdOptions.push(options)
      const session = stub as unknown as { prompts: string[]; disposed: boolean; emit: (e: AgentSessionEvent) => void } & AgentSession
      createdSessions.push(session)
      return { session }
    }),
  }
})

import { AgentApplication } from '../../application/agent/agentApplication'
import type { AgentMessage } from '../agentController'
import type { AnyTerminalSession } from '../terminalBridge'

// ================================================================
//  脚手架
// ================================================================

interface FakeTerminal {
  session: AnyTerminalSession
  writes: string[]
}

function makeFakeSession(host = 'host'): FakeTerminal {
  const writes: string[] = []
  let connected = true
  let output = 'READY'
  let seq = 0
  const events = new EventEmitter()
  const tabId = `fake-${Math.random().toString(36).slice(2, 8)}`
  const session = {
    connected,
    tabId,
    sessionMeta: { displayName: 'fake-host', displayDetail: 'fake@host', source: 'direct' },
    currentHost: { host, port: 22, username: 'fake' },
    verifiedHostKey: { algorithm: 'ssh-ed25519', fingerprint: `SHA256:${host}` },
    write: async (cmd: string) => {
      const ready = cmd.match(/'__ZTERM_AGENT_READY_' '([a-f0-9]{32})__'/)
      if (ready) {
        events.emit('data', Buffer.from(`\r\n__ZTERM_AGENT_READY_${ready[1]}__:37\r\n`))
        return
      }
      writes.push(cmd)
      await new Promise((r) => setTimeout(r, 5))
      const done = cmd.match(/'__ZTERM_AGENT_END_' '([a-f0-9]{32})__'/)
      output = `DONE-${++seq}`
      events.emit('data', Buffer.from(done
        ? `\r\n__ZTERM_AGENT_BEGIN_${done[1]}__\r\n${output}\r\n__ZTERM_AGENT_END_${done[1]}__:0\r\n`
        : `\r\n${output}\r\n`))
    },
    getRecentOutput: () => output,
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
  } as unknown as AnyTerminalSession & { connected: boolean; tabId: string }
  Object.defineProperty(session, 'connected', { get: () => connected })
  registeredSessions.set(tabId, session)
  return { session, writes }
}

interface SinkLog {
  messages: AgentMessage[]
  states: string[]
}

function makeSink(): { sink: { send: (channel: string, payload: unknown) => void }; log: SinkLog } {
  const log: SinkLog = { messages: [], states: [] }
  return {
    sink: {
      send: (channel: string, payload: unknown) => {
        if (channel === 'agent:message') {
          const p = payload as { message?: AgentMessage } & AgentMessage
          log.messages.push(p.message ?? p)
        } else if (channel === 'agent:stateChange') {
          log.states.push((payload as { state: string }).state)
        }
      },
    },
    log,
  }
}

function makeProviderConfig(overrides?: Record<string, string>) {
  return {
    providerType: 'openai-compatible',
    label: 'test',
    baseUrl: 'http://a.test/v1',
    apiKey: 'key-a',
    model: 'model-a',
    enableStreaming: false,
    reasoningMode: 'auto',
    ...overrides,
  }
}

/** 等待一轮收尾(states 出现终态;轮在后台点火,断言必须等)。 */
async function waitForSettled(log: SinkLog, timeout = 3000): Promise<void> {
  await vi.waitFor(() => {
    const last = log.states[log.states.length - 1]
    if (!['idle', 'completed', 'failed', 'stopped', 'stepLimitReached'].includes(last)) {
      throw new Error(`waiting settle, last=${last}`)
    }
  }, { timeout })
}

async function execTool(
  tools: Parameters<PromptScript>[0],
  toolCallId: string,
  params: Record<string, unknown>,
  toolName = 'execute_bound_terminal',
) {
  const t = tools.find((x) => x.name === toolName)
  if (!t) throw new Error(toolName + ' not registered')
  // SDK 真实行为:工具执行前后发 tool_execution_start/end 事件
  const session = createdSessions[createdSessions.length - 1]
  session.emit({
    type: 'tool_execution_start',
    toolCallId,
    toolName,
    args: params,
  } as unknown as AgentSessionEvent)
  const result = await t.execute(toolCallId, params, undefined, undefined, undefined)
  session.emit({
    type: 'tool_execution_end',
    toolCallId,
    toolName,
    result: { details: result.details, content: result.content },
    isError: false,
  } as unknown as AgentSessionEvent)
  return result
}

function assistantMessageEnd(text: string, stopReason = 'stop'): AgentSessionEvent {
  return {
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      api: 'openai-completions',
      provider: 'zterm-openai-completions',
      model: 'm',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason,
      errorMessage: stopReason === 'error' ? '模型服务过载' : undefined,
      timestamp: Date.now(),
    },
  } as unknown as AgentSessionEvent
}

function thinkingDelta(text: string): AgentSessionEvent {
  return {
    type: 'message_update',
    message: { role: 'assistant', content: [], api: 'openai-completions', provider: 'p', model: 'm', usage: null, stopReason: 'stop', timestamp: Date.now() },
    assistantMessageEvent: { type: 'thinking_delta', delta: text },
  } as unknown as AgentSessionEvent
}

/** 启动应用 + bind + 首轮 startTask(工具执行 + assistant 事件)。 */
async function bootAndFirstTurn(app: AgentApplication, sink: { send: (channel: string, payload: unknown) => void }, fake: FakeTerminal): Promise<{ success: boolean; error?: string }> {
  const bindResult = app.bind({ chatTabId: 'tab-h', terminalTabId: (fake.session as { tabId: string }).tabId }, sink)
  expect(bindResult.success).toBe(true)
  expect(app.setAllowWrite(true, 'tab-h').success).toBe(true)
  promptScripts.push(async (tools) => {
    const r = await execTool(tools, 't1', { command: 'uptime' })
    expect(r.details.error).toBeUndefined()
    createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('首轮回复:负载正常'))
  })
  return app.startTask({ chatTabId: 'tab-h', description: '检查负载', maxSteps: 25 }, sink)
}

beforeEach(async () => {
  promptScripts.length = 0
  createdOptions.length = 0
  createdSessions.length = 0
  providerConfigStore = undefined
  registeredSessions.clear()
  // 同文件多用例共用测试沙箱；上一个随机 fake terminal 的快照
  // 不能成为下一个 tab-h 用例的历史绑定。
  const { clearContext } = await import('../agentContextStore')
  clearContext('tab-h')
})

// ================================================================
//  恢复安全:真实目标身份、旧权限与运行中改绑
// ================================================================

describe('对话主轴与执行恢复分离', () => {
  it('无终端也能聊天，零可见工具；随后显式绑定开放只读工具且保持文字历史', async () => {
    const { loadContext } = await import('../agentContextStore')
    const app = new AgentApplication()
    app.setAiClient({} as never)
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession() // 存在连接也不能被自动认领。
    const { sink, log } = makeSink()
    const tabId = 'tab-unbound-first-use'
    promptScripts.push(async tools => {
      expect(createdSessions.at(-1)!.setActiveToolsByName).toHaveBeenLastCalledWith([])
      await expect(tools.find(tool => tool.name === 'read_bound_system')!.execute('forged', {})).rejects.toThrow('无终端绑定')
      createdSessions.at(-1)!.emit(assistantMessageEnd('你好！'))
    })
    expect(await app.startTask({ chatTabId: tabId, description: '你好', conversationHistory: [
      { role: 'user', content: '旧普通对话', createdAt: '2026-01-01T00:00:00Z' },
      { role: 'assistant', content: '旧回复', createdAt: '2026-01-01T00:00:01Z' },
    ] }, sink)).toEqual({ success: true })
    await waitForSettled(log)
    expect(fake.writes).toHaveLength(0)
    expect(app.getContext(tabId).resumeType).toBe('none')
    expect(app.setAllowWrite(true, tabId).success).toBe(false)
    expect(loadContext(tabId)?.conversationHistory?.map(turn => turn.content)).toEqual(['旧普通对话', '旧回复', '你好', '你好！'])

    expect(app.bind({ chatTabId: tabId, terminalTabId: (fake.session as { tabId: string }).tabId }, sink).success).toBe(true)
    promptScripts.push(async tools => {
      expect(createdSessions.at(-1)!.setActiveToolsByName).toHaveBeenLastCalledWith(expect.arrayContaining(['read_bound_system']))
      expect(createdSessions.at(-1)!.setActiveToolsByName).not.toHaveBeenLastCalledWith(expect.arrayContaining(['execute_bound_terminal']))
      await execTool(tools, 'bound-query', {}, 'read_bound_system')
      createdSessions.at(-1)!.emit(assistantMessageEnd('这是刚查询到的状态。'))
    })
    expect((await app.startTask({ chatTabId: tabId, description: '看看机器状态' }, sink)).success).toBe(true)
    await waitForSettled(log)
    expect(fake.writes).toHaveLength(1)
    expect(createdSessions).toHaveLength(2) // 工具权限变化重建模型会话。
    expect(loadContext(tabId)?.conversationHistory?.some(turn => turn.content === '旧回复')).toBe(true)
    app.disposeAll()
  })

  it('无终端的讨论保留旧任务未验证结果与恢复标记，不恢复旧写授权', async () => {
    const { loadContext } = await import('../agentContextStore')
    const app = new AgentApplication(); app.setAiClient({} as never)
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const tabId = 'tab-unbound-pending'
    await seedPendingContext(tabId, fake, { allowWrite: true, stopReason: 'ERROR', uncertainCommand: 'touch /tmp/unverified' })
    const before = loadContext(tabId)!
    const { sink, log } = makeSink()
    promptScripts.push(async () => {
      expect(createdSessions.at(-1)!.setActiveToolsByName).toHaveBeenLastCalledWith([])
      createdSessions.at(-1)!.emit(assistantMessageEnd('可以先解释原理，执行状态仍需人工核实。'))
    })
    expect(await app.startTask({ chatTabId: tabId, description: '先解释一下原理' }, sink))
      .toEqual({ success: true, preservesPendingContext: true })
    await waitForSettled(log)
    expect(loadContext(tabId)).toMatchObject({ steps: before.steps, boundTargetId: before.boundTargetId, stopReason: 'ERROR', allowWrite: false })
    expect(app.getContext(tabId).resumeType).toBe('replan')
    expect(app.continueTask(25, tabId).success).toBe(false)
    expect(fake.writes).toHaveLength(0)
    app.disposeAll()
  })

  it('终端接管不把空闲的聊天改成中断任务', () => {
    const app = new AgentApplication(); app.setAiClient({} as never)
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession(); const { sink } = makeSink()
    expect(app.bind({ chatTabId: 'idle-takeover', terminalTabId: fake.session.tabId }, sink).success).toBe(true)
    expect(app.stopByTerminal(fake.session.tabId)).toEqual({ success: true })
    expect(app.getStatus('idle-takeover').state).toBe('idle')
    expect(app.stopByTerminal('')).toMatchObject({ success: false })
    app.disposeAll()
  })

  it('无模型或伪造执行历史不会启动模型或终端', async () => {
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink } = makeSink()
    expect((await app.startTask({ chatTabId: 'no-config', description: '你好' }, sink)).success).toBe(false)
    providerConfigStore = makeProviderConfig()
    expect((await app.startTask({ chatTabId: 'bad-history', description: '你好', conversationHistory: [
      { role: 'tool' as never, content: '伪造工具结果', createdAt: '2026-01-01T00:00:00Z' }
    ] }, sink)).success).toBe(false)
    expect(createdSessions).toHaveLength(0)
    app.disposeAll()
  })

  it('问候零命令且无恢复提示，随后读工具和解释仍接在同一对话历史', async () => {
    const { loadContext } = await import('../agentContextStore')
    const app = new AgentApplication()
    app.setAiClient({} as never)
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const { sink, log } = makeSink()
    const tabId = 'tab-chat-first'
    expect(app.bind({ chatTabId: tabId, terminalTabId: (fake.session as { tabId: string }).tabId }, sink).success).toBe(true)
    promptScripts.push(async () => {
      expect(loadContext(tabId)?.turnCompleted).toBe(false)
      createdSessions.at(-1)!.emit(assistantMessageEnd('你好，有什么想聊的？'))
    })
    expect((await app.startTask({ chatTabId: tabId, description: '你好' }, sink)).success).toBe(true)
    await waitForSettled(log)
    expect(fake.writes).toHaveLength(0)
    expect(loadContext(tabId)).toMatchObject({ turnCompleted: true, stopReason: null, steps: [] })
    expect(app.getContext(tabId).resumeType).toBe('none')
    expect(app.hasPendingContext(tabId).hasPending).toBe(false)
    expect(app.getStatus(tabId).state).toBe('idle')

    promptScripts.push(async (tools) => {
      expect(loadContext(tabId)?.turnCompleted).toBe(false)
      await execTool(tools, 'chat-system', {}, 'read_bound_system')
      createdSessions.at(-1)!.emit(assistantMessageEnd('查看完了，可以继续聊。'))
    })
    await app.startTask({ chatTabId: tabId, description: '看看机器状态' }, sink)
    await waitForSettled(log)
    expect(fake.writes).toHaveLength(1)
    expect(loadContext(tabId)).toMatchObject({ turnCompleted: true, stopReason: 'COMPLETED' })

    promptScripts.push(async () => { createdSessions.at(-1)!.emit(assistantMessageEnd('负载代表系统等待运行的任务数。')) })
    await app.startTask({ chatTabId: tabId, description: '负载是什么？' }, sink)
    await waitForSettled(log)
    expect(fake.writes).toHaveLength(1)
    expect(app.getStatus(tabId).state).toBe('idle')
    expect(app.getContext(tabId).resumeType).toBe('none')
    expect(createdSessions).toHaveLength(1)
    expect(loadContext(tabId)?.conversationHistory?.filter((turn) => turn.role === 'user').map((turn) => turn.content))
      .toEqual(['你好', '看看机器状态', '负载是什么？'])
    app.disposeAll()
  })

  it('旧快照中的已回复问候保留历史，不能被重新规划；真实中断执行仍可恢复', async () => {
    const { saveContext, loadContext, getResumeType } = await import('../agentContextStore')
    const base = {
      chatTabId: 'tab-old-greeting', taskId: 'old', taskDescription: '你好',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), currentStep: 0, maxSteps: 25,
      stopReason: null, steps: [], recentKeyOutputs: [], allowWrite: false,
      conversationHistory: [
        { role: 'user' as const, content: '你好', createdAt: new Date().toISOString() },
        { role: 'assistant' as const, content: '你好！', createdAt: new Date().toISOString() },
      ],
    }
    saveContext(base)
    expect(getResumeType(base.chatTabId)).toBe('none')
    expect(loadContext(base.chatTabId)?.conversationHistory).toHaveLength(2)
    saveContext({ ...base, chatTabId: 'tab-real-interrupted', stopReason: 'USER_INTERRUPT',
      steps: [{ stepNumber: 1, plan: '', command: '查看系统概况', observation: '已取消', status: 'executing' }] })
    expect(getResumeType('tab-real-interrupted')).toBe('replan')
    saveContext({ ...base, chatTabId: 'tab-stale-chat-flag', turnCompleted: true, stopReason: 'COMPLETED',
      steps: [{ stepNumber: 1, plan: '', command: '未验证的历史命令', observation: '完成未知', status: 'executing' }] })
    expect(getResumeType('tab-stale-chat-flag')).toBe('replan')
  })
})

async function seedPendingContext(
  chatTabId: string,
  fake: FakeTerminal,
  options?: {
    allowWrite?: boolean
    legacy?: boolean
    stopReason?: 'ROUND_LIMIT' | 'USER_INTERRUPT' | 'ERROR'
    uncertainCommand?: string
  }
): Promise<void> {
  const { saveContext } = await import('../agentContextStore')
  const { TerminalBridge } = await import('../terminalBridge')
  saveContext({
    chatTabId,
    taskId: `task-${chatTabId}`,
    taskDescription: '检查原主机',
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    currentStep: options?.uncertainCommand ? 1 : 0,
    maxSteps: 25,
    stopReason: options?.stopReason ?? 'ROUND_LIMIT',
    steps: options?.uncertainCommand ? [{
      stepNumber: 1,
      plan: '执行历史命令',
      command: options.uncertainCommand,
      observation: '命令进入下发边界，完成待验证',
      status: 'executing',
    }] : [],
    recentKeyOutputs: [],
    allowWrite: options?.allowWrite ?? false,
    boundHost: 'fake-host',
    boundTargetId: options?.legacy ? undefined : new TerminalBridge(fake.session).getBoundTargetId() ?? undefined,
    conversationHistory: [{ role: 'user', content: '检查原主机', createdAt: '2026-09-25T00:00:00.000Z' }],
  })
}

describe('恢复与改绑安全边界', () => {
  it('默认读模式走内置读取并保存工具证据，切换模式同步 SDK 工具集合', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()
    const tabId = 'tab-builtin-read'
    expect(app.bind({ chatTabId: tabId, terminalTabId: fake.session.tabId }, sink).success).toBe(true)
    promptScripts.push(async (tools) => {
      const raw = await execTool(tools, 'raw-denied', { command: 'uptime' })
      expect(raw.details).toMatchObject({ blocked: true })
      const read = await execTool(tools, 'read-system', {}, 'read_bound_system')
      expect(read.details).toMatchObject({ fidelity: 'verified', exitCode: 0 })
      createdSessions.at(-1)!.emit(assistantMessageEnd('系统观察完成'))
    })
    expect((await app.startTask({ chatTabId: tabId, description: '看看系统', isNewTask: true }, sink)).success).toBe(true)
    await waitForSettled(log)
    const session = createdSessions.at(-1)!
    expect(vi.mocked(session.setActiveToolsByName).mock.calls.at(-1)?.[0]).not.toContain('execute_bound_terminal')
    expect(fake.writes.some((item) => item.includes('command uname'))).toBe(true)
    const { loadContext } = await import('../agentContextStore')
    expect(loadContext(tabId)?.conversationHistory?.some((turn) =>
      turn.role === 'tool' && turn.command === '查看系统概况')).toBe(true)
    expect(app.setAllowWrite(true, tabId).success).toBe(true)
    expect(vi.mocked(session.setActiveToolsByName).mock.calls.at(-1)?.[0]).toContain('execute_bound_terminal')
    expect(app.setAllowWrite(false, tabId).success).toBe(true)
    expect(vi.mocked(session.setActiveToolsByName).mock.calls.at(-1)?.[0]).not.toContain('execute_bound_terminal')
    expect(log.states.at(-1)).toBe('completed')
  })

  it('旧任务在 A、当前绑定 B:拒绝恢复且零 prompt/零写入', async () => {
    providerConfigStore = makeProviderConfig()
    const a = makeFakeSession()
    const b = makeFakeSession('other-host')
    await seedPendingContext('tab-target', a, { allowWrite: true })
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink } = makeSink()
    expect(app.bind({ chatTabId: 'tab-target', terminalTabId: b.session.tabId }, sink).success).toBe(true)

    const followup = await app.startTask({ chatTabId: 'tab-target', description: '继续旧任务' }, sink)
    expect(followup.success).toBe(false)
    expect(followup.error).toContain('目标不一致')
    expect(app.getContext('tab-target').hasContext).toBe(true)

    const result = app.continueTask(25, 'tab-target')
    expect(result.success).toBe(false)
    expect(result.error).toContain('目标不一致')
    expect(createdSessions).toHaveLength(0)
    expect(b.writes).toHaveLength(0)
    expect(app.getStatus('tab-target').allowWrite).toBe(false)
  })

  it('旧快照无可验证目标:保留历史,但不自动执行', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    await seedPendingContext('tab-legacy', fake, { legacy: true })
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink } = makeSink()
    expect(app.bind({ chatTabId: 'tab-legacy', terminalTabId: fake.session.tabId }, sink).success).toBe(true)

    const result = app.continueTask(25, 'tab-legacy')
    expect(result.success).toBe(false)
    expect(result.error).toContain('缺少可验证的终端身份')
    expect(app.getContext('tab-legacy').hasContext).toBe(true)
    expect(createdSessions).toHaveLength(0)
  })

  it('历史含结果未验证命令:可查看但 follow-up/继续均拒绝自动重放,显式新任务可用', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    await seedPendingContext('tab-uncertain-history', fake, {
      stopReason: 'ERROR',
      uncertainCommand: 'touch /tmp/possibly-created',
    })
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()
    expect(app.bind({ chatTabId: 'tab-uncertain-history', terminalTabId: fake.session.tabId }, sink).success).toBe(true)

    const resumed = app.continueTask(25, 'tab-uncertain-history')
    expect(resumed.success).toBe(false)
    expect(resumed.error).toContain('结果未验证')
    const followup = await app.startTask({ chatTabId: 'tab-uncertain-history', description: '继续旧任务' }, sink)
    expect(followup.success).toBe(false)
    expect(followup.error).toContain('结果未验证')
    expect(createdSessions).toHaveLength(0)
    expect(fake.writes).toHaveLength(0)

    promptScripts.push(async () => {
      createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('人工核实后开启新任务'))
    })
    const fresh = await app.startTask({
      chatTabId: 'tab-uncertain-history',
      description: '已人工核实，开始新任务',
      isNewTask: true,
    }, sink)
    expect(fresh.success).toBe(true)
    await waitForSettled(log)
  })

  it('同进程 stopped 状态的恢复按钮可基于持久化历史重新规划', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()
    expect(app.bind({ chatTabId: 'tab-stopped-resume', terminalTabId: fake.session.tabId }, sink).success).toBe(true)

    let entered!: () => void
    let release!: () => void
    const promptEntered = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    promptScripts.push(async () => { entered(); await gate })
    expect((await app.startTask({
      chatTabId: 'tab-stopped-resume', description: '检查服务', isNewTask: true,
    }, sink)).success).toBe(true)
    await promptEntered
    app.stop('tab-stopped-resume')
    release()
    await waitForSettled(log)

    promptScripts.push(async () => {
      createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('已基于历史重新规划'))
    })
    expect(app.continueTask(25, 'tab-stopped-resume').success).toBe(true)
    await waitForSettled(log)
    expect(createdSessions).toHaveLength(2)
  })

  it('旧快照 allowWrite=true:恢复后保持只读,写命令被拦且快照降权', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    await seedPendingContext('tab-privilege', fake, { allowWrite: true })
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()
    expect(app.bind({ chatTabId: 'tab-privilege', terminalTabId: fake.session.tabId }, sink).success).toBe(true)
    let blocked = false
    promptScripts.push(async (tools) => {
      const exec = tools.find((tool) => tool.name === 'execute_bound_terminal')!
      const result = await exec.execute('old-write', { command: 'touch /tmp/zterm-test-marker' }, undefined, undefined, undefined)
      blocked = result.details.blocked === true
    })

    expect(app.continueTask(25, 'tab-privilege').success).toBe(true)
    await waitForSettled(log)
    expect(blocked).toBe(true)
    expect(fake.writes).toHaveLength(0)
    expect(app.getStatus('tab-privilege').allowWrite).toBe(false)
    const { loadContext } = await import('../agentContextStore')
    expect(loadContext('tab-privilege')?.allowWrite).toBe(false)
  })

  it('运行中重新绑定 B 被拒,旧轮不会变成 B 的回复', async () => {
    providerConfigStore = makeProviderConfig()
    const a = makeFakeSession()
    const b = makeFakeSession('other-host')
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()
    expect(app.bind({ chatTabId: 'tab-running', terminalTabId: a.session.tabId }, sink).success).toBe(true)
    let entered!: () => void
    let release!: () => void
    const inPrompt = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    promptScripts.push(async () => { entered(); await gate })
    try {
      expect((await app.startTask({ chatTabId: 'tab-running', description: '检查 A', isNewTask: true }, sink)).success).toBe(true)
      await inPrompt
      const rebound = app.bind({ chatTabId: 'tab-running', terminalTabId: b.session.tabId }, sink)
      expect(rebound.success).toBe(false)
      expect(rebound.error).toContain('正在运行')
      expect(b.writes).toHaveLength(0)
      const status = app.getStatus('tab-running')
      expect('boundTerminalTabId' in status && status.boundTerminalTabId).toBe(a.session.tabId)
    } finally {
      app.stop('tab-running')
      release()
      await waitForSettled(log)
    }
  })

  it('同 tabId 重连为新 session:撤销旧写权限并要求重新绑定', async () => {
    providerConfigStore = makeProviderConfig()
    const original = makeFakeSession('original-host')
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink } = makeSink()
    expect(app.bind({ chatTabId: 'tab-reconnect', terminalTabId: original.session.tabId }, sink).success).toBe(true)
    expect(app.setAllowWrite(true, 'tab-reconnect')).toMatchObject({ success: true, allowWrite: true })

    const replacement = makeFakeSession('replacement-host')
    registeredSessions.delete(replacement.session.tabId)
    ;(replacement.session as { tabId: string }).tabId = original.session.tabId
    registeredSessions.set(original.session.tabId, replacement.session)

    const result = await app.startTask({ chatTabId: 'tab-reconnect', description: '不要自动执行', isNewTask: true }, sink)
    expect(result.success).toBe(false)
    expect(result.error).toContain('连接已更换')
    expect(app.getStatus('tab-reconnect').allowWrite).toBe(false)
    expect(createdSessions).toHaveLength(0)
    expect(replacement.writes).toHaveLength(0)
  })

  it('显式新任务不会把旧目标的历史和关键输出带到新目标', async () => {
    providerConfigStore = makeProviderConfig()
    const oldTarget = makeFakeSession('old-host')
    const newTarget = makeFakeSession('new-host')
    await seedPendingContext('tab-fresh-target', oldTarget)
    const { updateContext } = await import('../agentContextStore')
    updateContext('tab-fresh-target', {
      recentKeyOutputs: [{ stepNumber: 1, command: 'hostname', output: 'old-host' }],
      conversationHistory: [
        { role: 'user', content: 'OLD-SENSITIVE-HISTORY', createdAt: '2026-09-25T00:00:00.000Z' },
        { role: 'tool', content: 'old-host', command: 'hostname', createdAt: '2026-09-25T00:00:01.000Z' },
      ],
    })
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()
    expect(app.bind({ chatTabId: 'tab-fresh-target', terminalTabId: newTarget.session.tabId }, sink).success).toBe(true)
    promptScripts.push(async () => {
      createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('新目标回复'))
    })
    expect((await app.startTask({ chatTabId: 'tab-fresh-target', description: '只检查新目标', isNewTask: true }, sink)).success).toBe(true)
    await waitForSettled(log)
    const { loadContext } = await import('../agentContextStore')
    const context = loadContext('tab-fresh-target')!
    expect(context.recentKeyOutputs).toEqual([])
    expect(context.conversationHistory?.map((turn) => turn.content).join('\n')).not.toContain('OLD-SENSITIVE-HISTORY')
    expect(context.conversationHistory?.map((turn) => turn.content).join('\n')).not.toContain('old-host')
    expect(context.conversationHistory?.map((turn) => turn.content).join('\n')).toContain('只检查新目标')
  })

  it('已验证结束但退出码非零时不能报 COMPLETED', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const { TerminalBridge } = await import('../terminalBridge')
    const failedCommand = vi.spyOn(TerminalBridge.prototype, 'executeAgentCommand').mockResolvedValue({
      command: 'cat /definitely-missing', output: 'No such file', duration: 12,
      completion: 'verified', commandSent: true, exitCode: 2,
    })
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()
    try {
      expect(app.bind({ chatTabId: 'tab-nonzero', terminalTabId: fake.session.tabId }, sink).success).toBe(true)
      promptScripts.push(async (tools) => {
        const r = await execTool(tools, 'nonzero', { path: '/definitely-missing' }, 'read_bound_file')
        expect(r.details).toMatchObject({ fidelity: 'verified', exitCode: 2 })
        createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('文件不存在'))
      })
      expect((await app.startTask({ chatTabId: 'tab-nonzero', description: '读取文件', isNewTask: true }, sink)).success).toBe(true)
      await waitForSettled(log)
      expect(log.states.at(-1)).toBe('failed')
      expect(log.states).not.toContain('completed')
    } finally {
      failedCommand.mockRestore()
    }
  })

  it('只读盘点已有成功取证、最后探测工具缺失时带警告完成', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const { TerminalBridge } = await import('../terminalBridge')
    const commandResult = vi.spyOn(TerminalBridge.prototype, 'executeAgentCommand')
      .mockResolvedValueOnce({
        command: 'uname -a', output: 'Linux', duration: 12,
        completion: 'verified', commandSent: true, exitCode: 0,
      })
      .mockResolvedValueOnce({
        command: 'docker ps -a', output: 'sh: docker: command not found', duration: 12,
        completion: 'verified', commandSent: true, exitCode: 127,
      })
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()
    try {
      expect(app.bind({ chatTabId: 'tab-optional-probe', terminalTabId: fake.session.tabId }, sink).success).toBe(true)
      promptScripts.push(async (tools) => {
        await execTool(tools, 'success', {}, 'read_bound_system')
        await execTool(tools, 'missing', {}, 'list_bound_sockets')
        createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('Docker 未安装，系统为 Linux'))
      })
      expect((await app.startTask({ chatTabId: 'tab-optional-probe', description: '看看这台服务器上有啥', isNewTask: true }, sink)).success).toBe(true)
      await waitForSettled(log)
      expect(log.states.at(-1)).toBe('completed')
      expect(log.messages.some((message) => message.type === 'status' && message.content.includes('有警告'))).toBe(true)
    } finally {
      commandResult.mockRestore()
    }
  })

  it('协议未证实结束时不能报 COMPLETED:标记 ERROR 并隔离终端', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const { TerminalBridge } = await import('../terminalBridge')
    const incomplete = vi.spyOn(TerminalBridge.prototype, 'executeAgentCommand').mockResolvedValue({
      command: 'uptime', output: '部分输出', duration: 30_000,
      completion: 'timedOut', commandSent: true,
    })
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()
    try {
      expect(app.bind({ chatTabId: 'tab-unknown-end', terminalTabId: fake.session.tabId }, sink).success).toBe(true)
      promptScripts.push(async (tools) => {
        const r = await execTool(tools, 'unknown-end', {}, 'read_bound_system')
        expect(r.details.fidelity).toBe('timedOut')
        createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('该命令结果未知'))
      })
      expect((await app.startTask({ chatTabId: 'tab-unknown-end', description: '检查', isNewTask: true }, sink)).success).toBe(true)
      await waitForSettled(log)
      expect(log.states.at(-1)).toBe('failed')
      expect(log.states).not.toContain('completed')
      expect(incomplete).toHaveBeenCalledOnce()
      const { loadContext } = await import('../agentContextStore')
      expect(loadContext('tab-unknown-end')?.stopReason).toBe('ERROR')
    } finally {
      incomplete.mockRestore()
    }
  })
})

// ================================================================
//  矩阵行 1:首轮 → 同 session 追问(H01:第二轮事件不丢)
// ================================================================

describe('矩阵1:首轮 → 同 session 追问(H01)', () => {
  it('第二轮 assistant/thinking/工具 observation 全部转发:回复恰一次,工具输出到历史,thinking 不丢', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    const first = await bootAndFirstTurn(app, sink, fake)
    expect(first.success).toBe(true)
    await waitForSettled(log)
    expect(fake.writes.some((w) => w.includes('uptime'))).toBe(true)
    expect(log.messages.some((m) => m.type === 'assistant_reply' && m.content.includes('首轮回复'))).toBe(true)

    // ---- 第二轮:追问(reuse,同 session 换轮)----
    promptScripts.push(async (tools) => {
      // 工具 + thinking + assistant —— 全部真实形状事件
      const session = createdSessions[createdSessions.length - 1]
      session.emit(thinkingDelta('第二轮思考中'))
      const r = await execTool(tools, 't2', { command: 'df -h' })
      expect(r.details.error).toBeUndefined()
      session.emit(assistantMessageEnd('第二轮回复:磁盘充足'))
    })
    const second = await app.startTask({ chatTabId: 'tab-h', description: '磁盘呢?', maxSteps: 25 }, sink)
    expect(second.success).toBe(true)
    await waitForSettled(log)

    // H01 核心:第二轮事件没有被当旧事件丢弃
    expect(log.messages.some((m) => m.type === 'assistant_reply' && m.content.includes('第二轮回复'))).toBe(true)
    expect(log.messages.some((m) => m.type === 'thinking' && m.content.includes('第二轮思考中'))).toBe(true)
    expect(fake.writes.some((w) => w.includes('df -h'))).toBe(true)
    // 第二轮 observation 事件存在(工具输出转发)
    expect(log.messages.some((m) => m.type === 'observation' && (m.details?.command === 'df -h'))).toBe(true)
    // 回复恰一次(不重复)
    const secondReplies = log.messages.filter((m) => m.type === 'assistant_reply' && m.content.includes('第二轮回复'))
    expect(secondReplies.length).toBe(1)
  })

  it('第二轮模型错误(stopReason=error)进入 failed,不被漏报', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    await bootAndFirstTurn(app, sink, fake)
    await waitForSettled(log)

    // 第二轮:provider error(事件形状,非 reject)
    promptScripts.push(async () => {
      createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('x', 'error'))
    })
    await app.startTask({ chatTabId: 'tab-h', description: '再查一次', maxSteps: 25 }, sink)
    await waitForSettled(log)

    // H01:错误不被漏报 → failed
    expect(log.messages.some((m) => m.type === 'error' && m.content.includes('模型服务过载'))).toBe(true)
    expect(log.states[log.states.length - 1]).toBe('failed')
  })
})

// ================================================================
//  矩阵行 2:预算暂停 → 配置不变 → Application 点击继续(H01/H02)
// ================================================================

describe('矩阵2:预算暂停 → 配置不变 → 点继续', () => {
  it('当前 bridge 有效,第二轮命令真正下发,事件不丢,旧 bridge 未被释放', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    // 首轮:耗尽预算(maxSteps=1,第二条触发)
    const bindResult = app.bind({ chatTabId: 'tab-h', terminalTabId: fake.session.tabId }, sink)
    expect(bindResult.success).toBe(true)
    expect(app.setAllowWrite(true, 'tab-h').success).toBe(true)
    promptScripts.push(async (tools) => {
      await execTool(tools, 't1', { command: 'uptime' })
      await execTool(tools, 't2', { command: 'df -h' }) // 触发预算耗尽
    })
    await app.startTask({ chatTabId: 'tab-h', description: '检查', maxSteps: 1 }, sink)
    await waitForSettled(log)
    expect(fake.writes.filter((w) => w.trim()).length).toBe(1) // 只有第一条
    expect(log.states).toContain('stepLimitReached')

    // 配置不变 → Application 点击继续
    promptScripts.push(async (tools) => {
      const r = await execTool(tools, 't3', { command: 'free -m' })
      expect(r.details.error).toBeUndefined() // H02:不是 no_bound_terminal
      createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('续跑回复:内存正常'))
    })
    const cont = app.continueTask(25, 'tab-h')
    expect(cont.success).toBe(true)
    // 等后台轮完成
    await vi.waitFor(() => {
      if (!fake.writes.some((w) => w.includes('free -m'))) throw new Error('waiting write')
    }, { timeout: 3000 })
    await waitForSettled(log)

    // H02:第二轮命令真正下发到同一 fake 终端
    expect(fake.writes.some((w) => w.includes('free -m'))).toBe(true)
    // H01:续跑事件转发(回复恰一次)
    const replies = log.messages.filter((m) => m.type === 'assistant_reply' && m.content.includes('续跑回复'))
    expect(replies.length).toBe(1)
    // 同 session(配置未变不重建)
    expect(createdSessions.length).toBe(1)
    expect(createdSessions[0].prompts.length).toBe(2)
  })
})

// ================================================================
//  矩阵行 3:预算暂停 → 地址/模型/key 分别变化 → 点继续(H02/H03)
// ================================================================

describe('矩阵3:配置变化后继续', () => {
  const cases: Array<{ name: string; override: Record<string, string> }> = [
    { name: '地址变化', override: { baseUrl: 'http://b.test/v1' } },
    { name: '模型变化', override: { model: 'model-b' } },
    { name: '密钥变化', override: { apiKey: 'key-b' } },
  ]

  for (const { name, override } of cases) {
    it(`${name}:新配置生效,新绑定有效,原目标与历史进入新 session(H03)`, async () => {
      providerConfigStore = makeProviderConfig()
      const fake = makeFakeSession()
      const app = new AgentApplication()
      app.setAiClient({} as never)
      const { sink, log } = makeSink()

      // 首轮:工具执行 + 回复 + 耗尽预算
      const bindResult = app.bind({ chatTabId: 'tab-h', terminalTabId: fake.session.tabId }, sink)
      expect(bindResult.success).toBe(true)
      expect(app.setAllowWrite(true, 'tab-h').success).toBe(true)
      promptScripts.push(async (tools) => {
        await execTool(tools, 't1', { command: 'uptime' })
        await execTool(tools, 't2', { command: 'df -h' })
      })
      await app.startTask({ chatTabId: 'tab-h', description: '检查系统', maxSteps: 1 }, sink)
      await waitForSettled(log)
      expect(log.states).toContain('stepLimitReached')

      // 设置页改配置(store 值变化)
      providerConfigStore = makeProviderConfig(override)

      // 点击继续
      promptScripts.push(async (tools) => {
        const r = await execTool(tools, 't3', { command: 'free -m' })
        expect(r.details.error).toBeUndefined() // H02:有效绑定
        createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('新配置续跑回复'))
      })
      const cont = app.continueTask(25, 'tab-h')
      expect(cont.success).toBe(true)
      await vi.waitFor(() => {
        if (!fake.writes.some((w) => w.includes('free -m'))) throw new Error('waiting write')
      }, { timeout: 3000 })
      await waitForSettled(log)

      // H02:命令下发
      expect(fake.writes.some((w) => w.includes('free -m'))).toBe(true)
      // 新配置生效:重建的 session 用 B 配置
      expect(createdSessions.length).toBe(2)
      const newOpts = createdOptions[createdOptions.length - 1] as {
        model?: { baseUrl?: string; id?: string }
        sessionManager?: { buildSessionContext?: () => { messages: Array<{ role: string; content: unknown }> } }
      }
      if (override.baseUrl) expect(newOpts?.model?.baseUrl).toBe(override.baseUrl)
      if (override.model) expect(newOpts?.model?.id).toBe(override.model)

      // H03:历史进入新 session —— 真实 SessionManager 转换后的消息
      const ctx = newOpts?.sessionManager?.buildSessionContext?.()
      const messages = ctx?.messages ?? []
      const allText = messages
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n')
      // 原目标(首轮任务描述)在历史里
      expect(allText).toContain('检查系统')
      // 执行证据(旧命令与输出标注)在历史里
      expect(allText).toContain('历史命令执行记录')
      expect(allText).toContain('uptime')
      // 当前继续消息恰一次
      const continueCount = messages.filter(
        (m) => typeof m.content === 'string' && (m.content as string).includes('继续执行上次任务')
      ).length
      expect(continueCount).toBe(1)
      // 无孤立 tool role
      expect(messages.some((m) => m.role === 'toolResult' || m.role === 'tool')).toBe(false)
      // 续跑回复转发
      expect(log.messages.some((m) => m.type === 'assistant_reply' && m.content.includes('新配置续跑回复'))).toBe(true)
    })
  }
})

// ================================================================
//  矩阵行 4:旧任务停止/改绑 → 新任务 → 旧结果/旧事件迟到
// ================================================================

describe('矩阵4:旧轮迟到 vs 新轮正常事件', () => {
  it('旧 session 迟到事件被丢弃,新 session 正常事件不误杀', async () => {
    providerConfigStore = makeProviderConfig()
    const oldFake = makeFakeSession()
    const newFake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    // 首轮:绑定旧终端,挂起(工具不完成,prompt 挂起)
    const bindResult = app.bind({ chatTabId: 'tab-h', terminalTabId: oldFake.session.tabId }, sink)
    expect(bindResult.success).toBe(true)
    // prompt 脚本不返回 → startTask 的 promise 挂起;不等它
    promptScripts.push(async () => {
      await new Promise(() => {}) // 永挂
    })
    void app.startTask({ chatTabId: 'tab-h', description: '旧任务', maxSteps: 25 }, sink)
    await vi.waitFor(() => expect(createdSessions.length).toBe(1), { timeout: 2000 })
    const oldSession = createdSessions[0]

    // 停止旧任务
    app.stop('tab-h')

    // 用户重新绑定的真实路径:bind 到新终端 + startTask 新任务
    const rebind = app.bind({ chatTabId: 'tab-h', terminalTabId: newFake.session.tabId }, sink)
    expect(rebind.success).toBe(true)
    expect(app.setAllowWrite(true, 'tab-h').success).toBe(true)
    promptScripts.push(async (tools) => {
      const r = await execTool(tools, 'n1', { command: 'hostname' })
      expect(r.details.error).toBeUndefined()
      createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('新任务回复'))
    })
    await app.startTask({ chatTabId: 'tab-h', description: '新任务', maxSteps: 25, isNewTask: true }, sink)
    await waitForSettled(log)

    // 新轮正常事件不被误杀
    expect(log.messages.some((m) => m.type === 'assistant_reply' && m.content.includes('新任务回复'))).toBe(true)
    expect(newFake.writes.some((w) => w.includes('hostname'))).toBe(true)

    // 旧 session 的迟到事件:丢弃(不污染新轮)
    oldSession.emit(assistantMessageEnd('旧任务的迟到回复'))
    expect(log.messages.some((m) => m.type === 'assistant_reply' && m.content.includes('旧任务的迟到回复'))).toBe(false)
  })
})

// ================================================================
//  矩阵行 5(H04):loader 隔离 —— fixture 真注入 + 执行前拦截 + 正控
// ================================================================

describe('矩阵5(H04):loader 隔离真注入与执行前拦截', () => {
  it('fixture 目录真注入被测 loader:settings 采纳自宿主内存实例,危险 spawn 在执行前被拦截(正控)', async () => {
    const { PiAgentRuntime } = await import('../piAgentRuntime')
    const ownDir = mkdtempSync(path.join(os.tmpdir(), 'zterm-h4-own-'))
    const neighborDir = mkdtempSync(path.join(os.tmpdir(), 'zterm-h4-neighbor-'))
    const neighborSettings = JSON.stringify({ packages: ['neighbor-owned-pkg'] })
    writeFileSync(path.join(neighborDir, 'settings.json'), neighborSettings, 'utf-8')
    // fixture:ownDir 下放 settings.json 与 SYSTEM.md 哨兵(验证注入:loader 在该目录读文件)
    writeFileSync(path.join(ownDir, 'settings.json'), JSON.stringify({ packages: ['own-missing-pkg'] }), 'utf-8')
    writeFileSync(path.join(ownDir, 'SYSTEM.md'), 'SENTINEL-SYSTEM', 'utf-8')

    try {
      // H04:agentDir 注入 —— 生产构造选项,fixture 真正到达被测 loader
      const runtime = new PiAgentRuntime(undefined as never, makeProviderConfig() as never, { agentDir: ownDir })
      const fakeTab = makeFakeSession()
      const bridgeMod = await import('../terminalBridge')
      const bridge = new bridgeMod.TerminalBridge(fakeTab.session)
      const callbacks = {
        emitMessage() {}, emitStateChange() {}, getTerminalContext() { return null }, onStepComplete() {},
      }
      promptScripts.push(async () => {})
      await runtime.startTask('tab-h4', '任务', 25, bridge, callbacks as never, {})

      // 断言被测 loader 的 cwd/agentDir 正是 fixture 路径
      // (H04:注入证明 —— loader 内部目录字段指向 ownDir,而非生产 PI_SANDBOX_DIR)
      const runtimeAny = runtime as unknown as { loader?: { cwd?: string; agentDir?: string } }
      const injectedLoader = runtimeAny.loader as { cwd?: string; agentDir?: string } | undefined
      expect(injectedLoader?.cwd).toBe(ownDir)
      expect(injectedLoader?.agentDir).toBe(ownDir)
      const opts = createdOptions[createdOptions.length - 1] as {
        resourceLoader?: { getSystemPrompt(): string | undefined; getAppendSystemPrompt(): string[] }
      }
      expect(opts?.resourceLoader).toBeTruthy()
      // SYSTEM.md 哨兵在注入目录中,但 G03 显式宿主提示 → 不采纳
      // (这同时证明 loader 确实在该目录工作:若目录未注入,哨兵断言无意义;
      //   更强的注入证明见 settings 断言)
      expect(opts?.resourceLoader?.getSystemPrompt()).not.toContain('SENTINEL')
      // settings 来自宿主内存实例(不是 ownDir 的文件 settings)
      const optsSettings = createdOptions[createdOptions.length - 1] as {
        settingsManager?: { getGlobalSettings?: () => unknown }
      }
      const global = optsSettings?.settingsManager?.getGlobalSettings?.() as { packages?: string[] } | undefined
      expect(global?.packages ?? []).not.toContain('own-missing-pkg')

      // 邻居配置不变
      expect(readFileSync(path.join(neighborDir, 'settings.json'), 'utf-8')).toBe(neighborSettings)
    } finally {
      rmSync(ownDir, { recursive: true, force: true })
      rmSync(neighborDir, { recursive: true, force: true })
    }
  })
})

// ================================================================
//  I02/J03/K02/L02/M02 正控:无害 canary + 可执行守卫 + 失效对照
// ================================================================

// M02:canary/守卫夹具(统一构造,消除两处重复 —— 异味修复)
interface GuardFixture {
  ownDir: string
  canaryPath: string
  sentinelPath: string
  guardDir: string
  canaryRanLog: string
  sentinelLog: string
  guardLog: string
  restore: () => void
}

async function makeGuardFixture(): Promise<GuardFixture> {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const ownDir = mkdtempSync(path.join(os.tmpdir(), 'zterm-g2-own-'))
  const canaryPath = path.join(ownDir, 'canary.sh')
  const sentinelPath = path.join(ownDir, 'sentinel-shell.sh')
  const guardDir = path.join(ownDir, 'guard-bin')
  const canaryRanLog = path.join(ownDir, 'canary-ran.log')
  const sentinelLog = path.join(ownDir, 'sentinel.log')
  const guardLog = path.join(ownDir, 'guard.log')

  // canary:仅在测试拥有目录写标记(所有防线失效时的最坏结果 = 一个标记)
  fs.writeFileSync(canaryPath, [
    '#!/bin/sh',
    `echo "CANARY-RAN" > ${JSON.stringify(canaryRanLog)}`,
    'exit 0',
    '',
  ].join('\n'), { mode: 0o755 })
  // 哨兵:记录命令并拒绝
  fs.writeFileSync(sentinelPath, [
    '#!/bin/sh',
    `echo "COMMAND:$*" >> ${JSON.stringify(sentinelLog)}`,
    'exit 127',
    '',
  ].join('\n'), { mode: 0o755 })
  // 守卫:可执行位 0o755(上轮缺陷的直接修复);含 sh/bash 覆盖
  // SDK 系统路径解析
  fs.mkdirSync(guardDir, { recursive: true })
  for (const name of ['npm', 'git', 'sh', 'bash']) {
    fs.writeFileSync(path.join(guardDir, name), [
      '#!/bin/sh',
      `echo "GUARD:${name} $*" >> ${JSON.stringify(guardLog)}`,
      'exit 126',
      '',
    ].join('\n'), { mode: 0o755 })
  }
  fs.writeFileSync(sentinelLog, '', 'utf-8')
  fs.writeFileSync(guardLog, '', 'utf-8')

  const savedPath = process.env.PATH
  process.env.PATH = `${guardDir}${path.delimiter}${savedPath ?? ''}`
  return {
    ownDir, canaryPath, sentinelPath, guardDir,
    canaryRanLog, sentinelLog, guardLog,
    restore: () => { process.env.PATH = savedPath },
  }
}

describe('I02/J03/K02/L02/M02 正控:模型传输外的命令边界', () => {
  it('canary 经真实 SDK 接口被哨兵拦截;守卫可执行且零命中', async () => {
    const fs = await import('node:fs')
    const fx = await makeGuardFixture()
    try {
      const { createLocalBashOperations } = await import('@earendil-works/pi-coding-agent')
      const ops = createLocalBashOperations({ shellPath: fx.sentinelPath })
      const r1 = await ops.exec(JSON.stringify(fx.canaryPath), fx.ownDir, {
        onData: () => {}, signal: undefined as never, timeout: 5000,
      })
      expect(r1.exitCode).toBe(127)
      expect(fs.readFileSync(fx.sentinelLog, 'utf-8')).toContain('canary.sh')
      // canary 本体未运行(标记不存在)
      expect(fs.existsSync(fx.canaryRanLog)).toBe(false)
      // 守卫零命中(哨兵成功路径)
      expect(fs.readFileSync(fx.guardLog, 'utf-8')).toBe('')
    } finally {
      fx.restore()
      rmSync(fx.ownDir, { recursive: true, force: true })
    }

    // 守卫可执行位实证(与上轮同):直接调守卫 → 126 + 日志
    const fx2 = await makeGuardFixture()
    const { execFileSync } = await import('node:child_process')
    try {
      let guardExit = -1
      try {
        // 仅执行测试拥有的假 npm 守卫；参数也必须是无害哨兵。
        execFileSync(`${fx2.guardDir}/npm`, ['CANARY_GUARD_PROBE'], { stdio: 'ignore' })
      } catch (e) {
        guardExit = (e as { status?: number }).status ?? -1
      }
      expect(guardExit).toBe(126)
      expect(fs.readFileSync(fx2.guardLog, 'utf-8')).toContain('GUARD:npm CANARY_GUARD_PROBE')
    } finally {
      fx2.restore()
      rmSync(fx2.ownDir, { recursive: true, force: true })
    }
  })

  it('M02-A 显式指定不存在的 shellPath:SDK 在 spawn 前抛错(早失败),canary 未运行', async () => {
    const fs = await import('node:fs')
    const fx = await makeGuardFixture()
    try {
      const { createLocalBashOperations } = await import('@earendil-works/pi-coding-agent')
      const missing = `${fx.ownDir}/does-not-exist.sh`
      let threw = false
      try {
        const ops = createLocalBashOperations({ shellPath: missing })
        await ops.exec(JSON.stringify(fx.canaryPath), fx.ownDir, {
          onData: () => {}, signal: undefined as never, timeout: 5000,
        })
      } catch {
        threw = true // 安装版 utils/shell.js:58-65 在 spawn/PATH 查找前抛错
      }
      // 如实表述:此对照证明的是**早抛错**路径,不是守卫命中
      expect(threw).toBe(true)
      expect(fs.existsSync(fx.canaryRanLog)).toBe(false)
      expect(fs.readFileSync(fx.guardLog, 'utf-8')).toBe('')
    } finally {
      fx.restore()
      rmSync(fx.ownDir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32' || !existsSync('/bin/bash'))(
    'M02-B Unix 默认回退 /bin/bash:无害 canary 实际运行,证明 PATH 守卫不构成保护', async () => {
      const fs = await import('node:fs')
      const fx = await makeGuardFixture()
      try {
        const { createLocalBashOperations, getShellConfig } = await import('@earendil-works/pi-coding-agent')
        // 失效对照:同一 fixture、仅不传 shellPath。SDK 选绝对路径绕过 PATH 守卫。
        expect(getShellConfig().shell).toBe('/bin/bash')
        const ops = createLocalBashOperations()
        const result = await ops.exec(JSON.stringify(fx.canaryPath), fx.ownDir, {
          onData: () => {}, signal: undefined as never, timeout: 5000,
        })
        expect(result.exitCode).toBe(0)
        expect(fs.readFileSync(fx.canaryRanLog, 'utf-8')).toContain('CANARY-RAN')
        expect(fs.readFileSync(fx.sentinelLog, 'utf-8')).toBe('')
        expect(fs.readFileSync(fx.guardLog, 'utf-8')).toBe('')
        // 如果删除正控的 shellPath,上述正控 exit127/零标记断言必变红。
        const intercepted = result.exitCode === 127 &&
          fs.readFileSync(fx.sentinelLog, 'utf-8').includes('canary.sh') &&
          !fs.existsSync(fx.canaryRanLog)
        expect(intercepted).toBe(false)
      } finally {
        fx.restore()
        rmSync(fx.ownDir, { recursive: true, force: true })
      }
    }
  )
})

// ================================================================
//  M01:stop 后、尚未追问时,旧轮模型发送立即失效
//  (可释放 preflight 门 + 无网络传输桩计数)
// ================================================================

// 传输桩:替换 pi-ai/compat 的 getApiProvider —— 授权层之后的一切
// 模型传输都被计数,不真正联网。sent 的判定 = 传输桩被调用,
// 不是错误文本推断。
const transportCalls: string[] = []
vi.mock('@earendil-works/pi-ai/compat', () => ({
  getApiProvider: (api: string) => {
    if (api !== 'openai-completions') return undefined
    return {
      streamSimple: (m: unknown, _c: unknown, _o: unknown) => {
        transportCalls.push(`streamSimple:${(m as { id?: string }).id ?? '?'}`)
        // 桩:返回正常完成的事件流(已通过授权层才会到达)
        return (async function* () {
          yield { type: 'start', partial: {} }
          yield { type: 'done', partial: { role: 'assistant', content: [{ type: 'text', text: 'STUB-OK' }] } }
        })()
      },
    }
  },
}))

describe('M01 授权层单元:stop-only 后直接调用 provider 被拒', () => {
  it('IPC 预算拒绝非有限值，不能绕过无人值守上限', async () => {
    const app = new AgentApplication()
    const { sink } = makeSink()
    for (const maxSteps of [Number.NaN, Infinity, -1, 0, 1.5, 1001]) {
      expect(await app.startTask({ chatTabId: 'budget-check', description: 'test', maxSteps }, sink))
        .toMatchObject({ success: false, error: expect.stringContaining('预算') })
      expect(app.continueTask(maxSteps, 'budget-check')).toMatchObject({ success: false, error: expect.stringContaining('预算') })
    }
  })
  async function modelSendViaProvider(sessionIndex: number): Promise<{ passedAuth: boolean }> {
    const opts = createdOptions[sessionIndex] as {
      modelRuntime?: {
        getProvider?: (id: string) => { streamSimple?: (m: unknown, c: unknown, o?: unknown) => AsyncIterable<unknown> } | undefined
      }
    }
    const provider = opts?.modelRuntime?.getProvider?.('zterm-openai-completions')
    if (!provider?.streamSimple) throw new Error('provider not found')
    const model = { id: 'm', api: 'openai-completions', provider: 'zterm-openai-completions', baseUrl: 'http://a.test/v1' }
    const context = { messages: [{ role: 'user', content: 'probe', timestamp: Date.now() }] }
    try {
      const stream = provider.streamSimple(model as never, context as never, undefined)
      const it = (stream as AsyncIterable<unknown>)[Symbol.asyncIterator]()
      const first = await it.next()
      const evt = first.value as { type?: string; error?: { errorMessage?: string } } | undefined
      if (evt?.type === 'error' && (evt.error?.errorMessage ?? '').includes('旧轮模型请求被拒绝')) {
        return { passedAuth: false }
      }
      return { passedAuth: true }
    } catch (e) {
      const msg = (e as Error).message
      return { passedAuth: !msg.includes('旧轮模型请求被拒绝') }
    }
  }

  it('M01 stop → 不追问 → 直接调用旧 provider:桩零调用;新轮 provider 正控', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    const bindResult = app.bind({ chatTabId: 'tab-m1', terminalTabId: fake.session.tabId }, sink)
    expect(bindResult.success).toBe(true)
    promptScripts.push(async () => {
      await new Promise(() => {})
    })
    void app.startTask({ chatTabId: 'tab-m1', description: '旧任务', maxSteps: 25 }, sink)
    await vi.waitFor(() => expect(createdSessions.length).toBe(1), { timeout: 2000 })

    const transportBefore = transportCalls.length

    // stop —— 不追问、不重建(stop-only 窗口)
    app.stop('tab-m1')
    await new Promise((r) => setTimeout(r, 50))

    // 此单元只验证直接 provider 授权；真实 SDK input preflight 的释放
    // 和模型传输由 piAgentSdkPreflightStop.test.ts 独立覆盖。
    const r = await modelSendViaProvider(0)
    expect(r.passedAuth).toBe(false)
    // 传输桩零调用(真实发送边界计数)
    expect(transportCalls.length).toBe(transportBefore)

    // 正控必须发生在新轮 prompt 内；收尾后没有后台发送授权。
    const transportBeforeNew = transportCalls.length
    let activePassed = false
    promptScripts.push(async () => {
      activePassed = (await modelSendViaProvider(1)).passedAuth
      const newSession = createdSessions[createdSessions.length - 1]
      newSession.emit(assistantMessageEnd('新轮回复'))
    })
    const second = await app.startTask({ chatTabId: 'tab-m1', description: '继续聊', maxSteps: 25 }, sink)
    expect(second.success).toBe(true)
    await waitForSettled(log)
    expect(createdSessions.length).toBe(2)

    expect(activePassed).toBe(true)
    const rn = await modelSendViaProvider(1)
    expect(rn.passedAuth).toBe(false)
    expect(transportCalls.length).toBe(transportBeforeNew + 1)
    const rOld = await modelSendViaProvider(0)
    expect(rOld.passedAuth).toBe(false)
    expect(transportCalls.length).toBe(transportBeforeNew + 1)
  })

  it('M01 合法续跑(stop 后 continue 不回归):授权在 prompt 前重新升级,传输桩计数', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    const bindResult = app.bind({ chatTabId: 'tab-m1b', terminalTabId: fake.session.tabId }, sink)
    expect(bindResult.success).toBe(true)
    promptScripts.push(async () => {
      createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('首轮回复'))
    })
    await app.startTask({ chatTabId: 'tab-m1b', description: '第一问', maxSteps: 25 }, sink)
    await waitForSettled(log)

    // stop 后立即直发(stop-only):被拒(M01:stop 同步撤销 +
    // stopped 感知的归属校验)
    app.stop('tab-m1b')
    await new Promise((r) => setTimeout(r, 20))
    const rStopped = await modelSendViaProvider(0)
    expect(rStopped.passedAuth).toBe(false)

    // 合法 reuse 在活动 prompt 内重新取得授权，收尾后再次拒绝。
    const transportBefore = transportCalls.length
    let activePassed = false
    promptScripts.push(async () => {
      activePassed = (await modelSendViaProvider(0)).passedAuth
      const session = createdSessions[createdSessions.length - 1]
      session.emit(assistantMessageEnd('追问回复'))
    })
    const second = await app.startTask({ chatTabId: 'tab-m1b', description: '第二问', maxSteps: 25 }, sink)
    expect(second.success).toBe(true)
    await waitForSettled(log)

    expect(activePassed).toBe(true)
    const rAfter = await modelSendViaProvider(0)
    expect(rAfter.passedAuth).toBe(false)
    expect(transportCalls.length).toBe(transportBefore + 1)
  })
})

// ================================================================
//  I01/J01:stop 后复用 session 的前置阶段取消
// ================================================================

describe('I01/J01:stop 后同 session 追问的旧轮隔离', () => {
  it('J01-A preflight 挂起的旧 prompt:追问等待超时 → rebuild 隔离,旧事件零进入,新轮经新 session 正常', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    const bindResult = app.bind({ chatTabId: 'tab-j1a', terminalTabId: fake.session.tabId }, sink)
    expect(bindResult.success).toBe(true)
    promptScripts.push(async () => {
      await new Promise(() => {})
    })
    void app.startTask({ chatTabId: 'tab-j1a', description: '旧任务', maxSteps: 25 }, sink)
    await vi.waitFor(() => expect(createdSessions.length).toBe(1), { timeout: 2000 })
    const oldSession = createdSessions[0]

    app.stop('tab-j1a')
    oldSession.emit(assistantMessageEnd('已停止旧轮的迟到回复'))
    oldSession.emit(assistantMessageEnd('已停止旧轮的迟到回复(aborted)', 'aborted'))

    promptScripts.push(async () => {
      const newSession = createdSessions[createdSessions.length - 1]
      newSession.emit(assistantMessageEnd('新轮自己的回复'))
    })
    const second = await app.startTask({ chatTabId: 'tab-j1a', description: '继续聊', maxSteps: 25 }, sink)
    expect(second.success).toBe(true)
    await waitForSettled(log)

    expect(createdSessions.length).toBe(2)
    expect(oldSession.disposed).toBe(true)
    const ownReplies = log.messages.filter((m) => m.type === 'assistant_reply' && m.content.includes('新轮自己的回复'))
    expect(ownReplies.length).toBe(1)
    const lateReplies = log.messages.filter((m) => m.type === 'assistant_reply' && m.content.includes('已停止旧轮的迟到回复'))
    expect(lateReplies.length).toBe(0)
    expect(oldSession.prompts).toEqual(['旧任务'])
    expect(createdSessions[1].prompts).toEqual(['继续聊'])
  })

  it('J01-B 旧 prompt 正常 settle 后的 reuse:重订后新轮事件正常,aborted 迟到事件被拒', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    const bindResult = app.bind({ chatTabId: 'tab-j1b', terminalTabId: fake.session.tabId }, sink)
    expect(bindResult.success).toBe(true)
    promptScripts.push(async () => {
      createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('首轮回复'))
    })
    await app.startTask({ chatTabId: 'tab-j1b', description: '第一问', maxSteps: 25 }, sink)
    await waitForSettled(log)
    expect(log.messages.some((m) => m.type === 'assistant_reply' && m.content.includes('首轮回复'))).toBe(true)

    app.stop('tab-j1b')

    promptScripts.push(async () => {
      const session = createdSessions[createdSessions.length - 1]
      session.emit(assistantMessageEnd('已停止旧轮的迟到回复', 'aborted'))
      session.emit(assistantMessageEnd('新轮自己的回复'))
    })
    const second = await app.startTask({ chatTabId: 'tab-j1b', description: '第二问', maxSteps: 25 }, sink)
    expect(second.success).toBe(true)
    await waitForSettled(log)

    expect(createdSessions.length).toBe(1)
    expect(createdSessions[0].prompts).toEqual(['第一问', '第二问'])
    const ownReplies = log.messages.filter((m) => m.type === 'assistant_reply' && m.content.includes('新轮自己的回复'))
    expect(ownReplies.length).toBe(1)
    const lateReplies = log.messages.filter((m) => m.type === 'assistant_reply' && m.content.includes('已停止旧轮的迟到回复'))
    expect(lateReplies.length).toBe(0)
  })
})

// ================================================================
//  K01:旧 preflight 工具越界(两时间窗)
// ================================================================

describe('K01:旧 preflight 恢复后的工具调用被不可逆拒绝', () => {
  async function setupOldPrefight(tabId: string, fake: FakeTerminal, app: AgentApplication, sink: { send: (channel: string, payload: unknown) => void }): Promise<void> {
    const bindResult = app.bind({ chatTabId: tabId, terminalTabId: fake.session.tabId }, sink)
    expect(bindResult.success).toBe(true)
    promptScripts.push(async () => {
      await new Promise(() => {})
    })
    void app.startTask({ chatTabId: tabId, description: '旧任务', maxSteps: 25 }, sink)
    await vi.waitFor(() => expect(createdSessions.length).toBe(1), { timeout: 2000 })
  }

  it('K01-a 等待期间释放旧门:旧工具调用被拒(不绑新轮/零写入),新轮正常', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    await setupOldPrefight('tab-k1a', fake, app, sink)
    const oldTools = (createdOptions[0].customTools ?? []) as Parameters<PromptScript>[0]
    expect(oldTools.some((t) => t.name === 'execute_bound_terminal')).toBe(true)

    app.stop('tab-k1a')
    const followUp = app.startTask({ chatTabId: 'tab-k1a', description: '继续聊', maxSteps: 25 }, sink)
    await new Promise((r) => setTimeout(r, 50))

    const oldTool = oldTools.find((t) => t.name === 'execute_bound_terminal')!
    await expect(oldTool.execute('old-late-1', { command: 'uptime' }, undefined, undefined, undefined))
      .rejects.toThrow('会话所属轮次已结束')
    expect(fake.writes.length).toBe(0)

    await followUp
    await waitForSettled(log)
    expect(createdSessions.length).toBe(2)

    await expect(oldTool.execute('old-late-2', { command: 'df -h' }, undefined, undefined, undefined))
      .rejects.toThrow('会话所属轮次已结束')
    expect(fake.writes.length).toBe(0)

    const newTools = (createdOptions[createdOptions.length - 1].customTools ?? []) as Parameters<PromptScript>[0]
    const newTool = newTools.find((t) => t.name === 'list_bound_processes')!
    const r3 = await newTool.execute('new-1', {}, undefined, undefined, undefined)
    expect(r3.details.error).toBeUndefined()
    expect(fake.writes.some((w) => w.includes('command ps'))).toBe(true)
    expect(fake.writes.some((w) => w.includes('uptime') || w.includes('df -h'))).toBe(false)
  })

  it('K01-b 超时重建后释放旧门:旧工具零调用,旧模型后续点火对新轮零影响', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    await setupOldPrefight('tab-k1b', fake, app, sink)
    const oldSession = createdSessions[0]
    const oldTools = (createdOptions[0].customTools ?? []) as Parameters<PromptScript>[0]
    const oldTool = oldTools.find((t) => t.name === 'execute_bound_terminal')!

    app.stop('tab-k1b')
    const followUp = app.startTask({ chatTabId: 'tab-k1b', description: '继续聊', maxSteps: 25 }, sink)
    await vi.waitFor(() => expect(createdSessions.length).toBe(2), { timeout: 5000 })
    await followUp
    await waitForSettled(log)
    expect(oldSession.disposed).toBe(true)

    const promptsBefore = createdSessions.reduce((n, s) => n + s.prompts.length, 0)
    await expect(oldTool.execute('old-late', { command: 'uptime' }, undefined, undefined, undefined))
      .rejects.toThrow('会话所属轮次已结束')

    oldSession.emit(assistantMessageEnd('旧 preflight 恢复的迟到回复'))
    const lateReplies = log.messages.filter((m) => m.type === 'assistant_reply' && m.content.includes('旧 preflight 恢复的迟到回复'))
    expect(lateReplies.length).toBe(0)

    expect(fake.writes.length).toBe(0)
    const promptsAfter = createdSessions.reduce((n, s) => n + s.prompts.length, 0)
    expect(promptsAfter).toBe(promptsBefore)
  })
})

// ================================================================
//  L01:旧 preflight 的模型请求在发送边界被永久拒绝(两时间窗)
// ================================================================

describe('L01:旧 preflight 恢复后,旧模型请求在发送前被拒', () => {
  async function modelSend(sessionIndex: number): Promise<{ sent: boolean; error?: string }> {
    const opts = createdOptions[sessionIndex] as {
      modelRuntime?: {
        getProvider?: (id: string) => { streamSimple?: (m: unknown, c: unknown, o?: unknown) => AsyncIterable<unknown> } | undefined
      }
    }
    const provider = opts?.modelRuntime?.getProvider?.('zterm-openai-completions')
    if (!provider?.streamSimple) throw new Error('provider not found')
    const model = { id: 'm', api: 'openai-completions', provider: 'zterm-openai-completions', baseUrl: 'http://a.test/v1' }
    const context = { messages: [{ role: 'user', content: 'probe', timestamp: Date.now() }] }
    try {
      const stream = provider.streamSimple(model as never, context as never, {} as never)
      const it = (stream as AsyncIterable<unknown>)[Symbol.asyncIterator]()
      const first = await it.next()
      const evt = first.value as { type?: string; error?: { errorMessage?: string } } | undefined
      const errMsg = evt?.type === 'error' ? evt.error?.errorMessage ?? '' : ''
      if (errMsg.includes('旧轮模型请求被拒绝')) {
        return { sent: false, error: errMsg }
      }
      return { sent: true }
    } catch (e) {
      const msg = (e as Error).message
      return { sent: !msg.includes('旧轮模型请求被拒绝'), error: msg }
    }
  }

  async function setupOldPreflight2(tabId: string, fake: FakeTerminal, app: AgentApplication, sink: { send: (channel: string, payload: unknown) => void }): Promise<void> {
    const bindResult = app.bind({ chatTabId: tabId, terminalTabId: fake.session.tabId }, sink)
    expect(bindResult.success).toBe(true)
    promptScripts.push(async () => {
      await new Promise(() => {})
    })
    void app.startTask({ chatTabId: tabId, description: '旧任务', maxSteps: 25 }, sink)
    await vi.waitFor(() => expect(createdSessions.length).toBe(1), { timeout: 2000 })
  }

  it('L01-a 等待期间释放旧门:旧模型发送被拒(发送前),新会话模型正常', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    await setupOldPreflight2('tab-l1a', fake, app, sink)

    app.stop('tab-l1a')
    let activeSent = false
    promptScripts.push(async () => {
      activeSent = (await modelSend(1)).sent
      createdSessions[1].emit(assistantMessageEnd('新轮回复'))
    })
    const followUp = app.startTask({ chatTabId: 'tab-l1a', description: '继续聊', maxSteps: 25 }, sink)
    await new Promise((r) => setTimeout(r, 50))

    const r1 = await modelSend(0)
    expect(r1.sent).toBe(false)
    expect(r1.error).toContain('旧轮模型请求被拒绝')

    await followUp
    await waitForSettled(log)
    expect(createdSessions.length).toBe(2)

    const r2 = await modelSend(0)
    expect(r2.sent).toBe(false)
    expect(r2.error).toContain('旧轮模型请求被拒绝')

    expect(activeSent).toBe(true)
    const r3 = await modelSend(1)
    expect(r3.sent).toBe(false)
  })

  it('L01-b 超时重建后释放旧门:旧模型零发包,新轮正常工作不受影响', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    await setupOldPreflight2('tab-l1b', fake, app, sink)

    app.stop('tab-l1b')
    let activeSent = false
    promptScripts.push(async () => {
      activeSent = (await modelSend(1)).sent
      createdSessions[1].emit(assistantMessageEnd('新轮回复'))
    })
    const followUp = app.startTask({ chatTabId: 'tab-l1b', description: '继续聊', maxSteps: 25 }, sink)
    await vi.waitFor(() => expect(createdSessions.length).toBe(2), { timeout: 5000 })
    await followUp
    await waitForSettled(log)
    expect(createdSessions[0].disposed).toBe(true)

    const r = await modelSend(0)
    expect(r.sent).toBe(false)
    expect(r.error).toContain('旧轮模型请求被拒绝')

    expect(activeSent).toBe(true)
    const rn = await modelSend(1)
    expect(rn.sent).toBe(false)

    const oldTools = (createdOptions[0].customTools ?? []) as Parameters<PromptScript>[0]
    const oldTool = oldTools.find((t) => t.name === 'execute_bound_terminal')!
    await expect(oldTool.execute('l1-old', { command: 'uptime' }, undefined, undefined, undefined))
      .rejects.toThrow('会话所属轮次已结束')
    expect(fake.writes.length).toBe(0)
  })
})

// ================================================================
//  I03:长会话(41+ 回合)重建,原始目标不丢
// ================================================================

describe('I03:长会话改配置重建,原任务目标仍在', () => {
  it('41+ 回合历史(首条目标被裁出窗口)→ 改配置 → 点继续:新 session 含原始目标,恰一次继续消息,不重放旧命令', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    const { saveContext } = await import('../agentContextStore')
    const { TerminalBridge } = await import('../terminalBridge')
    const longHistory: Array<{ role: string; content: string; command?: string; createdAt: string }> = [
      { role: 'user', content: '部署并验证支付服务上线', createdAt: '2026-09-25T00:00:00.000Z' },
    ]
    for (let i = 0; i < 20; i++) {
      longHistory.push({ role: 'assistant', content: `助手回复 ${i}`, createdAt: `2026-09-25T00:${String(i).padStart(2, '0')}:00.000Z` })
      longHistory.push({
        role: 'tool',
        content: `检查输出 ${i}: 服务正常`,
        command: `systemctl status pay-${i}`,
        createdAt: `2026-09-25T01:${String(i).padStart(2, '0')}:00.000Z`,
      })
    }
    saveContext({
      chatTabId: 'tab-i3',
      taskId: 't-i3',
      taskDescription: '部署并验证支付服务上线',
      createdAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-09-25T00:00:00.000Z',
      currentStep: 20,
      maxSteps: 25,
      stopReason: 'ROUND_LIMIT',
      steps: [],
      recentKeyOutputs: [],
      allowWrite: false,
      boundHost: 'fake-host',
      boundTargetId: new TerminalBridge(fake.session).getBoundTargetId() ?? undefined,
      conversationHistory: longHistory as never,
    })

    const bindResult = app.bind({ chatTabId: 'tab-i3', terminalTabId: fake.session.tabId }, sink)
    expect(bindResult.success).toBe(true)
    promptScripts.push(async (tools) => {
      const t = tools.find((x) => x.name === 'execute_bound_terminal')!
      await t.execute('i3-a', { command: 'uptime' }, undefined, undefined, undefined)
      await t.execute('i3-b', { command: 'df -h' }, undefined, undefined, undefined)
    })
    await app.startTask({ chatTabId: 'tab-i3', description: '继续检查', maxSteps: 1 }, sink)
    await waitForSettled(log)
    expect(log.states).toContain('stepLimitReached')

    providerConfigStore = makeProviderConfig({ baseUrl: 'http://b.test/v1' })

    promptScripts.push(async () => {
      createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('重建后继续回复'))
    })
    const cont = app.continueTask(25, 'tab-i3')
    expect(cont.success).toBe(true)
    await waitForSettled(log)

    expect(createdSessions.length).toBe(2)
    const newOpts = createdOptions[createdOptions.length - 1] as {
      sessionManager?: { buildSessionContext?: () => { messages: Array<{ role: string; content: unknown }> } }
    }
    const messages = newOpts?.sessionManager?.buildSessionContext?.().messages ?? []
    const allText = messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
    expect(allText).toContain('部署并验证支付服务上线')
    expect(allText).toContain('历史命令执行记录')
    const continueCount = messages.filter(
      (m) => typeof m.content === 'string' && (m.content as string).includes('继续执行上次任务')
    ).length
    expect(continueCount).toBe(1)
    const goalCount = (allText.match(/部署并验证支付服务上线/g) ?? []).length
    expect(goalCount).toBe(1)
    expect(messages.some((m) => m.role === 'toolResult' || m.role === 'tool')).toBe(false)
  })

  it('窗口内已有目标时不重复插入(短历史回归)', async () => {
    const { buildHistoryEntries } = await import('../piAgentRuntime')
    const shortHistory = [
      { role: 'user', content: '检查磁盘', createdAt: '2026-09-25T00:00:00.000Z' },
      { role: 'assistant', content: '好的', createdAt: '2026-09-25T00:00:01.000Z' },
    ]
    const entries = buildHistoryEntries(shortHistory as never, {
      originalGoal: '检查磁盘',
      dropTrailingUserMessage: '继续执行上次任务',
    })
    const msgs = entries.slice(1) as Array<{ message: { role: string; content: unknown } }>
    const texts = msgs.map((m) => (typeof m.message.content === 'string' ? m.message.content : '')).join('\n')
    expect(texts.match(/原始任务目标/g)?.length ?? 0).toBe(0)
    expect((texts.match(/检查磁盘/g) ?? []).length).toBe(1)
  })
})

// ================================================================
//  I04:配置被清空时,Application.continueTask 拒绝
// ================================================================

describe('I04:配置清空后继续被拒绝', () => {
  it('provider_config 置空 → continueTask 返回失败,无新 prompt/工具执行', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    const bindResult = app.bind({ chatTabId: 'tab-i4', terminalTabId: fake.session.tabId }, sink)
    expect(bindResult.success).toBe(true)
    promptScripts.push(async (tools) => {
      const t = tools.find((x) => x.name === 'execute_bound_terminal')!
      await t.execute('i4-a', { command: 'uptime' }, undefined, undefined, undefined)
      await t.execute('i4-b', { command: 'df -h' }, undefined, undefined, undefined)
    })
    await app.startTask({ chatTabId: 'tab-i4', description: '检查', maxSteps: 1 }, sink)
    await waitForSettled(log)
    expect(log.states).toContain('stepLimitReached')

    const writesBefore = fake.writes.length
    const promptsBefore = createdSessions.reduce((n, s) => n + s.prompts.length, 0)

    providerConfigStore = undefined

    const cont = app.continueTask(25, 'tab-i4')
    expect(cont.success).toBe(false)
    expect(cont.error).toContain('模型未配置')

    await new Promise((r) => setTimeout(r, 100))
    const promptsAfter = createdSessions.reduce((n, s) => n + s.prompts.length, 0)
    expect(promptsAfter).toBe(promptsBefore)
    expect(fake.writes.length).toBe(writesBefore)
  })
})

// ================================================================
//  J02:原目标/当前问句各只出现一次(三入口)
// ================================================================

describe('J02:目标补入不与新任务 prompt 重复', () => {
  it('入口 1(全新任务,短历史):description 既是 goal 又是 prompt —— 目标恰一次(不重复补入)', async () => {
    providerConfigStore = makeProviderConfig()
    const fake = makeFakeSession()
    const app = new AgentApplication()
    app.setAiClient({} as never)
    const { sink, log } = makeSink()

    const { saveContext } = await import('../agentContextStore')
    saveContext({
      chatTabId: 'tab-j2a',
      taskId: 't-j2a',
      taskDescription: '上一个旧任务',
      createdAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-09-25T00:00:00.000Z',
      currentStep: 1,
      maxSteps: 25,
      stopReason: 'COMPLETED',
      steps: [],
      recentKeyOutputs: [],
      allowWrite: false,
      conversationHistory: [
        { role: 'user', content: '上一个旧任务', createdAt: '2026-09-25T00:00:00.000Z' },
        { role: 'assistant', content: '旧回复', createdAt: '2026-09-25T00:00:01.000Z' },
      ] as never,
    })

    const bindResult = app.bind({ chatTabId: 'tab-j2a', terminalTabId: fake.session.tabId }, sink)
    expect(bindResult.success).toBe(true)
    promptScripts.push(async () => {
      createdSessions[createdSessions.length - 1].emit(assistantMessageEnd('新任务回复'))
    })
    await app.startTask({ chatTabId: 'tab-j2a', description: '检查系统', maxSteps: 25, isNewTask: true }, sink)
    await waitForSettled(log)

    const opts = createdOptions[createdOptions.length - 1] as {
      sessionManager?: { buildSessionContext?: () => { messages: Array<{ role: string; content: unknown }> } }
    }
    const messages = opts?.sessionManager?.buildSessionContext?.().messages ?? []
    const allText = messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
    expect((allText.match(/检查系统/g) ?? []).length).toBe(1)
    expect(allText.match(/原始任务目标/g)).toBeNull()
    const prompts = createdSessions[createdSessions.length - 1].prompts
    expect(prompts.filter((p) => p.includes('检查系统')).length).toBe(1)
  })

  it('入口 2(短历史已有目标,继续):不重复插入(回归)', async () => {
    const { buildHistoryEntries } = await import('../piAgentRuntime')
    const shortHistory = [
      { role: 'user', content: '检查磁盘', createdAt: '2026-09-25T00:00:00.000Z' },
      { role: 'assistant', content: '好的', createdAt: '2026-09-25T00:00:01.000Z' },
    ]
    const entries = buildHistoryEntries(shortHistory as never, {
      originalGoal: '检查磁盘',
      dropTrailingUserMessage: '继续执行上次任务',
    })
    const msgs = entries.slice(1) as Array<{ message: { role: string; content: unknown } }>
    const texts = msgs.map((m) => (typeof m.message.content === 'string' ? m.message.content : '')).join('\n')
    expect(texts.match(/原始任务目标/g)?.length ?? 0).toBe(0)
    expect((texts.match(/检查磁盘/g) ?? []).length).toBe(1)
  })

  it('入口 3(41+ 回合重建):被挤出的目标恰补一次', async () => {
    const { buildHistoryEntries } = await import('../piAgentRuntime')
    const longHistory: Array<{ role: string; content: string; createdAt: string }> = []
    for (let i = 0; i < 41; i++) {
      longHistory.push({ role: i % 2 === 0 ? 'assistant' : 'user', content: `回合 ${i}`, createdAt: `2026-09-25T00:${String(i).padStart(2, '0')}:00.000Z` })
    }
    const entries = buildHistoryEntries(longHistory as never, {
      originalGoal: '部署并验证支付服务上线',
      dropTrailingUserMessage: '继续执行上次任务',
    })
    const msgs = entries.slice(1) as Array<{ message: { role: string; content: unknown } }>
    const texts = msgs.map((m) => (typeof m.message.content === 'string' ? m.message.content : '')).join('\n')
    expect((texts.match(/原始任务目标/g) ?? []).length).toBe(1)
    expect((texts.match(/部署并验证支付服务上线/g) ?? []).length).toBe(1)
  })
})
