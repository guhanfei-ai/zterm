/**
 * ThinkingParser — 跨 chunk <thinking> 标签状态机
 *
 * 从 aiClient.ts 中提取的独立模块，处理流式响应中 <thinking>/</thinking>
 * 标签跨越 chunk 边界的情况，将推理内容与正文内容分离。
 *
 * 状态机有 4 个状态：
 *   outside      — 在 <thinking> 块外部，正文区域
 *   inside       — 在 <thinking> 块内部，推理区域
 *   partial_open — 缓冲了部分 <thinking> 开始标签
 *   partial_close — 缓冲了部分 </thinking> 结束标签
 */

export enum ThinkingState {
  outside = 'outside',
  inside = 'inside',
  partial_open = 'partial_open',
  partial_close = 'partial_close'
}

export interface ParsedChunk {
  reasoning: string
  text: string
}

export class ThinkingParser {
  private state: ThinkingState = ThinkingState.outside
  private thinkingBuffer: string = ''

  /**
   * 解析一段 chunk 内容，通过状态机处理 <thinking> 标签跨 chunk 边界的情况。
   * 返回 { reasoning, text } 分别表示本 chunk 中的推理内容和正文内容。
   */
  feed(content: string): ParsedChunk {
    let reasoning = ''
    let text = ''

    if (this.state === ThinkingState.partial_open) {
      // 拼接上次缓冲的部分标签与新 chunk
      const combined = this.thinkingBuffer + content
      if (combined.startsWith('<thinking>')) {
        // 完整 <thinking> 标签确认，进入 inside 状态
        this.state = ThinkingState.inside
        const rest = combined.slice('<thinking>'.length)
        const endIdx = rest.indexOf('</thinking>')
        if (endIdx !== -1) {
          reasoning += rest.slice(0, endIdx)
          this.state = ThinkingState.outside
          const after = rest.slice(endIdx + '</thinking>'.length)
          if (after) {
            const afterResult = this.feed(after)
            reasoning += afterResult.reasoning
            text += afterResult.text
          }
        } else {
          reasoning += rest
          // 检查末尾是否有部分结束标签
          const partialEnd = this.matchPartialEndTag(rest)
          if (partialEnd) {
            reasoning = reasoning.slice(0, reasoning.length - partialEnd.length)
            this.thinkingBuffer = partialEnd
            this.state = ThinkingState.partial_close
          }
        }
      } else if (
        combined.startsWith('<think') ||
        combined.startsWith('<thin') ||
        combined.startsWith('<thi') ||
        combined.startsWith('<th') ||
        combined.startsWith('<t') ||
        combined.startsWith('<')
      ) {
        // 仍然是部分标签，继续缓冲
        this.thinkingBuffer = combined
        // 但如果拼接后已经不可能匹配（如 "<tx"），直接作为文本输出
        const tag = '<thinking>'
        let couldMatch = true
        for (let i = 0; i < combined.length && i < tag.length; i++) {
          if (combined[i] !== tag[i]) {
            couldMatch = false
            break
          }
        }
        if (!couldMatch) {
          this.state = ThinkingState.outside
          this.thinkingBuffer = ''
          text = combined
        }
        // 否则保持 partial_open，继续缓冲
      } else {
        // 不是 <thinking> 标签开头，之前缓冲的 '<' 等作为文本输出
        this.state = ThinkingState.outside
        this.thinkingBuffer = ''
        text = combined
      }
      return { reasoning, text }
    }

    if (this.state === ThinkingState.partial_close) {
      // 缓冲了部分结束标签，拼接新 chunk 判断
      const combined = this.thinkingBuffer + content
      if (combined.startsWith('</thinking>')) {
        // 确认结束标签，回到 outside
        this.state = ThinkingState.outside
        this.thinkingBuffer = ''
        const after = combined.slice('</thinking>'.length)
        if (after) {
          const afterResult = this.feed(after)
          reasoning += afterResult.reasoning
          text += afterResult.text
        }
      } else if (
        combined.startsWith('</think') ||
        combined.startsWith('</thin') ||
        combined.startsWith('</thi') ||
        combined.startsWith('</th') ||
        combined.startsWith('</t') ||
        combined.startsWith('</') ||
        combined.startsWith('<')
      ) {
        // 仍可能是部分结束标签，继续缓冲
        this.thinkingBuffer = combined
        // 但如果拼接后已经不可能匹配（如 "</thinkingX"），把已缓冲内容作为 reasoning 输出
        const tag = '</thinking>'
        let couldMatch = true
        for (let i = 0; i < combined.length && i < tag.length; i++) {
          if (combined[i] !== tag[i]) {
            couldMatch = false
            break
          }
        }
        if (!couldMatch) {
          this.state = ThinkingState.outside
          this.thinkingBuffer = ''
          reasoning = combined
        }
        // 否则保持 partial_close，继续缓冲
      } else {
        // 不是结束标签，之前缓冲的内容作为 reasoning 输出
        this.state = ThinkingState.outside
        reasoning += this.thinkingBuffer
        this.thinkingBuffer = ''
        const result = this.feed(content)
        reasoning += result.reasoning
        text += result.text
      }
      return { reasoning, text }
    }

    if (this.state === ThinkingState.inside) {
      // 在 thinking 块内部，查找 </thinking> 结束标签
      const endIdx = content.indexOf('</thinking>')
      if (endIdx !== -1) {
        reasoning += content.slice(0, endIdx)
        this.state = ThinkingState.outside
        const after = content.slice(endIdx + '</thinking>'.length)
        if (after) {
          const afterResult = this.feed(after)
          reasoning += afterResult.reasoning
          text += afterResult.text
        }
      } else {
        reasoning += content
        // 检查末尾是否有部分结束标签
        const partialEnd = this.matchPartialEndTag(content)
        if (partialEnd) {
          reasoning = reasoning.slice(0, reasoning.length - partialEnd.length)
          this.thinkingBuffer = partialEnd
          this.state = ThinkingState.partial_close
        }
      }
      return { reasoning, text }
    }

    // this.state === ThinkingState.outside
    // 查找 <thinking> 开始标签
    const startIdx = content.indexOf('<thinking>')
    if (startIdx !== -1) {
      text += content.slice(0, startIdx)
      this.state = ThinkingState.inside
      const rest = content.slice(startIdx + '<thinking>'.length)
      const innerResult = this.feed(rest)
      reasoning += innerResult.reasoning
      text += innerResult.text
    } else {
      text += content
      // 检查末尾是否有部分开始标签
      const partialStart = this.matchPartialStartTag(content)
      if (partialStart) {
        text = text.slice(0, text.length - partialStart.length)
        this.thinkingBuffer = partialStart
        this.state = ThinkingState.partial_open
      }
    }
    return { reasoning, text }
  }

