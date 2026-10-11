import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard } from '../clipboard'

const markdown = '\n## 系统底子\n\n| 服务 | 端口 |\n| --- | --- |\n| nginx | 80 |\n\n```bash\nprintf "<ok>"\n```\n\n- **原文** `code`\n'

describe('Markdown 原文复制', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('原样复制标题、表格、代码块和首尾换行', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await copyTextToClipboard(markdown)
    expect(writeText).toHaveBeenCalledExactlyOnceWith(markdown)
  })

  function fallback(result: boolean) {
    const textarea = { value: '', readOnly: false, style: { cssText: '' }, select: vi.fn(), remove: vi.fn() }
    const focus = vi.fn()
    const execCommand = vi.fn().mockReturnValue(result)
    vi.stubGlobal('document', { activeElement: { focus }, createElement: vi.fn(() => textarea), body: { appendChild: vi.fn() }, execCommand })
    return { textarea, execCommand, focus }
  }

  it('API 不可用时兼容复制仍使用完整原文，随后恢复焦点', async () => {
    vi.stubGlobal('navigator', {})
    const { textarea, execCommand, focus } = fallback(true)
    await copyTextToClipboard(markdown)
    expect(textarea.value).toBe(markdown)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(textarea.remove).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('API 被拒绝后兼容复制成功', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const { textarea } = fallback(true)
    await copyTextToClipboard(markdown)
    expect(textarea.value).toBe(markdown)
  })

  it('复制被拒绝时报告失败，清理临时元素并恢复焦点', async () => {
    vi.stubGlobal('navigator', {})
    const { textarea, focus } = fallback(false)
    await expect(copyTextToClipboard(markdown)).rejects.toThrow('无法写入剪贴板')
    expect(textarea.remove).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
  })
})
