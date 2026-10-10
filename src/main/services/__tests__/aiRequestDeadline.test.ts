import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ create: vi.fn(), options: [] as unknown[] }))
vi.mock('openai', () => ({ default: class {
  chat = { completions: { create: sdk.create } }
  constructor(options: unknown) { sdk.options.push(options) }
} }))
import { AiClient, ModelStreamSession } from '../aiClient'

const config = { providerType: 'openai-compatible' as const, label: 'test', baseUrl: 'https://model.example/v1', apiKey: 'synthetic', model: 'test', enableStreaming: true, reasoningMode: 'auto' as const }

beforeEach(() => { vi.useFakeTimers(); sdk.create.mockReset(); sdk.options.length = 0 })
afterEach(() => vi.useRealTimers())

describe('模型请求时限（内存 SDK 桩，无网络请求）', () => {
  it('尚未收到响应头也在总期限结束，错误可见且请求被中止，无自动重试', async () => {
    sdk.create.mockImplementation(() => new Promise(() => {}))
    const client = new AiClient(); client.configure(config)
    const session = new ModelStreamSession('headers')
    const chunks = vi.fn()
    const pending = client.sendStream({ messages: [{ role: 'user', content: '你好' }] }, session, chunks)
    const rejected = expect(pending).rejects.toThrow('180 秒')
    await vi.advanceTimersByTimeAsync(180_000)
    await rejected
    expect(session.abortController.signal.aborted).toBe(true)
    expect(chunks).toHaveBeenCalledWith({ done: true, error: expect.stringContaining('180 秒') })
    expect(sdk.create).toHaveBeenCalledTimes(1)
    expect(sdk.options[0]).toMatchObject({ timeout: 30_000, maxRetries: 0 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('收到响应头不重置截止时间，阻塞的流读取仍会结束', async () => {
    let headers!: (stream: unknown) => void
    sdk.create.mockImplementation(() => new Promise(resolve => { headers = resolve }))
    const client = new AiClient(); client.configure(config)
    const session = new ModelStreamSession('stream')
    const pending = client.sendStream({ messages: [] }, session, vi.fn())
    const rejected = expect(pending).rejects.toThrow('180 秒')
    await vi.advanceTimersByTimeAsync(170_000)
    headers({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) })
    await vi.advanceTimersByTimeAsync(10_000)
    await rejected
    expect(session.active).toBe(false)
  })

  it('正常结束清理截止时间，保留内容和推理结果', async () => {
    sdk.create.mockResolvedValue({ async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: '你好！', reasoning_content: 'thinking' }, finish_reason: 'stop' }] }
    } })
    const client = new AiClient(); client.configure(config)
    const result = await client.sendStream({ messages: [] }, new ModelStreamSession('ok'), vi.fn())
    expect(result).toEqual({ text: '你好！', reasoning: 'thinking' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
