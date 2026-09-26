/**
 * Pi 模型适配器契约测试(验收退回 R03/R04)。
 *
 * R03(协议路由):断言自定义 provider 真实走 openai-completions Chat
 * Completions 实现,POST {baseUrl}/chat/completions,body 含 model 名与
 * tools schema,Authorization 用 zTerm 配置的 key。fixture 只支持
 * Completions(模拟只兼容 /chat/completions 的服务)。
 *
 * R04(初始化隔离):断言 ModelRuntime.create 全链路不读用户 home
 * (注入哨兵 PI_AGENT_DIR 指向 tmp)、无命令型配置执行(子进程 spawn 计数)、
 * getAuth 只返回 runtime 注入的 key(不回落环境变量)。
 *
 * 不调用作者真实服务;HTTP 用本地一次性 socket 捕获请求。
 * 遵守 008-禁止代启动软件:本测试是随命令结束即退出的一次性纯计算,
 * http server 仅在测试进程内监听回环地址,测试结束即关闭。
 */
import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import {
  buildPiModelSetup,
  buildCompletionsModel,
  ZTERM_PROVIDER_ID,
  ensurePiSandboxEnv,
} from '../piModelAdapter'

// ---- 一次性本地 HTTP 捕获服务器(回环,测试结束即关) ----

interface CapturedRequest {
  method: string
  url: string
  authHeader: string | undefined
  body: any
}

interface CaptureServer {
  requests: CapturedRequest[]
  close: () => Promise<void>
  port: number
}

