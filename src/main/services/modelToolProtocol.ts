/** 识别被模型当作正文返回的 DSML 调用；代码示例保留，不把文本转换成执行指令。 */
export function hasTextToolCall(text: string): boolean {
  const prose: string[] = []
  let fence: string | null = null
  for (const line of text.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      continue
    }
    if (marker) {
      fence = marker[1]
      continue
    }
    prose.push(line)
  }
  const content = prose.join('\n').replace(/(`+)[^\n]*?\1/g, '')
  return /<\s*[|｜]\s*DSML\s*[|｜]\s*(?:calls|tool_calls)\s*>[\s\S]*?<\s*[|｜]\s*DSML\s*[|｜]\s*invoke\s+name\s*=/i.test(content)
}
