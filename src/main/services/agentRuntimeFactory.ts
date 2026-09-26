/**
 * AgentRuntime 工厂:按引擎选择创建 AgentRuntime 实例。
 *
 * 阶段 B:默认 'graph'(旧行为不受影响),Pi 通过 ZTERM_AGENT_ENGINE=pi 启用。
 * 阶段 E:默认切换为 'pi',旧 Graph 仅作为受控回退(总纲 7.7)。
 *
 * 本文件静态 import PiAgentRuntime + AgentGraphRuntime,是唯一同时依赖两个引擎
 * 的模块;AgentController 只依赖 agentRuntime.ts(接口)与本工厂,不直接 import
 * 引擎实现,保证依赖方向干净。
 */
import type { AgentRuntime, AgentEngine } from './agentRuntime'
import { AgentGraphRuntime } from './agentGraphRuntime'
import { PiAgentRuntime } from './piAgentRuntime'
import type { AiClient, ProviderConfig } from './aiClient'

export function createAgentRuntime(
  engine: AgentEngine,
  aiClient: AiClient,
  config: ProviderConfig
): AgentRuntime {
  if (engine === 'pi') {
    return new PiAgentRuntime(aiClient, config)
  }
  return new AgentGraphRuntime(aiClient)
}
