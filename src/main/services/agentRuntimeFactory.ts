/** 创建产品使用的 Pi 执行体，Controller 通过 AgentRuntime 契约管理生命周期。 */
import type { AgentRuntime } from './agentRuntime'
import { PiAgentRuntime } from './piAgentRuntime'
import type { ProviderConfig } from './aiClient'

export function createAgentRuntime(config: ProviderConfig): AgentRuntime {
  return new PiAgentRuntime(config)
}
