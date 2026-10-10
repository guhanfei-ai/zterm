import type { AssistantMessage, Model } from '@earendil-works/pi-ai'
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { STREAM_TOTAL_TIMEOUT_MS } from '../config/aiClientConfig'

/** 覆盖响应头与流读取；上游忽略取消时也及时结束宿主的等待。 */
export function withPiModelDeadline(
  model: Model<'openai-completions'>,
  start: (signal: AbortSignal) => AssistantMessageEventStream,
  sourceSignal?: AbortSignal
): AssistantMessageEventStream {
  const output = new AssistantMessageEventStream()
  const abort = new AbortController()
  let finished = false
  const errorMessage = (reason: 'aborted' | 'error', text: string): AssistantMessage => ({
    role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: reason, errorMessage: text, timestamp: Date.now(),
  })
  const cleanup = (): void => {
    clearTimeout(timer)
    sourceSignal?.removeEventListener('abort', onAbort)
  }
  const fail = (reason: 'aborted' | 'error', text: string): void => {
    if (finished) return
    finished = true
    output.push({ type: 'error', reason, error: errorMessage(reason, text) })
    output.end()
    cleanup()
    abort.abort(new Error(text))
  }
  const onAbort = (): void => fail('aborted', '已停止模型请求')
  const timer = setTimeout(() => fail('error', '模型响应超过 180 秒，请重试或检查服务连接'), STREAM_TOTAL_TIMEOUT_MS)
  if (sourceSignal?.aborted) { onAbort(); return output }
  sourceSignal?.addEventListener('abort', onAbort, { once: true })

  void (async () => {
    try {
      const upstream = start(abort.signal)
      for await (const event of upstream) {
        if (finished) break
        output.push(event)
      }
      if (!finished) {
        output.end(await upstream.result())
        finished = true
      }
    } catch (error) {
      fail('error', error instanceof Error ? error.message : '模型请求失败')
    } finally { cleanup() }
  })()
  return output
}
