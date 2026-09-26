import { describe, expect, it } from 'vitest'
import { CENTER_MIN_WIDTH, NAV_RAIL_WIDTH, PANEL_RESIZER_WIDTH, panelWidthLimit } from '../../constants/layout'

describe('工作台面板空间分配', () => {
  it('收起另一面板后释放面板及分隔条的完整宽度', () => {
    const expanded = panelWidthLimit(1280, 360, true)
    const collapsed = panelWidthLimit(1280, 360, false)
    expect(collapsed - expanded).toBe(360 + PANEL_RESIZER_WIDTH)
  })

  it('两侧显示时仍为终端保留最小可用宽度', () => {
    const limit = panelWidthLimit(1024, 232, true)
    expect(1024 - NAV_RAIL_WIDTH - 232 - limit - 2 * PANEL_RESIZER_WIDTH).toBe(CENTER_MIN_WIDTH)
  })
})
