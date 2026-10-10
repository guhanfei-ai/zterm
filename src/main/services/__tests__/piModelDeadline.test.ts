import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMessage, Model } from '@earendil-works/pi-ai'
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { withPiModelDeadline } from '../piModelDeadline'

const model = { api: 'openai-completions', provider: 'test', id: 'test' } as Model<'openai-completions'>
const answer = { role: 'assistant', content: [{ type: 'text', text: '正常回复' }], api: model.api, provider: model.provider, model: model.id,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'stop', timestamp: 1 } as AssistantMessage

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Pi 单次模型请求期限（实际 SDK 事件流，无网络）', () => {
  it('上游不返回也会结束宿主等待，报告 error，拒绝迟到的成功回复', async () => {
    const upstream = new AssistantMessageEventStream()
    let signal!: AbortSignal
    const output = withPiModelDeadline(model, value => { signal = value; return upstream })
    const result = output.result()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(await result).toMatchObject({ stopReason: 'error', errorMessage: expect.stringContaining('180 秒') })
    expect(signal.aborted).toBe(true)
    upstream.push({ type: 'done', reason: 'stop', message: answer }); upstream.end()
    const events = []
    for await (const event of output) events.push(event.type)
    expect(events).toEqual(['error'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('正常流保留原内容并清理计时；人类取消仍表示 aborted', async () => {
    const upstream = new AssistantMessageEventStream()
    const output = withPiModelDeadline(model, () => upstream)
    upstream.push({ type: 'done', reason: 'stop', message: answer }); upstream.end()
    expect(await output.result()).toEqual(answer)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    const abort = new AbortController()
    const pending = withPiModelDeadline(model, () => new AssistantMessageEventStream(), abort.signal)
    abort.abort()
    expect(await pending.result()).toMatchObject({ stopReason: 'aborted' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('已经取消的调用不启动上游请求', async () => {
    const abort = new AbortController(); abort.abort()
    const start = vi.fn()
    expect(await withPiModelDeadline(model, start, abort.signal).result()).toMatchObject({ stopReason: 'aborted' })
    expect(start).not.toHaveBeenCalled()
  })
})
