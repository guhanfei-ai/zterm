import { describe, it, expect } from 'vitest'
import { ThinkingParser, ThinkingState } from '../thinkingParser'

describe('ThinkingParser', () => {
  describe('complete thinking tag parsing', () => {
    it('should parse a complete <thinking>...</thinking> block and separate reasoning from text', () => {
      const parser = new ThinkingParser()
      const result = parser.feed('<thinking>reason</thinking>text')
      expect(result.reasoning).toBe('reason')
      expect(result.text).toBe('text')
      expect(parser.getState()).toBe(ThinkingState.outside)
    })

    it('should parse reasoning content only when no text follows closing tag', () => {
      const parser = new ThinkingParser()
      const result = parser.feed('<thinking>reason</thinking>')
      expect(result.reasoning).toBe('reason')
      expect(result.text).toBe('')
    })

    it('should parse text before thinking tag', () => {
      const parser = new ThinkingParser()
      const result = parser.feed('prefix<thinking>reason</thinking>')
      expect(result.reasoning).toBe('reason')
      expect(result.text).toBe('prefix')
    })

    it('should handle plain text without any thinking tags', () => {
      const parser = new ThinkingParser()
      const result = parser.feed('just plain text here')
      expect(result.reasoning).toBe('')
      expect(result.text).toBe('just plain text here')
      expect(parser.getState()).toBe(ThinkingState.outside)
    })

    it('should handle empty thinking block', () => {
      const parser = new ThinkingParser()
      const result = parser.feed('<thinking></thinking>text')
      expect(result.reasoning).toBe('')
      expect(result.text).toBe('text')
    })

    it('should handle multiple thinking blocks in one feed', () => {
      const parser = new ThinkingParser()
      const result = parser.feed('<thinking>r1</thinking>t1<thinking>r2</thinking>t2')
      expect(result.reasoning).toBe('r1r2')
      expect(result.text).toBe('t1t2')
    })
  })

  describe('cross-chunk partial tag parsing', () => {
    it('should handle partial open tag split across chunks', () => {
      const parser = new ThinkingParser()
      // First chunk contains partial <thinking> tag
      const r1 = parser.feed('<thin')
      expect(r1.reasoning).toBe('')
      expect(r1.text).toBe('')
      expect(parser.getState()).toBe(ThinkingState.partial_open)

      // Second chunk completes the tag
      const r2 = parser.feed('king>reason</thinking>text')
      expect(r2.reasoning).toBe('reason')
      expect(r2.text).toBe('text')
      expect(parser.getState()).toBe(ThinkingState.outside)
    })

    it('should handle partial open tag "<t" then "hinking>"', () => {
      const parser = new ThinkingParser()
      const r1 = parser.feed('<t')
      expect(r1.text).toBe('')
      expect(parser.getState()).toBe(ThinkingState.partial_open)

      const r2 = parser.feed('hinking>reason</thinking>text')
      expect(r2.reasoning).toBe('reason')
      expect(r2.text).toBe('text')
    })

    it('should handle partial close tag split across chunks', () => {
      const parser = new ThinkingParser()
      // Enter inside state first
      const r1 = parser.feed('<thinking>reasoning here</thin')
      expect(r1.reasoning).toBe('reasoning here')
      expect(r1.text).toBe('')
      expect(parser.getState()).toBe(ThinkingState.partial_close)

      // Second chunk completes the close tag
      const r2 = parser.feed('king>text after')
      expect(r2.reasoning).toBe('')
      expect(r2.text).toBe('text after')
      expect(parser.getState()).toBe(ThinkingState.outside)
    })

    it('should handle partial close tag "</" then "thinking>"', () => {
      const parser = new ThinkingParser()
      const r1 = parser.feed('<thinking>reason</')
      expect(parser.getState()).toBe(ThinkingState.partial_close)

      const r2 = parser.feed('thinking>text')
      expect(r2.reasoning).toBe('')
      expect(r2.text).toBe('text')
      expect(parser.getState()).toBe(ThinkingState.outside)
    })

    it('should handle single char "<" then "thinking>" across chunks', () => {
      const parser = new ThinkingParser()
      const r1 = parser.feed('<')
      expect(r1.text).toBe('')
      expect(parser.getState()).toBe(ThinkingState.partial_open)

      const r2 = parser.feed('thinking>reason</thinking>text')
      expect(r2.reasoning).toBe('reason')
      expect(r2.text).toBe('text')
    })

    it('should detect non-matching partial tag and emit as text', () => {
      const parser = new ThinkingParser()
      const r1 = parser.feed('<tx')
      expect(r1.text).toBe('<tx')
      expect(parser.getState()).toBe(ThinkingState.outside)
    })

    it('should handle partial close that can no longer match — emit buffer as reasoning', () => {
      const parser = new ThinkingParser()
      // Enter inside, buffer partial close
      const r1 = parser.feed('<thinking>reasoning</t')
      expect(parser.getState()).toBe(ThinkingState.partial_close)

      // Next chunk: combined = '</txyz more content'
      // '</txyz more content'.startsWith('</t') → true, but it can never grow into
      // '</thinking>' ('x' ≠ 'h'), so the buffer is emitted as reasoning instead of
      // being stuck in partial_close forever
      const r2 = parser.feed('xyz more content')
      expect(r2.reasoning).toBe('</txyz more content')
      expect(r2.text).toBe('')
      expect(parser.getState()).toBe(ThinkingState.outside)
    })

    it('should handle partial close that is NOT a valid prefix — emit buffer as reasoning', () => {
      const parser = new ThinkingParser()
      // Enter inside, buffer partial close '</' which is a prefix of '</thinking>'
      const r1 = parser.feed('<thinking>reasoning</')
      expect(parser.getState()).toBe(ThinkingState.partial_close)

      // Next chunk: combined = '</abc' — starts with '</' but can never grow into
      // '</thinking>' ('a' ≠ 't'), so the buffered content is emitted as reasoning
      // and the parser returns to outside instead of buffering indefinitely
      const r2 = parser.feed('abc')
      expect(r2.reasoning).toBe('</abc')
      expect(r2.text).toBe('')
      expect(parser.getState()).toBe(ThinkingState.outside)
    })

    it('should handle streaming chunks: reasoning received incrementally', () => {
      const parser = new ThinkingParser()
      const r1 = parser.feed('<thinking>step1')
      expect(r1.reasoning).toBe('step1')
      expect(parser.getState()).toBe(ThinkingState.inside)

      const r2 = parser.feed(' step2')
      expect(r2.reasoning).toBe(' step2')

      const r3 = parser.feed('</thinking>final text')
      expect(r3.reasoning).toBe('')
      expect(r3.text).toBe('final text')
      expect(parser.getState()).toBe(ThinkingState.outside)
    })
  })

  describe('edge cases and error scenarios', () => {
    it('should handle empty feed', () => {
      const parser = new ThinkingParser()
      const result = parser.feed('')
      expect(result.reasoning).toBe('')
      expect(result.text).toBe('')
    })

    it('should handle nested-looking tags (not real nesting)', () => {
      // <thinking> contains <thinking> as content — inner one is just text
      const parser = new ThinkingParser()
      const result = parser.feed('<thinking>outer <thinking> fake</thinking>text after')
      // The first <thinking> opens, then it encounters another <thinking> inside
      // which is treated as reasoning content until </thinking> closes the block
      expect(result.reasoning).toBe('outer <thinking> fake')
      expect(result.text).toBe('text after')
    })

    it('should handle unclosed thinking block at end of stream', () => {
      const parser = new ThinkingParser()
      const result = parser.feed('<thinking>reasoning without close')
      expect(result.reasoning).toBe('reasoning without close')
      expect(parser.getState()).toBe(ThinkingState.inside)
    })

    it('should reset state correctly', () => {
      const parser = new ThinkingParser()
      parser.feed('<thinking>reason')
      expect(parser.getState()).toBe(ThinkingState.inside)
      parser.reset()
      expect(parser.getState()).toBe(ThinkingState.outside)

      // After reset, new feed should start fresh
      const result = parser.feed('normal text')
      expect(result.text).toBe('normal text')
      expect(result.reasoning).toBe('')
    })

    it('should handle <thinking> with no content and immediate close', () => {
      const parser = new ThinkingParser()
      const result = parser.feed('<thinking></thinking>')
      expect(result.reasoning).toBe('')
      expect(result.text).toBe('')
      expect(parser.getState()).toBe(ThinkingState.outside)
    })

    it('should handle text that starts with < but is not <thinking>', () => {
      const parser = new ThinkingParser()
      const result = parser.feed('<other>text</other>')
      expect(result.reasoning).toBe('')
      expect(result.text).toBe('<other>text</other>')
    })

    it('should handle partial open tag "<thi" then non-matching "xyz"', () => {
      const parser = new ThinkingParser()
      const r1 = parser.feed('<thi')
      expect(parser.getState()).toBe(ThinkingState.partial_open)

      // Combined = "<thixyz" — starts with '<' then 't' then 'h' then 'i' then 'x'
      // '<thinking>' = '<t' → char[0]='<' matches, char[1]='t' matches,
      // char[2]='h' matches, char[3]='i' matches, char[4]='x' vs 'n' → mismatch
      // → couldMatch = false → emit as text
      const r2 = parser.feed('xyz')
      expect(r2.text).toBe('<thixyz')
      expect(parser.getState()).toBe(ThinkingState.outside)
    })

    it('should handle <thinking> tag appearing in middle of normal content across chunks', () => {
      const parser = new ThinkingParser()
      const r1 = parser.feed('Hello, ')
      expect(r1.text).toBe('Hello, ')

      const r2 = parser.feed('let me <thin')
      expect(r2.text).toBe('let me ')
      expect(parser.getState()).toBe(ThinkingState.partial_open)

      const r3 = parser.feed('king>think</thinking>result')
      expect(r3.reasoning).toBe('think')
      expect(r3.text).toBe('result')
    })
  })

  describe('matchPartialStartTag and matchPartialEndTag correctness', () => {
    it('should buffer partial start tag at chunk boundary', () => {
      const parser = new ThinkingParser()
      // Text ending with partial <thinking> prefix
      const r = parser.feed('text<thin')
      // 'text' is emitted, '<thin' is buffered
      expect(r.text).toBe('text')
      expect(parser.getState()).toBe(ThinkingState.partial_open)
    })

    it('should buffer partial end tag at chunk boundary while inside thinking', () => {
      const parser = new ThinkingParser()
      const r = parser.feed('<thinking>abc</thi')
      // '</thi' is buffered, 'abc' is reasoning
      expect(r.reasoning).toBe('abc')
      expect(parser.getState()).toBe(ThinkingState.partial_close)
    })
  })
})
