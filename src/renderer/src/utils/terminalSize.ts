/**
 * 根据容器实际尺寸估算终端 cols/rows。
 * Menlo 13px 在 macOS 上的实测字符尺寸（含间距）。
 */
export function estimateTerminalSize(
  container: HTMLElement | null
): { cols: number; rows: number } {
  const charWidth = 7.8
  const lineHeight = 15.6
  const cols = container ? Math.floor(container.clientWidth / charWidth) : 80
  const rows = container ? Math.floor(container.clientHeight / lineHeight) : 24
  return { cols, rows }
}
