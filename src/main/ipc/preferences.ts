import { registerIpcHandler } from '../services/ipcSecurity'
import { getStore } from '../services/store'
import { AGENT_MAX_STEPS_PREFERENCE, isValidAgentMaxSteps, readAgentMaxSteps } from '../services/agentStepBudget'

const PREFIX = 'ui_'

/**
 * 注册渲染层偏好读写 IPC handler。
 * 所有偏好以 `ui_` 前缀存入 electron-store（即 ~/.zterm/config.json）。
 */
export function registerPreferencesIpc(): void {
  registerIpcHandler('preferences:get', (_event, key: string) => {
    if (key === AGENT_MAX_STEPS_PREFERENCE) return readAgentMaxSteps()
    return getStore().get(`${PREFIX}${key}`)
  })

  registerIpcHandler('preferences:set', (_event, key: string, value: unknown) => {
    if (key === AGENT_MAX_STEPS_PREFERENCE && !isValidAgentMaxSteps(value)) {
      throw new Error('每轮工具步数上限必须是 1～1000 的整数')
    }
    getStore().set(`${PREFIX}${key}`, value)
  })
}
