import { describe, expect, it, vi } from 'vitest'
import { createAgentSession, type ResourceLoader } from '@earendil-works/pi-coding-agent'
import { PiAgentRuntime } from '../piAgentRuntime'
import { buildPiModelSetup } from '../piModelAdapter'
import { createBoundTerminalTools } from '../piAgentTools'
import { activeTerminalToolNames } from '../agentReadTools'
import { TEST_SANDBOX } from '../../../test/setup'

describe('实际 Pi SDK 的生产工具集合', () => {
  it('关闭内置 MCP/代码扩展后仅声明当前模式的宿主工具，且不产生后台请求', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('Forbidden network') })
    const config = { providerType: 'openai-compatible' as const, label: 'test', baseUrl: 'https://example.invalid/v1', apiKey: 'synthetic', model: 'test', enableStreaming: true, reasoningMode: 'auto' as const }
    const runtime = new PiAgentRuntime(undefined, config, { agentDir: TEST_SANDBOX.piAgentDir })
    try {
      const loader = await (runtime as unknown as { ensureLoader(): Promise<ResourceLoader> }).ensureLoader()
      const setup = await buildPiModelSetup(config)
      expect(setup.settingsManager.getCacheWarmingMode()).toBe('off')
      const { session, extensionsResult } = await createAgentSession({
        ...setup, cwd: TEST_SANDBOX.piAgentDir, agentDir: TEST_SANDBOX.piAgentDir,
        resourceLoader: loader, noTools: 'builtin',
        tools: activeTerminalToolNames(true),
        // 初始化不执行工具；缺少绑定的上下文会在任何误调用时立即失败。
        customTools: createBoundTerminalTools({ get bridge(): never { throw new Error('No terminal') }, get turn(): never { throw new Error('No turn') } }),
      })
      try {
        session.setActiveToolsByName(activeTerminalToolNames(false))
        expect(session.getActiveToolNames().sort()).toEqual(activeTerminalToolNames(false).sort())
        expect(session.getCallableToolNames()).not.toContain('execute_bound_terminal')
        expect(extensionsResult.extensions).toHaveLength(0)
        expect(network).not.toHaveBeenCalled()
      } finally { session.dispose() }
    } finally { network.mockRestore() }
  })
})