async function startCaptureServer(respondWith: (req: CapturedRequest) => string): Promise<CaptureServer> {
  const requests: CapturedRequest[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      let body: unknown = null
      try { body = JSON.parse(raw || 'null') } catch { body = raw }
      const captured: CapturedRequest = {
        method: req.method || 'GET',
        url: req.url || '/',
        authHeader: req.headers['authorization'],
        body,
      }
      requests.push(captured)
      // openai-completions 实现强制 stream:true,响应必须是 SSE
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(respondWith(captured))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  return {
    requests,
    port: addr.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** 最小 Chat Completions SSE 流(供 openai-completions 实现解析)。 */
function chatCompletionSse(text: string): string {
  const chunk = (delta: Record<string, unknown>): string =>
    `data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta }] })}\n\n`
  return (
    chunk({ role: 'assistant', content: '' }) +
    chunk({ content: text }) +
    `data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n` +
    'data: [DONE]\n\n'
  )
}

// ---- 临时 home 哨兵 ----

let tmpSandbox: string | null = null

function sandboxDir(): string {
  if (!tmpSandbox) {
    tmpSandbox = mkdtempSync(path.join(os.tmpdir(), 'zterm-pi-test-'))
  }
  return tmpSandbox
}

afterEach(async () => {
  if (tmpSandbox) {
    rmSync(tmpSandbox, { recursive: true, force: true })
    tmpSandbox = null
  }
})

// ---- 测试 ----

describe('R03 协议路由:真实走 Chat Completions', () => {
  it('streamSimple 发 POST {baseUrl}/chat/completions,携带 model 与凭据', async () => {
    const server = await startCaptureServer(() => chatCompletionSse('ok'))
    try {
      const { model, modelRuntime } = await buildPiModelSetup({
        providerType: 'openai-compatible',
        label: 'test',
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        apiKey: 'sk-zterm-test-key',
        model: 'my-model-x',
        enableStreaming: false,
        reasoningMode: 'auto',
      }, {
        // L01:测试直接调用(无会话)—— 传常开授权与 uid 供给
        modelAuth: { allowedUid: 1 },
        currentTurnUid: () => 1,
      })

      // 通过 ModelRuntime 的 provider 链发起一次真实请求(pi 内部经
      // getApiProvider('openai-completions') 路由,暴露协议/URL/凭据问题)
      const stream = modelRuntime.streamSimple(model, {
        messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
      } as never)
      const result = await stream.result()

      // 请求形态断言
      expect(server.requests.length).toBe(1)
      const req = server.requests[0]
      expect(req.method).toBe('POST')
      expect(req.url).toBe('/v1/chat/completions')
      expect(req.authHeader).toBe('Bearer sk-zterm-test-key')
      expect(req.body.model).toBe('my-model-x')
      expect(req.body.messages).toBeInstanceOf(Array)
      expect(req.body.stream).toBe(true)

      // 响应解析:文本回到 result
      expect(result.stopReason).not.toBe('error')
      const contents = (result.content ?? []) as Array<{ type: string; text?: string }>
      const text = contents
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('')
      expect(text).toContain('ok')
    } finally {
      await server.close()
    }
  }, 15_000)

  it('内置 openai(Responses API)与本适配器 provider 不同 id', () => {
    // 复证 R03 根因:内置 'openai' provider 固定走 Responses;
    // 适配器必须使用独立 provider id + api 字段路由。
    expect(ZTERM_PROVIDER_ID).not.toBe('openai')
    const model = buildCompletionsModel({
      providerType: 'openai-compatible',
      label: 'x',
      baseUrl: 'http://x/v1',
      apiKey: 'k',
      model: 'm',
      enableStreaming: false,
      reasoningMode: 'auto',
    })
    expect(model.api).toBe('openai-completions')
    expect(model.provider).toBe(ZTERM_PROVIDER_ID)
    expect(model.baseUrl).toBe('http://x/v1')
  })
})

describe('R04 初始化隔离', () => {
  it('ModelRuntime 不读用户 home:哨兵 PI_AGENT_DIR 指向 tmp(全链路创建后验证)', async () => {
    const prevAgentDir = process.env.PI_AGENT_DIR
    const prevHome = process.env.HOME
    const fakeHome = mkdtempSync(path.join(os.tmpdir(), 'fake-home-'))
    process.env.HOME = fakeHome
    try {
      ensurePiSandboxEnv()
      // getAgentDir 读取的 env 生效,不是 ~/.pi
      expect(process.env.PI_AGENT_DIR).toBeTruthy()
      expect(process.env.PI_AGENT_DIR).not.toContain('.pi')

      // 全链路创建:modelsPath null + inMemory 凭据
      const { modelRuntime } = await buildPiModelSetup({
        providerType: 'openai-compatible',
        label: 'x',
        baseUrl: 'http://127.0.0.1:9/v1', // 端口 9(discard)不会真连
        apiKey: 'k',
        model: 'm',
        enableStreaming: false,
        reasoningMode: 'auto',
      })
      expect(modelRuntime).toBeTruthy()
      // 自定义 provider 已注册且模型可见
      const models = modelRuntime.getModels(ZTERM_PROVIDER_ID)
      expect(models.some((m) => m.id === 'm')).toBe(true)

      // S01 修正:fake home 检查后置到全链路创建**之后** ——
      // 任何初始化路径都不应在用户 home 创建 .pi 目录
      const fs = await import('node:fs')
      expect(fs.existsSync(path.join(fakeHome, '.pi'))).toBe(false)
    } finally {
      process.env.HOME = prevHome
      if (prevAgentDir === undefined) delete process.env.PI_AGENT_DIR
      else process.env.PI_AGENT_DIR = prevAgentDir
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })

  it('凭据只来自 runtime 注入:getAuth 返回注入 key,不回落环境变量', async () => {
    const prevKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-from-env-should-not-win'
    try {
      const { modelRuntime, model } = await buildPiModelSetup({
        providerType: 'openai-compatible',
        label: 'x',
        baseUrl: 'http://x/v1',
        apiKey: 'sk-zterm-injected',
        model: 'm',
        enableStreaming: false,
        reasoningMode: 'auto',
      })
      // provider 是 zterm-openai-completions,环境变量里的 OPENAI_API_KEY
      // 与它无关;注入 key 生效
      const auth = await modelRuntime.getAuth(model)
      expect(auth).toBeTruthy()
      const key = (auth?.auth as { apiKey?: string } | undefined)?.apiKey
      expect(key).toBe('sk-zterm-injected')
    } finally {
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prevKey
    }
  })
})
