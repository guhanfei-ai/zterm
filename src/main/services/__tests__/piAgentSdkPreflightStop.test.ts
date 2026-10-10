/**
 * M01 SDK regression: stop during a real Pi `input` extension preflight must
 * revoke the old session's model-send authorization, even without a follow-up.
 *
 * Only DefaultResourceLoader is partially mocked to add an inline extension.
 * createAgentSession, AgentSession.prompt/abort and the Pi model pipeline remain
 * real. The public pi-ai/compat API registry replaces the HTTP transport with
 * an in-memory event stream; fetch is also forbidden as a fail-safe.
 */
import { expect, it, vi } from 'vitest'
import { AgentSession, type InputEvent, type InputEventResult } from '@earendil-works/pi-coding-agent'
import type { AssistantMessage, Model } from '@earendil-works/pi-ai'
import {
  createAssistantMessageEventStream,
  getApiProvider,
  registerApiProvider,
  registerBuiltInApiProviders,
  unregisterApiProviders,
} from '@earendil-works/pi-ai/compat'
import { TEST_SANDBOX } from '../../../test/setup'
import type { AgentGraphCallbacks } from '../agentGraph'
import type { TerminalBridge } from '../terminalBridge'
import { PiAgentRuntime } from '../piAgentRuntime'

const inlineInput = vi.hoisted(() => ({
  handler: undefined as ((event: InputEvent) => Promise<InputEventResult>) | undefined,
  loaderCount: 0,
  disabledDiskExtensions: false,
}))

// The real SDK factory and every other SDK export stay untouched.
vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()
  class InlineInputLoader extends actual.DefaultResourceLoader {
    constructor(options: ConstructorParameters<typeof actual.DefaultResourceLoader>[0]) {
      super({
        ...options,
        extensionFactories: [
          ...(options.extensionFactories ?? []),
          {
            name: 'm01-test-input-preflight',
            factory: (pi) => {
              pi.on('input', (event) => inlineInput.handler?.(event) ?? { action: 'continue' })
            },
          },
        ],
      })
      inlineInput.loaderCount++
      inlineInput.disabledDiskExtensions = options.noExtensions === true
    }
  }
  return { ...actual, DefaultResourceLoader: InlineInputLoader }
})

const PROVIDER_SOURCE = 'zterm-m01-sdk-preflight-test'
const TAB = 'm01-sdk-stop-only'
const REJECTION = '旧轮模型请求被拒绝'

