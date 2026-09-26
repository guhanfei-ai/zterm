/**
 * G04:真实 Controller.init 接线测试(独立文件,避免与其他测试的
 * 模块缓存和 mock hoisting 冲突)。
 *
 * 验证路径:设置页改配置 → AgentApplication 重新 init →
 * AgentController.init → readAgentEnginePreference(getStore)(真实链)
 * → runtime 已存在时 runtime.updateConfig(config) → 新轮用新配置。
 *
 * mock 边界:electron / electron-store / store(virtual,主进程测试无
 * electron 运行时);Controller.init、readAgentEnginePreference、
 * agentRuntimeFactory、PiAgentRuntime 全部真实。
 * Pi SDK 的 createAgentSession 亦 mock 为捕获参数的 stub。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'

// 顶层 mock(hoisting 正确):electron 链 + SDK
// I02:Electron mock 指测试沙箱(userData 封死 legacy 迁移入口,不落共享 /tmp)
import { TEST_SANDBOX } from '../../../test/setup'
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
    get: (key: string) => (key === 'agent_engine' ? 'pi' : undefined),
    set: () => {},
    has: () => false,
    delete: () => {},
  }),
}))
vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()
  return {
    ...actual,
    createAgentSession: vi.fn(async (options: Record<string, unknown>) => {
      const stub = {
        prompts: [] as string[],
        disposed: false,
        prompt: async (text: string) => { stub.prompts.push(text) },
        subscribe: () => () => {},
        abort: async () => {},
        dispose: () => { stub.disposed = true },
        getLastAssistantText: () => undefined,
      }
      capturedOptions.push(options)
      return { session: stub as unknown as AgentSession }
    }),
  }
})

/** 捕获 createAgentSession 的参数(model 等)。 */
const capturedOptions: Array<Record<string, unknown>> = []

import { AgentController } from '../agentController'
import { PiAgentRuntime } from '../piAgentRuntime'
import { TerminalBridge, type AnyTerminalSession } from '../terminalBridge'
import type { AgentGraphCallbacks } from '../agentGraph'

function makeFakeSession(): AnyTerminalSession {
  return {
    connected: true,
    tabId: 'fake',
    sessionMeta: undefined,
    currentHost: undefined,
    write: async () => {},
    getRecentOutput: () => 'READY',
    on: () => {},
    removeListener: () => {},
  } as unknown as AnyTerminalSession
}

function makeCallbacks(): AgentGraphCallbacks {
  return {
    emitMessage() {},
    emitStateChange() {},
    getTerminalContext() { return null },
    onStepComplete() {},
  }
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

beforeEach(() => {
  capturedOptions.length = 0
})

describe('G04 Controller.init 真实接线', () => {
  it('init 走真实 getStore 链创建 Pi runtime;再次 init 经 updateConfig 同步新配置', async () => {
    const controller = new AgentController()
    const bridge = new TerminalBridge(makeFakeSession())
    const configA = makeConfig({ baseUrl: 'http://a/v1', apiKey: 'key-a', model: 'model-a' })
    const configB = makeConfig({ baseUrl: 'http://b/v1', apiKey: 'key-b', model: 'model-b' })

    // 首次 init:真实链(getStore → agent_engine='pi' → createAgentRuntime('pi'))
    controller.init({} as never, bridge, configA)
    const runtime = controller.getRuntime()
    expect(runtime).toBeInstanceOf(PiAgentRuntime)
    if (!runtime) throw new Error('runtime not created')

    // G04 接线:runtime 已存在时第二次 init(设置页改配置路径)→
    // updateConfig 同步 B;新轮 model 用 B(而非构造时的 A)
    controller.init({} as never, bridge, configB)
    await runtime.startTask('tab-g4', '任务', 25, bridge, makeCallbacks(), {})
    expect(capturedOptions.length).toBe(1)
    const opts = capturedOptions[0] as { model?: { baseUrl?: string; id?: string } }
    expect(opts?.model?.baseUrl).toBe('http://b/v1')
    expect(opts?.model?.id).toBe('model-b')
  })
})
