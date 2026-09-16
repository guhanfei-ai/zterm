import { FALLBACK_COMMAND } from '../../services/agentGraphConfig'
import {
  buildReplySystemPrompt,
  buildReplyUserPrompt,
  type TerminalContext
} from '../../services/agentGraphPrompt'
import type { AgentGraphState } from '../../services/agentGraphState'
import type { ModelRequest } from '../../model/contracts'

function createRequest(systemPrompt: string, userPrompt: string): ModelRequest {
  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  }
}

/** 将对话历史（含工具结果）投影为 reply 主循环的模型请求。 */
export function projectReplyModelRequest(
  state: AgentGraphState,
  userMessage: string,
  terminalContext: TerminalContext | null
): ModelRequest {
  return createRequest(
    buildReplySystemPrompt(state.allowWrite),
    buildReplyUserPrompt(state, userMessage, terminalContext)
  )
}

/** 将首轮检查型任务的强制取证约束投影为修正阶段请求。 */
export function projectRepairPlanModelRequest(
  state: AgentGraphState,
  userMessage: string,
  terminalContext: TerminalContext | null
): ModelRequest {
  const systemPrompt = `${buildReplySystemPrompt(state.allowWrite)}

【强制执行修正（仅本轮生效）】
你刚刚试图不通过任何命令就直接给结论（或者以聊天方式收尾）。
但本条用户请求属于"检查 / 观察 / 排查 / 状态"型问题，必须基于真实执行结果给结论。
本轮约束：
- 不允许纯聊天收尾，也不允许带 DONE 前缀的结论
- 必须输出 PLAN: ... \\n COMMAND: ...（单行只读命令）
- 命令必须是只读类型（ps / systemctl status / journalctl / ss / netstat / df / free / uptime / top / lsof / ls / cat / grep 等）
- 如果你真的不知道跑什么，至少跑：\`${FALLBACK_COMMAND}\`
- 只读模式 = 禁止写，不等于禁止执行只读命令`

  return createRequest(systemPrompt, buildReplyUserPrompt(state, userMessage, terminalContext))
}
