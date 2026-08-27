import { describe, it, expect } from 'vitest'
import {
  AgentStatusGuard,
  shouldApplyStatusState,
  type RefreshRequest
} from '../agentStatusGuard'

describe('shouldApplyStatusState (pure function)', () => {
  it('returns true when version and seq both match the latest', () => {
    // 正常路径：请求发起后没有新事件，也没有更新的请求
    expect(shouldApplyStatusState(3, 2, 3, 2)).toBe(true)
  })

  it('returns false when a newer stateChange arrived after the request was sent', () => {
    // 请求发起时 version=3，响应回来时 version 已被新 stateChange 递增到 4
    // 旧 summarizing 快照必须被丢弃，避免回滚较新的 completed 终态
    expect(shouldApplyStatusState(3, 2, 4, 2)).toBe(false)
  })

  it('returns false when a newer refresh request superseded this one', () => {
    // 同一标签又发起了新的 getStatus 请求（seq=3），旧响应（seq=2）必须丢弃
    expect(shouldApplyStatusState(3, 2, 3, 3)).toBe(false)
  })

  it('returns false when both version and seq are stale', () => {
    expect(shouldApplyStatusState(1, 1, 5, 3)).toBe(false)
  })

  it('treats initial zero version/seq as valid (first refresh, no prior events)', () => {
    // 首次进入或切回标签、且没有期间状态事件时，getStatus 仍可恢复主进程当前状态
    expect(shouldApplyStatusState(0, 1, 0, 1)).toBe(true)
  })
})

describe('AgentStatusGuard (per-tab isolation)', () => {
  it('bumpStateVersion increments version per tab independently', () => {
    const guard = new AgentStatusGuard()
    expect(guard.bumpStateVersion('tab-a')).toBe(1)
    expect(guard.bumpStateVersion('tab-a')).toBe(2)
    // tab-b 完全独立，从 1 开始
    expect(guard.bumpStateVersion('tab-b')).toBe(1)
    expect(guard.bumpStateVersion('tab-a')).toBe(3)
  })

  it('beginRefresh captures the version at request time and increments seq', () => {
    const guard = new AgentStatusGuard()
    guard.bumpStateVersion('tab-a') // version=1
    const r1 = guard.beginRefresh('tab-a')
    expect(r1).toEqual<RefreshRequest>({ version: 1, seq: 1 })
    const r2 = guard.beginRefresh('tab-a')
    // 没有新 stateChange，version 仍是 1；seq 递增到 2
    expect(r2).toEqual<RefreshRequest>({ version: 1, seq: 2 })
  })

  it('shouldApplyState allows write-back when no newer event/request intervened', () => {
    const guard = new AgentStatusGuard()
    guard.bumpStateVersion('tab-a') // version=1
    const req = guard.beginRefresh('tab-a') // {version:1, seq:1}
    expect(guard.shouldApplyState('tab-a', req)).toBe(true)
  })

  it('shouldApplyState drops state when a newer stateChange arrived after the request', () => {
    const guard = new AgentStatusGuard()
    // 模拟计划中的乱序场景：
    //   summarizing 状态事件
    //   → 发起 getStatus（返回 summarizing，但延后 resolve）
    //   → completed 状态事件
    //   → 旧 getStatus 响应 resolve
    //   → 最终状态仍为 completed
    guard.bumpStateVersion('tab-a') // summarizing 事件 → version=1
    const staleReq = guard.beginRefresh('tab-a') // {version:1, seq:1}
    // 期间收到 completed 事件，version 递增到 2
    guard.bumpStateVersion('tab-a')
    // 旧 summarizing 响应回来：必须丢弃 state 字段
    expect(guard.shouldApplyState('tab-a', staleReq)).toBe(false)
  })

  it('shouldApplyState drops state when a newer refresh request superseded this one', () => {
    const guard = new AgentStatusGuard()
    guard.bumpStateVersion('tab-a') // version=1
    const oldReq = guard.beginRefresh('tab-a') // {version:1, seq:1}
    // 同一标签又发起了新的 getStatus（比如用户切回标签触发刷新）
    guard.beginRefresh('tab-a') // seq=2
    // 旧响应回来：必须丢弃 state 字段
    expect(guard.shouldApplyState('tab-a', oldReq)).toBe(false)
  })

  it('does not cross-contaminate state across tabs', () => {
    const guard = new AgentStatusGuard()
    // tab-a 收到 summarizing 事件
    guard.bumpStateVersion('tab-a') // version=1
    const reqA = guard.beginRefresh('tab-a') // {version:1, seq:1}
    // tab-b 收到 completed 事件
    guard.bumpStateVersion('tab-b') // version=1
    // tab-a 的旧响应回来：tab-b 的事件不应影响 tab-a 的判断
    expect(guard.shouldApplyState('tab-a', reqA)).toBe(true)
  })

  it('cleanup removes all records for a tab', () => {
    const guard = new AgentStatusGuard()
    guard.bumpStateVersion('tab-a')
    guard.beginRefresh('tab-a')
    guard.cleanup('tab-a')
    // 清理后该标签从零开始
    expect(guard.bumpStateVersion('tab-a')).toBe(1)
    expect(guard.beginRefresh('tab-a')).toEqual<RefreshRequest>({ version: 1, seq: 1 })
  })

  it('reproduces the full end-to-end race scenario from the plan', () => {
    // 完整复现计划第 4 步第 1 条的乱序用例：
    //   summarizing 状态事件
    //   → 发起 getStatus（返回 summarizing，但延后 resolve）
    //   → completed 状态事件
    //   → 旧 getStatus 响应 resolve
    //   → 最终状态仍为 completed（旧响应的 state 字段被丢弃）
    const guard = new AgentStatusGuard()
    const tabId = 'race-tab'

    // 1. summarizing 状态事件到达
    guard.bumpStateVersion(tabId)
    const summarizingVersion = 1

    // 2. 前端发起 getStatus（请求序号=1，记录当时版本号=1）
    const staleRequest = guard.beginRefresh(tabId)
    expect(staleRequest.version).toBe(summarizingVersion)
    expect(staleRequest.seq).toBe(1)

    // 3. completed 状态事件到达（版本号递增）
    guard.bumpStateVersion(tabId)

    // 4. 旧 getStatus 响应 resolve：guard 判定应丢弃 state 字段
    const applyStaleState = guard.shouldApplyState(tabId, staleRequest)
    expect(applyStaleState).toBe(false)

    // 5. 同时新发起的 getStatus（请求序号=2）响应回来时应被允许写回 completed
    const freshRequest = guard.beginRefresh(tabId)
    // freshRequest 发起时 version 已经是 2（completed 后），seq=2
    expect(freshRequest.version).toBe(2)
    expect(freshRequest.seq).toBe(2)
    // 期间没有新的 stateChange，可以写回 completed
    expect(guard.shouldApplyState(tabId, freshRequest)).toBe(true)
  })
})
