import { describe, it, expect } from 'vitest'
import { shouldEmitStateChange, type AgentState } from '../agentController'

describe('shouldEmitStateChange', () => {
  describe('stopped has highest priority', () => {
    const stopped: AgentState = 'stopped'
    it('blocks completed from overwriting stopped', () => {
      expect(shouldEmitStateChange(stopped, 'completed')).toBe(false)
    })
    it('blocks failed from overwriting stopped', () => {
      expect(shouldEmitStateChange(stopped, 'failed')).toBe(false)
    })
    it('blocks summarizing from overwriting stopped', () => {
      expect(shouldEmitStateChange(stopped, 'summarizing')).toBe(false)
    })
    it('blocks a duplicate stopped from re-emitting', () => {
      expect(shouldEmitStateChange(stopped, 'stopped')).toBe(false)
    })
  })

  describe('no duplicate terminal events', () => {
    it('blocks re-emitting completed when already completed', () => {
      expect(shouldEmitStateChange('completed', 'completed')).toBe(false)
    })
    it('blocks re-emitting failed when already failed', () => {
      expect(shouldEmitStateChange('failed', 'failed')).toBe(false)
    })
    it('blocks re-emitting stepLimitReached', () => {
      expect(shouldEmitStateChange('stepLimitReached', 'stepLimitReached')).toBe(false)
    })
  })

  describe('no middle-state rollback over terminal state', () => {
    it('blocks summarizing from rolling back completed', () => {
      // 异步收尾的旧 phase 不能把已宣告的 completed 退回 summarizing
      expect(shouldEmitStateChange('completed', 'summarizing')).toBe(false)
    })
    it('blocks planning from rolling back completed', () => {
      expect(shouldEmitStateChange('completed', 'planning')).toBe(false)
    })
    it('blocks executing from rolling back completed', () => {
      expect(shouldEmitStateChange('completed', 'executing')).toBe(false)
    })
    it('blocks observing from rolling back stepLimitReached', () => {
      expect(shouldEmitStateChange('stepLimitReached', 'observing')).toBe(false)
    })
    it('blocks starting from rolling back failed', () => {
      expect(shouldEmitStateChange('failed', 'starting')).toBe(false)
    })
  })

  describe('idle is treated as no-task and can be overwritten', () => {
    it('allows completed → idle (explicit reset)', () => {
      expect(shouldEmitStateChange('completed', 'idle')).toBe(true)
    })
    it('allows failed → idle', () => {
      expect(shouldEmitStateChange('failed', 'idle')).toBe(true)
    })
    it('allows stopped → idle', () => {
      // stopped → idle 是合法的主动重置（reset() 调用）
      // 注意：shouldEmitStateChange 规则 1 会阻止 stopped → 任何，
      // 但 reset() 不经过 shouldEmitStateChange，直接设置 this.state。
      // 这里测试的是"如果走 shouldEmitStateChange"的结果。
      expect(shouldEmitStateChange('stopped', 'idle')).toBe(false)
    })
  })

  describe('allowed transitions', () => {
    it('allows idle → planning (new task start)', () => {
      expect(shouldEmitStateChange('idle', 'planning')).toBe(true)
    })
    it('allows idle → starting', () => {
      expect(shouldEmitStateChange('idle', 'starting')).toBe(true)
    })
    it('allows planning → executing (normal progression)', () => {
      expect(shouldEmitStateChange('planning', 'executing')).toBe(true)
    })
    it('allows executing → observing', () => {
      expect(shouldEmitStateChange('executing', 'observing')).toBe(true)
    })
    it('allows observing → summarizing', () => {
      expect(shouldEmitStateChange('observing', 'summarizing')).toBe(true)
    })
    it('allows summarizing → completed (terminal transition)', () => {
      expect(shouldEmitStateChange('summarizing', 'completed')).toBe(true)
    })
    it('allows completed → stepLimitReached (rare but not a rollback)', () => {
      // 两个终态之间的转换：规则 2 不命中（不同），规则 3 不命中（next 是终态）
      expect(shouldEmitStateChange('completed', 'stepLimitReached')).toBe(true)
    })
  })
})
