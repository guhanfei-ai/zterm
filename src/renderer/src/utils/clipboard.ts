/** 原样写入文本；Clipboard API 不可用时使用兼容复制，并检查真实返回值。 */
export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // 部分运行环境拒绝 Clipboard API，继续尝试用户点击触发的兼容复制。
  }
  const activeElement = document.activeElement as HTMLElement | null
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.cssText = 'position:fixed;left:-9999px;top:0;'
  document.body.appendChild(textarea)
  try {
    textarea.select()
    if (!document.execCommand('copy')) throw new Error('无法写入剪贴板，请重试')
  } finally {
    textarea.remove()
    activeElement?.focus({ preventScroll: true })
  }
}
