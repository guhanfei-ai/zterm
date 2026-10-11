import { getStore } from './store'

export const AGENT_MAX_STEPS_PREFERENCE = 'agentMaxSteps'
export const DEFAULT_AGENT_MAX_STEPS = 100
export const MAX_AGENT_MAX_STEPS = 1000

export function isValidAgentMaxSteps(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= MAX_AGENT_MAX_STEPS
}

/** 每轮开始时读取；未保存或无效的配置使用默认 100 步。 */
export function readAgentMaxSteps(): number {
  const value = getStore().get(`ui_${AGENT_MAX_STEPS_PREFERENCE}`)
  return isValidAgentMaxSteps(value) ? value : DEFAULT_AGENT_MAX_STEPS
}
