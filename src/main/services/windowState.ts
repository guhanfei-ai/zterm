import { screen, Rectangle } from 'electron'

/** 首开推荐尺寸（非裁剪后最终值） */
const RECOMMENDED_WIDTH = 1280
const RECOMMENDED_HEIGHT = 820

/**
 * 常规工作台最小尺寸：界面布局的舒适下限。
 * 当显示器 workArea 小于此值时，可见性优先于最小尺寸约束，
 * 窗口会进一步缩小以完整落在 workArea 内（小屏可见性兜底策略）。
 */
const MIN_WIDTH = 1024
const MIN_HEIGHT = 680

/** 相对于 workArea 的安全边距（居中后每侧各分一半，保证上下左右间距均匀） */
const WORK_AREA_PADDING_X = 80
const WORK_AREA_PADDING_Y = 60

export interface WindowOptions {
  width: number
  height: number
  minWidth: number
  minHeight: number
  center?: boolean
}

/**
 * 获取主显示器的可用工作区。
 *
 * 统一以主显示器为参考计算窗口尺寸，配合 center: true 确保窗口
 * 始终在主显示器正中居中，避免多显示器环境下因鼠标位置不同
 * 导致窗口尺寸与居中显示器不匹配。
 */
function getCurrentDisplayWorkArea(): Rectangle {
  return screen.getPrimaryDisplay().workArea
}

/**
 * 根据推荐尺寸 + workArea 裁剪计算首开窗口尺寸。
 *
 * 规则：
 * 1. 以推荐尺寸（1280 x 820）为优先
 * 2. 若 workArea - padding 比推荐尺寸更小，则缩小
 * 3. 若 workArea - padding 仍 >= 最小尺寸，则不低于最小尺寸
 * 4. 若 workArea 太小（连最小尺寸都放不下），进一步降级到 workArea - padding
 *    → 保证窗口完整可见，优先于"常规最小尺寸"约束
 */
function getDefaultSize(): { width: number; height: number } {
  const wa = getCurrentDisplayWorkArea()

  const widthCap = Math.min(RECOMMENDED_WIDTH, wa.width - WORK_AREA_PADDING_X)
  const width = widthCap >= MIN_WIDTH ? widthCap : Math.max(1, wa.width - WORK_AREA_PADDING_X)

  const heightCap = Math.min(RECOMMENDED_HEIGHT, wa.height - WORK_AREA_PADDING_Y)
  const height = heightCap >= MIN_HEIGHT ? heightCap : Math.max(1, wa.height - WORK_AREA_PADDING_Y)

  return { width, height }
}

/**
 * 计算当前应使用的窗口选项。
 *
 * 统一策略：每次打开都使用推荐尺寸（按主显示器 workArea 裁剪）
 * 并在屏幕正中居中，不再恢复历史 bounds，确保每次打开的窗口
 * 大小和位置完全一致、上下左右间距和谐。
 *
 * 小屏环境下自动缩小窗口以完整可见，兼容笔记本等小屏设备。
 */
export function calculateWindowOptions(): WindowOptions {
  const size = getDefaultSize()
  return {
    width: size.width,
    height: size.height,
    // 运行时最小尺寸不得超过实际 width/height，避免 Electron 把小屏降级值钳回大尺寸
    minWidth: Math.min(MIN_WIDTH, size.width),
    minHeight: Math.min(MIN_HEIGHT, size.height),
    center: true
  }
}
