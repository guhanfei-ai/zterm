import { beforeEach, describe, expect, it, vi } from 'vitest'

const { data, handlers } = vi.hoisted(() => ({
  data: new Map<string, unknown>(),
  handlers: new Map<string, (_event: unknown, key: string, value?: unknown) => unknown>(),
}))
vi.mock('../store', () => ({
  getStore: () => ({ get: (key: string) => data.get(key), set: (key: string, value: unknown) => data.set(key, value) }),
}))
vi.mock('../ipcSecurity', () => ({
  registerIpcHandler: (channel: string, handler: (_event: unknown, key: string, value?: unknown) => unknown) => handlers.set(channel, handler),
}))

import { readAgentMaxSteps } from '../agentStepBudget'
import { registerPreferencesIpc } from '../../ipc/preferences'

beforeEach(() => { data.clear(); handlers.clear(); registerPreferencesIpc() })

describe('工具步数偏好持久化', () => {
  it('未保存配置默认 100，保存后重新读取相同上限', () => {
    const get = handlers.get('preferences:get')!
    const set = handlers.get('preferences:set')!
    expect(get(null, 'agentMaxSteps')).toBe(100)
    for (const value of [1, 25, 60, 1000]) {
      set(null, 'agentMaxSteps', value)
      expect(data.get('ui_agentMaxSteps')).toBe(value)
      expect(get(null, 'agentMaxSteps')).toBe(value)
      expect(readAgentMaxSteps()).toBe(value)
    }
  })

  it('拒绝无效值，保留已保存配置；无效旧配置回退为 100', () => {
    const set = handlers.get('preferences:set')!
    set(null, 'agentMaxSteps', 60)
    for (const value of [undefined, null, '100', NaN, Infinity, -1, 0, 1.5, 1001]) {
      expect(() => set(null, 'agentMaxSteps', value)).toThrow('1～1000')
      expect(readAgentMaxSteps()).toBe(60)
      data.set('ui_agentMaxSteps', value)
      expect(readAgentMaxSteps()).toBe(100)
      set(null, 'agentMaxSteps', 60)
    }
  })
})
