import { FALLBACK_COMMAND } from '../../services/agentGraphConfig'
import {
  buildAgentSystemPrompt,
  buildObservationPrompt,
  buildSummaryPrompt,
  buildThinkSystemPrompt,
  buildThinkUserPrompt,
  type TerminalContext
} from '../../services/agentGraphPrompt'
import type { AgentGraphState, StepRecord } from '../../services/agentGraphState'
import type { ModelRequest } from '../../model/contracts'

function createRequest(systemPrompt: string, userPrompt: string): ModelRequest {
  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  }
}

/** 将 Agent 当前任务、正式终端证据与历史状态投影为思考阶段的模型请求。 */
export function projectThinkModelRequest(
  state: AgentGraphState,
  userMessage: string,
  terminalContext: TerminalContext | null
): ModelRequest {
  return createRequest(
    buildThinkSystemPrompt(state.allowWrite),
    buildThinkUserPrompt(state, userMessage, terminalContext)
  )
}

/** 将首轮检查型任务的强制取证约束投影为修正阶段请求。 */
export function projectRepairPlanModelRequest(
  state: AgentGraphState,
  userMessage: string,
  terminalContext: TerminalContext | null
): ModelRequest {
  const systemPrompt = `${buildThinkSystemPrompt(state.allowWrite)}

【强制执行修正（仅本轮生效）】
你刚刚试图不通过任何命令就直接给结论（或者以聊天方式收尾）。
但本条用户请求属于"检查 / 观察 / 排查 / 状态"型问题，必须基于真实执行结果给结论。
本轮约束：
- 不允许输出 DONE: ...
- 不允许纯聊天收尾
- 必须输出 PLAN: ... \\n COMMAND: ...（单行只读命令）
- 命令必须是只读类型（ps / systemctl status / journalctl / ss / netstat / df / free / uptime / top / lsof / ls / cat / grep 等）
- 如果你真的不知道跑什么，至少跑：\`${FALLBACK_COMMAND}\`
- 只读模式 = 禁止写，不等于禁止执行只读命令`

  return createRequest(systemPrompt, buildThinkUserPrompt(state, userMessage, terminalContext))
}

/** 将单条命令观察结果投影为模型可消费的观察请求。 */
export function projectObservationModelRequest(
  state: AgentGraphState
): ModelRequest {
  return createRequest(
    buildAgentSystemPrompt(state.allowWrite),
    buildObservationPrompt(
      state.currentStep,
      state.pendingCommand,
      state.commandOutput,
      state.taskDescription
    )
  )
}

/** 将裁剪后的执行步骤投影为最终总结请求。 */
export function projectSummaryModelRequest(
  state: AgentGraphState,
  steps: StepRecord[]
): ModelRequest {
  return createRequest(
    buildAgentSystemPrompt(state.allowWrite),
    buildSummaryPrompt(state.taskDescription, steps)
  )
}
