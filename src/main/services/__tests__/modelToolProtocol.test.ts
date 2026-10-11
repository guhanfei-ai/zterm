import { describe, expect, it } from 'vitest'
import { hasTextToolCall } from '../modelToolProtocol'

const invocation = '<｜DSML｜calls>\n<｜DSML｜invoke name="read_bound_processes">\n</｜DSML｜invoke>\n</｜DSML｜calls>'

describe('模型正文中的工具调用协议', () => {
  it('识别截图中的 DSML 调用和带空格的 ASCII 管线变体', () => {
    expect(hasTextToolCall('看看进程。\n' + invocation)).toBe(true)
    expect(hasTextToolCall('< | DSML | tool_calls>\n< | DSML | invoke name="read_bound_terminal_context">')).toBe(true)
  })

  it.each(['```xml\n' + invocation + '\n```', '~~~xml\n' + invocation + '\n~~~~', '```xml\n' + invocation])(
    '代码示例或尚未闭合的代码块不冒充执行调用', text => {
      expect(hasTextToolCall(text)).toBe(false)
    }
  )

  it('保留普通说明、行内代码以及转义标签', () => {
    expect(hasTextToolCall('这是什么格式？')).toBe(false)
    expect(hasTextToolCall('这是 `<｜DSML｜calls>` 和 `<｜DSML｜invoke name="x">` 的示例。')).toBe(false)
    expect(hasTextToolCall('&lt;｜DSML｜calls&gt;\n&lt;｜DSML｜invoke name="x"&gt;')).toBe(false)
  })
})