  /**
   * 流结束时冲刷残留缓冲：partial_open 的缓冲属于正文、partial_close 的缓冲属于推理内容，
   * 返回给调用方 emit，避免残余内容被 reset 静默丢弃。
   */
  flush(): ParsedChunk {
    const result: ParsedChunk = {
      reasoning: this.state === ThinkingState.partial_close ? this.thinkingBuffer : '',
      text: this.state === ThinkingState.partial_open ? this.thinkingBuffer : ''
    }
    this.reset()
    return result
  }

  /** 重置状态机（流式会话结束时调用） */
  reset(): void {
    this.state = ThinkingState.outside
    this.thinkingBuffer = ''
  }

  /** 获取当前状态（调试用） */
  getState(): ThinkingState {
    return this.state
  }

  /**
   * 检查字符串末尾是否包含 <thinking> 的部分前缀。
   * 返回匹配到的部分标签字符串，没有则返回空字符串。
   */
  private matchPartialStartTag(s: string): string {
    const tag = '<thinking>'
    for (let len = Math.min(s.length, tag.length - 1); len >= 1; len--) {
      const tail = s.slice(s.length - len)
      if (tag.startsWith(tail)) {
        return tail
      }
    }
    return ''
  }

  /**
   * 检查字符串末尾是否包含 </thinking> 的部分前缀。
   * 返回匹配到的部分标签字符串，没有则返回空字符串。
   */
  private matchPartialEndTag(s: string): string {
    const tag = '</thinking>'
    for (let len = Math.min(s.length, tag.length - 1); len >= 1; len--) {
      const tail = s.slice(s.length - len)
      if (tag.startsWith(tail)) {
        return tail
      }
    }
    return ''
  }
}
