import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { translateError } from './errorTranslator'
import { ThinkingParser } from './thinkingParser'
import { STREAM_TOTAL_TIMEOUT_MS } from '../config/aiClientConfig'
import type {
  ModelCapabilities,
  ModelRequest,
  ModelResult,
  ModelStreamChunk,
  ProviderConfig
} from '../model/contracts'
import { ModelStreamSession } from '../harness/modelStreamSession'

export type {
  ModelCapabilities,
  ModelMessage,
  ModelRequest,
  ModelResult,
  ModelStreamChunk,
  ProviderConfig
} from '../model/contracts'
export { ModelStreamSession } from '../harness/modelStreamSession'

/**
 * OpenAI Compatible 模型接入层。
 * 仅负责 provider 协议、流式解析与能力声明；不接收终端、主机或 Agent 领域数据。
 */
export class AiClient {
  private openai: OpenAI | null = null
  private currentConfig: ProviderConfig | null = null

  configure(config: ProviderConfig): void {
    this.currentConfig = config
    this.openai = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey
    })
  }

  getConfig(): ProviderConfig | null {
    return this.currentConfig
  }

  getCapabilities(): ModelCapabilities {
    return { streaming: true, reasoning: true }
  }

  async validateConfig(config: ProviderConfig): Promise<{ valid: boolean; error?: string }> {
    try {
      const client = new OpenAI({
        baseURL: config.baseUrl,
        apiKey: config.apiKey
      })
      await client.models.list({ timeout: 5000 })
      return { valid: true }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '未知错误'
      return { valid: false, error: message }
    }
  }

  /**
   * 执行已经投影完成的通用模型请求。调用方（Harness）拥有会话、取消与路由策略。
   */
  async sendStream(
    request: ModelRequest,
    session: ModelStreamSession,
    onChunk: (chunk: ModelStreamChunk) => void
  ): Promise<ModelResult> {
    if (!this.openai || !this.currentConfig) {
      throw new Error('AI 客户端未配置')
    }

    const messages: ChatCompletionMessageParam[] = request.messages.map((message) => ({
      role: message.role,
      content: message.content
    }))
    const parser = new ThinkingParser()
    let text = ''
    let reasoning = ''

    try {
      const stream = await this.openai.chat.completions.create(
        {
          model: this.currentConfig.model,
          messages,
          stream: true
        },
        { signal: session.abortController.signal }
      )

      const streamStartTime = Date.now()
      const iterator = stream[Symbol.asyncIterator]()
      // 用 deadline 包住每次 read：服务端完全不发包时迭代永不返回，
      // 挂死超过总超时即中止流并抛超时错误
      while (session.active) {
        const elapsed = Date.now() - streamStartTime
        if (elapsed > STREAM_TOTAL_TIMEOUT_MS) {
          console.warn('[aiClient] stream total timeout, aborting session', session.sessionId)
          session.abort()
          throw new Error('流式响应总超时')
        }

        let timeoutId: ReturnType<typeof setTimeout> | undefined
        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error('stream total timeout')),
              STREAM_TOTAL_TIMEOUT_MS - elapsed
            )
          })
          const result = await Promise.race([iterator.next(), timeoutPromise])
          if (result.done) break
          const chunk = result.value

          const delta = chunk.choices?.[0]?.delta
          if (!delta) continue

          const event: ModelStreamChunk = { done: false }
          const rawReasoning = (delta as Record<string, unknown>).reasoning_content
          if (typeof rawReasoning === 'string' && rawReasoning) {
            reasoning += rawReasoning
            event.reasoning = rawReasoning
          }

          if (delta.content) {
            const parsed = parser.feed(delta.content)
            if (parsed.reasoning) {
              reasoning += parsed.reasoning
              event.reasoning = (event.reasoning || '') + parsed.reasoning
            }
            if (parsed.text) {
              text += parsed.text
              event.text = parsed.text
            }
          }

          const finishReason = chunk.choices?.[0]?.finish_reason
          if (finishReason === 'stop' || finishReason === 'length') {
            event.done = true
          }

          onChunk(event)
        } catch (err) {
          // 读超时：中止流，把超时错误抛给外层统一处理
          if (err instanceof Error && err.message === 'stream total timeout') {
            console.warn('[aiClient] stream total timeout, aborting session', session.sessionId)
            session.abort()
            throw new Error('流式响应总超时')
          }
          throw err
        } finally {
          if (timeoutId) clearTimeout(timeoutId)
        }
      }

      // 冲刷解析器残留缓冲（流结束时未闭合的部分标签），避免残余内容被丢弃
      const flushed = parser.flush()
      if (flushed.reasoning) reasoning += flushed.reasoning
      if (flushed.text) text += flushed.text
      if ((flushed.reasoning || flushed.text) && session.active) {
        onChunk({
          done: false,
          reasoning: flushed.reasoning || undefined,
          text: flushed.text || undefined
        })
      }

      if (session.active) onChunk({ done: true })
      return { text, reasoning }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { text, reasoning }
      }

      const message = translateError(error, 'ai', '流式传输错误')
      if (session.active) onChunk({ done: true, error: message })
      // 让上层 Agent 感知真实失败并进入 failed/retry 状态，避免把网络/API
      // 错误伪装成“模型未返回内容”后继续规划。
      throw new Error(message)
    } finally {
      parser.reset()
      session.active = false
    }
  }
}