it('real SDK input gate: stop-only rejects old send before transport; new turn reaches transport', async () => {
  const transport = vi.fn((model: Model<'openai-completions'>) => {
    const stream = createAssistantMessageEventStream()
    const message: AssistantMessage = {
      role: 'assistant',
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: [{ type: 'text', text: 'transport stub: new turn authorized' }],
      usage: {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    }
    stream.push({ type: 'start', partial: { ...message, content: [], stopReason: 'pending' } })
    stream.push({ type: 'done', reason: 'stop', message })
    return stream
  })
  const forbiddenFetch = vi.fn(() => { throw new Error('M01 test forbids network requests') })
  vi.stubGlobal('fetch', forbiddenFetch)
  // Register BEFORE the runtime captures the real compat provider. No SDK
  // transport can fall through to an HTTP implementation in either turn.
  registerApiProvider({ api: 'openai-completions', stream: transport, streamSimple: transport }, PROVIDER_SOURCE)

  const seenInputs: string[] = []
  let releaseInput!: () => void
  const inputGate = new Promise<void>((resolve) => { releaseInput = resolve })
  inlineInput.handler = async (event) => {
    seenInputs.push(event.text)
    if (event.text === 'old task') await inputGate
    return { action: 'continue' }
  }
  const states: string[] = []
  const messages: Array<{ type: string; content: string }> = []
  const callbacks: AgentGraphCallbacks = {
    emitMessage: (message) => { messages.push(message) },
    emitStateChange: (state) => { states.push(state) },
    getTerminalContext: () => null,
    onStepComplete: () => {},
  }
  // SDK receives only custom terminal tools; this bridge must never be called.
  const writeCommand = vi.fn(() => { throw new Error('M01 test forbids terminal execution') })
  const bridge = {
    getBoundTargetId: () => 'preflight-test-target',
    isConnected: () => true,
    isDisposed: () => false,
    getTerminalLockKey: () => bridge,
    writeCommand,
  } as unknown as TerminalBridge
  const runtime = new PiAgentRuntime(undefined, {
    providerType: 'openai-compatible', label: 'in-memory M01 test',
    baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'in-memory-only',
    model: 'm01-model', enableStreaming: false, reasoningMode: 'auto',
  }, { agentDir: TEST_SANDBOX.piAgentDir })
  let firstTask: Promise<void> | undefined

  try {
    expect(getApiProvider('openai-completions')).toBeDefined()
    firstTask = runtime.startTask(TAB, 'old task', 25, bridge, callbacks)
    await vi.waitFor(() => expect(seenInputs).toEqual(['old task']), { timeout: 3000 })
    expect(inlineInput.loaderCount).toBe(1)
    expect(inlineInput.disabledDiskExtensions).toBe(true)

    // The held hook belongs to the genuine Pi SDK AgentSession, not a fake
    // prompt function. Nothing has reached the provider yet.
    const oldSession = (runtime as unknown as {
      tabs: Map<string, { session: AgentSession | null }>
    }).tabs.get(TAB)?.session
    expect(oldSession).toBeInstanceOf(AgentSession)
    expect(transport).toHaveBeenCalledTimes(0)

    runtime.stop(TAB) // no follow-up/rebuild between stop and releasing input
    expect(states).toContain('stopped')
    releaseInput()
    await firstTask

    // SDK resumed the old prompt and recorded the authorization error as an
    // assistant model error. This is stronger than checking a thrown mock call:
    // it demonstrates that the SDK really attempted the old model turn.
    const oldError = oldSession!.state.messages.find(
      (message) => message.role === 'assistant' && message.stopReason === 'error'
    )
    expect(oldError?.role).toBe('assistant')
    if (oldError?.role !== 'assistant') throw new Error('missing old SDK assistant model error')
    expect(oldError.errorMessage).toContain(REJECTION)
    expect(transport).toHaveBeenCalledTimes(0)
    expect(forbiddenFetch).not.toHaveBeenCalled()
    expect(writeCommand).not.toHaveBeenCalled()
    expect(messages.some((message) => message.type === 'assistant_reply')).toBe(false)

    // Positive control: a separately authorized new turn reaches the SAME
    // registered transport. Zero old calls cannot be due to an inert stub.
    await runtime.startTask(TAB, 'new task', 25, bridge, callbacks, { sessionPolicy: 'rebuild' })
    expect(seenInputs).toEqual(['old task', 'new task'])
    const newSession = (runtime as unknown as {
      tabs: Map<string, { session: AgentSession | null }>
    }).tabs.get(TAB)?.session
    expect(newSession).toBeInstanceOf(AgentSession)
    expect(newSession).not.toBe(oldSession)
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0]?.[0]).toMatchObject({ provider: 'zterm-openai-completions', id: 'm01-model' })
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'assistant_reply', content: 'transport stub: new turn authorized',
    }))
    expect(forbiddenFetch).not.toHaveBeenCalled()
    expect(writeCommand).not.toHaveBeenCalled()
  } finally {
    releaseInput() // a failing assertion must not leave a held SDK preflight
    runtime.removeTab(TAB)
    if (firstTask) await firstTask.catch(() => {})
    inlineInput.handler = undefined
    unregisterApiProviders(PROVIDER_SOURCE)
    registerBuiltInApiProviders()
    vi.unstubAllGlobals()
  }
})
