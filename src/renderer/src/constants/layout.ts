/**
 * Layout constants for the three-panel workspace.
 * Extracted from App.vue to avoid hardcoded magic numbers scattered across composables.
 */

export const NAV_RAIL_WIDTH = 56
export const LEFT_PANEL_MIN = 208
export const LEFT_PANEL_DEFAULT = 232
export const LEFT_PANEL_MAX = 420
export const CENTER_MIN_WIDTH = 360
export const RIGHT_PANEL_MIN = 300
export const RIGHT_PANEL_DEFAULT = 360
export const COMPACT_WORKSPACE_WIDTH = 960
export const PANEL_RESIZER_WIDTH = 3

/** 只为实际显示的辅助面板预留空间，收起面板后把宽度交还终端。 */
export function panelWidthLimit(
  viewportWidth: number,
  otherPanelWidth: number,
  otherPanelVisible: boolean
): number {
  return viewportWidth - NAV_RAIL_WIDTH - CENTER_MIN_WIDTH - PANEL_RESIZER_WIDTH
    - (otherPanelVisible ? otherPanelWidth + PANEL_RESIZER_WIDTH : 0)
}
