import { describe, expect, it, vi } from 'vitest'
const create = vi.hoisted(() => vi.fn())
vi.mock('openai', () => ({ default: class { chat = { completions: { create } } } }))
import { AiClient } from '../aiClient'
const config = { providerType: 'openai-compatible' as const, label: 'test', baseUrl: 'https://example.invalid/v1', apiKey: 'synthetic', model: 'chosen-model', enableStreaming: true, reasoningMode: 'auto' as const }
describe('验证选定模型的原生工具协议', () => {
  it('普通文本回复及无效参数不能冒充工具调用可用', async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: 'hello' } }] })
    expect((await new AiClient().validateConfig(config)).valid).toBe(false)
    create.mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{ function: { name: 'zterm_capability_check', arguments: 'invalid-json' } }] } }] })
    expect((await new AiClient().validateConfig(config)).valid).toBe(false)
  })
  it('使用所选模型测试工具调用，不执行任何工具或模型列表探测', async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{ function: { name: 'zterm_capability_check', arguments: '{}' } }] } }] })
    expect(await new AiClient().validateConfig(config)).toEqual({ valid: true })
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'chosen-model', tools: expect.any(Array) }), { timeout: 10_000, maxRetries: 0 })
  })
})
