import { describe, expect, it } from 'vitest'
import { TerminalOutputBuffer } from '../terminalOutputBuffer'
describe('终端输出内存边界', () => {
  it('单个巨块和多块均不能超过总量上限', () => {
    const buffer = new TerminalOutputBuffer(10, 3)
    buffer.push('x'.repeat(1000))
    expect(buffer.recent(100)).toHaveLength(10)
    buffer.push('12345'); buffer.push('67890')
    expect(buffer.recent(100)).toBe('1234567890')
  })
  it('保留最近行，并限制碎片数量', () => {
    const buffer = new TerminalOutputBuffer(100, 2)
    buffer.push('old\n'); buffer.push('a\n'); buffer.push('b\nc')
    expect(buffer.recent(2)).toBe('b\nc')
    buffer.clear()
    expect(buffer.recent(100)).toBe('')
  })
})
