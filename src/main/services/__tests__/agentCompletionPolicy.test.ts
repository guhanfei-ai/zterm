import { describe, expect, it } from 'vitest'
import { isMissingOptionalProbe } from '../agentCompletionPolicy'
import type { StepRecord } from '../agentGraphState'

const step = (command: string, exitCode: number, commandOutput: string): StepRecord => ({
  stepNumber: 1, plan: '', command, exitCode, commandOutput,
  observation: commandOutput, status: 'done',
})

describe('只读探查中的可选工具缺失', () => {
  const succeeded = step('uname -a', 0, 'Linux')
  const missing = step('docker ps -a', 127, 'sh: docker: command not found')

  it('已有成功命令且最后缺少工具时可带警告完成', () => {
    expect(isMissingOptionalProbe([succeeded, missing], 127, false)).toBe(true)
  })

  it('首个探测即失败、写模式或其他错误不放行', () => {
    expect(isMissingOptionalProbe([missing], 127, false)).toBe(false)
    expect(isMissingOptionalProbe([succeeded, missing], 127, true)).toBe(false)
    expect(isMissingOptionalProbe([succeeded, step('cat /missing', 2, 'No such file')], 2, false)).toBe(false)
    expect(isMissingOptionalProbe([succeeded, step('missing', 127, 'permission denied')], 127, false)).toBe(false)
  })

  it('不凭历史成功或未验证的步骤放行', () => {
    const unverified = { ...missing, exitCode: undefined }
    expect(isMissingOptionalProbe([succeeded, unverified], 127, false)).toBe(false)
    expect(isMissingOptionalProbe([missing, { ...succeeded, exitCode: undefined }], 127, false)).toBe(false)
  })
})
