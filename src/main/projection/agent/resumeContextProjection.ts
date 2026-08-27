import type { AgentContextSnapshot, StopReason } from '../../services/agentContextStore'
import type { AgentGraphState } from '../../services/agentGraphState'

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function stopReasonLabel(reason: NonNullable<StopReason>): string {
  const labels: Record<NonNullable<StopReason>, string> = {
    ROUND_LIMIT: '上一轮因达到步数上限而停止',
    USER_INTERRUPT: '上一轮因用户手动停止而中断',
    ERROR: '上一轮因异常错误而停止',
    COMPLETED: '上一轮已完成'
  }
  return labels[reason]
}

/** 将已保存的正式任务快照投影为后续模型调用可使用的恢复材料。 */
export function projectPersistedResumeContext(snapshot: AgentContextSnapshot): string | null {
  if (snapshot.stopReason === 'COMPLETED' || !snapshot.taskDescription) return null

  const lines: string[] = [
    '【续接上下文】检测到当前对话框中存在未完成的 Agent 任务，请基于以下已有上下文继续推进：',
    '',
    `任务目标：${snapshot.taskDescription}`
  ]
  if (snapshot.boundHost) lines.push(`绑定主机：${snapshot.boundHost}`)
  if (snapshot.systemInfo?.distroName) {
    const packageManager = snapshot.systemInfo.packageManager ? `，包管理器 ${snapshot.systemInfo.packageManager}` : ''
    lines.push(`系统环境：${snapshot.systemInfo.distroName} ${snapshot.systemInfo.distroVersion}（内核 ${snapshot.systemInfo.kernel}）${packageManager}`)
  } else if (snapshot.systemSummary) {
    lines.push(`系统摘要：${snapshot.systemSummary}`)
  }
  lines.push(`当前进度：${snapshot.currentStep} / ${snapshot.maxSteps} 步`)
  if (snapshot.stopReason) {
    lines.push(`停止原因：${stopReasonLabel(snapshot.stopReason)}${snapshot.stoppedAt ? `（${snapshot.stoppedAt}）` : ''}`)
  }
  lines.push('')

  if (snapshot.steps.length > 0) {
    lines.push('已完成步骤摘要：')
    for (const step of snapshot.steps.slice(-10)) {
      const command = step.command ? ` | 命令：\`${step.command}\`` : ''
      const observation = step.observation ? ` | 结果：${truncate(step.observation, 160)}` : ''
      lines.push(`- 步骤 ${step.stepNumber}：${step.plan || '(无计划)'}${command}${observation} [${step.status}]`)
    }
    lines.push('')
  }
  if (snapshot.recentKeyOutputs.length > 0) {
    lines.push('最近关键输出：')
    for (const output of snapshot.recentKeyOutputs.slice(-3)) {
      lines.push(`- 步骤 ${output.stepNumber}${output.command ? `（\`${output.command}\`）` : ''}：${truncate(output.output, 240)}`)
    }
    lines.push('')
  }
  if (snapshot.lastConclusion) {
    lines.push(`已生成的结论摘要：${truncate(snapshot.lastConclusion, 400)}`)
    lines.push('')
  }
  lines.push('请在下一轮规划中避免重复已完成步骤；如需直接进入收尾阶段请输出 DONE 标记。')
  return lines.join('\n')
}

/** 将运行中的图状态投影为恢复材料，供后续投影器在需要时复用。 */
export function projectGraphResumeContext(state: AgentGraphState): string | null {
  if (state.stopReason === 'COMPLETED' || !state.taskDescription || state.steps.length === 0) return null
  return projectPersistedResumeContext({
    chatTabId: state.chatTabId,
    taskId: state.taskId || null,
    taskDescription: state.taskDescription,
    createdAt: '',
    updatedAt: '',
    currentStep: state.currentStep,
    maxSteps: state.maxSteps,
    stopReason: state.stopReason,
    steps: state.steps.map((step) => ({
      stepNumber: step.stepNumber,
      plan: step.plan,
      command: step.command,
      observation: step.observation,
      status: step.status
    })),
    recentKeyOutputs: [],
    systemInfo: state.systemInfo,
    lastConclusion: state.conclusion || undefined,
    allowWrite: state.allowWrite,
    autoExecute: state.autoExecute,
    boundHost: state.boundHost,
    conversationHistory: state.conversationHistory
  })
}
