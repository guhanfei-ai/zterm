import type { StepRecord } from './agentGraphState'

/**
 * 只读盘点中缺少可选诊断工具（例如未安装 Docker）是调查结果，不是整轮崩溃。
 * 保守限定：本轮先有经过验证的成功命令，最后一条也是经过验证的 127，
 * 且输出确认为命令不存在。其他非零、未验证、写操作仍走失败路径。
 */
export function isMissingOptionalProbe(
  steps: StepRecord[],
  lastExitCode: number | null | undefined,
  allowWrite: boolean,
): boolean {
  if (allowWrite || lastExitCode !== 127) return false
  const executed = steps.filter((step) => step.status === 'done' && !!step.command)
  const last = executed.at(-1)
  if (!last || steps.at(-1) !== last || last.exitCode !== 127 || !/(?:command not found|command not recognized)/i.test(last.commandOutput || '')) return false
  return executed.slice(0, -1).some((step) => step.exitCode === 0)
}
