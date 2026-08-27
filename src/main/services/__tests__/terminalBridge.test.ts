import { describe, it, expect } from 'vitest'

// Extract the extractLineDelta function from terminalBridge for isolated testing.
// We replicate the logic here since it's a non-exported module-level function.

function extractLineDelta(snapshot: string, current: string): string {
  if (!snapshot) return current

  const snapLines = snapshot.split('\n')
  const currLines = current.split('\n')

  // Find common prefix length (lines that haven't changed)
  let commonLen = 0
  const minLen = Math.min(snapLines.length, currLines.length)
  for (let i = 0; i < minLen; i++) {
    if (snapLines[i] === currLines[i]) {
      commonLen++
    } else {
      break
    }
  }

  // If snapshot is entirely a prefix of current (no overwrites), simple slice
  if (commonLen === snapLines.length && currLines.length > snapLines.length) {
    return currLines.slice(commonLen).join('\n')
  }

  // If common prefix is shorter than snapshot, some lines were overwritten.
  // Return everything after the common prefix — includes modified + new lines.
  if (commonLen < snapLines.length) {
    return currLines.slice(commonLen).join('\n')
  }

  // Equal content — no delta
  if (commonLen === snapLines.length && commonLen === currLines.length) {
    return ''
  }

  // Fallback: return entire current output
  return current
}

describe('extractLineDelta', () => {
  describe('scenario 1: prefix match (simple append)', () => {
    it('should return only newly appended lines when snapshot is a complete prefix', () => {
      const snapshot = 'line1\nline2\nline3'
      const current = 'line1\nline2\nline3\nline4\nline5'
      const delta = extractLineDelta(snapshot, current)
      expect(delta).toBe('line4\nline5')
    })

    it('should handle empty snapshot', () => {
      const delta = extractLineDelta('', 'new output')
      expect(delta).toBe('new output')
    })

    it('should handle single-line append', () => {
      const snapshot = 'line1'
      const current = 'line1\nline2'
      const delta = extractLineDelta(snapshot, current)
      expect(delta).toBe('line2')
    })
  })

  describe('scenario 2: line rewrite (terminal carriage-return overwrite)', () => {
    it('should detect line overwrite and return modified + new lines', () => {
      // Progress bar scenario: line3 was rewritten
      const snapshot = 'line1\nline2\nprogress: 50%'
      const current = 'line1\nline2\nprogress: 100%\nDone'
      const delta = extractLineDelta(snapshot, current)
      // Common prefix = 2 lines (line1, line2)
      // After common prefix: 'progress: 100%' and 'Done'
      expect(delta).toBe('progress: 100%\nDone')
    })

    it('should handle first line being rewritten', () => {
      const snapshot = 'old line 1\nline2'
      const current = 'new line 1\nline2'
      // Common prefix = 0 lines (first line differs)
      // Everything after common prefix is returned
      const delta = extractLineDelta(snapshot, current)
      expect(delta).toBe('new line 1\nline2')
    })

    it('should handle multiple consecutive line overwrites', () => {
      const snapshot = 'a\nb\nc\nold1\nold2'
      const current = 'a\nb\nc\nnew1\nnew2\nextra'
      const delta = extractLineDelta(snapshot, current)
      expect(delta).toBe('new1\nnew2\nextra')
    })
  })

  describe('scenario 3: identical content (no delta)', () => {
    it('should return empty string when snapshot and current are identical', () => {
      const snapshot = 'line1\nline2\nline3'
      const current = 'line1\nline2\nline3'
      const delta = extractLineDelta(snapshot, current)
      expect(delta).toBe('')
    })

    it('should return empty string for identical single-line content', () => {
      const delta = extractLineDelta('same line', 'same line')
      expect(delta).toBe('')
    })

    it('should return empty string for identical empty content', () => {
      const delta = extractLineDelta('', '')
      expect(delta).toBe('')
    })
  })

  describe('edge cases', () => {
    it('should handle current shorter than snapshot (terminal scrollback trimming)', () => {
      const snapshot = 'line1\nline2\nline3\nline4\nline5'
      const current = 'line1\nline2\nline3\nline4'
      // Common prefix = 4 lines, snapLines.length=5, commonLen < snapLines.length
      // → returns currLines.slice(4) = [] → empty string joined = ''
      const delta = extractLineDelta(snapshot, current)
      expect(delta).toBe('')
    })

    it('should handle completely different content', () => {
      const snapshot = 'aaa\nbbb'
      const current = 'xxx\nyyy\nzzz'
      // Common prefix = 0, returns all current lines
      const delta = extractLineDelta(snapshot, current)
      expect(delta).toBe('xxx\nyyy\nzzz')
    })

    it('should handle trailing newline differences', () => {
      const snapshot = 'line1\nline2'
      const current = 'line1\nline2\n'
      // Split gives: snapLines = ['line1', 'line2'], currLines = ['line1', 'line2', '']
      // commonLen = 2 === snapLines.length, currLines.length > snapLines.length
      // → returns currLines.slice(2) = [''] → ''
      const delta = extractLineDelta(snapshot, current)
      expect(delta).toBe('')
    })
  })
})
