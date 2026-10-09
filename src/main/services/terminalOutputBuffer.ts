/** 同时限制输出块数量与字符总量，防止长单行或大块输出绕过行数限制。 */
export class TerminalOutputBuffer {
  private chunks: string[] = []
  private size = 0
  constructor(private readonly maxChars = 1_000_000, private readonly maxChunks = 5000) {}

  push(value: string): void {
    const chunk = value.slice(-this.maxChars)
    this.chunks.push(chunk)
    this.size += chunk.length
    while (this.chunks.length > this.maxChunks || this.size > this.maxChars) {
      const first = this.chunks[0]
      const excess = this.size - this.maxChars
      if (this.chunks.length <= this.maxChunks && excess < first.length) {
        this.chunks[0] = first.slice(excess)
        this.size -= excess
      } else {
        this.size -= this.chunks.shift()!.length
      }
    }
  }

  recent(lines: number): string {
    return this.chunks.join('').split('\n').slice(-Math.min(Math.max(Math.floor(lines), 1), 5000)).join('\n')
  }
  clear(): void { this.chunks = []; this.size = 0 }
}
