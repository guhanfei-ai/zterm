import { ref, onMounted, onUnmounted } from 'vue'
import { useHostsStore } from '@/stores/hosts'
import {
  NAV_RAIL_WIDTH,
  LEFT_PANEL_MIN,
  LEFT_PANEL_DEFAULT,
  LEFT_PANEL_MAX,
  CENTER_MIN_WIDTH,
  RIGHT_PANEL_MIN,
  RIGHT_PANEL_DEFAULT
} from '@/constants/layout'

/**
 * Composable that manages resizable panel widths (left + right) with drag
 * and window-resize clamping. Panel widths always start at defaults on
 * every app launch; drag adjustments are session-only and not persisted.
 */
export function useDragResize() {
  const hostsStore = useHostsStore()

  const leftPanelWidth = ref(LEFT_PANEL_DEFAULT)
  const rightPanelWidth = ref(RIGHT_PANEL_DEFAULT)
  const isLeftDragging = ref(false)
  const isDragging = ref(false)

  // ---- Clamping helpers ----
  function getMaxLeftWidth(): number {
    const available = window.innerWidth - NAV_RAIL_WIDTH - CENTER_MIN_WIDTH - rightPanelWidth.value - 5
    return Math.max(Math.min(available, LEFT_PANEL_MAX), LEFT_PANEL_MIN)
  }

  function clampLeftWidth(w: number): number {
    return Math.min(Math.max(w, LEFT_PANEL_MIN), getMaxLeftWidth())
  }

  function getMaxRightWidth(): number {
    const leftWidth = hostsStore.activeMode === 'local' ? NAV_RAIL_WIDTH : (NAV_RAIL_WIDTH + leftPanelWidth.value)
    const available = window.innerWidth - leftWidth - CENTER_MIN_WIDTH - 5
    return Math.max(available, RIGHT_PANEL_MIN)
  }

  function clampWidth(w: number): number {
    return Math.min(Math.max(w, RIGHT_PANEL_MIN), getMaxRightWidth())
  }

  // ---- Window resize handler ----
  function onWindowResize(): void {
    leftPanelWidth.value = clampLeftWidth(leftPanelWidth.value)
    rightPanelWidth.value = clampWidth(rightPanelWidth.value)
  }

  // ---- Drag handlers ----
  let activeLeftMouseMove: ((e: MouseEvent) => void) | null = null
  let activeLeftMouseUp: (() => void) | null = null
  let activeRightMouseMove: ((e: MouseEvent) => void) | null = null
  let activeRightMouseUp: (() => void) | null = null

  function onLeftDragStart(e: MouseEvent): void {
    e.preventDefault()
    isLeftDragging.value = true
    const startX = e.clientX
    const startWidth = leftPanelWidth.value

    function onMouseMove(ev: MouseEvent): void {
      const delta = ev.clientX - startX
      leftPanelWidth.value = clampLeftWidth(startWidth + delta)
    }

    function onMouseUp(): void {
      isLeftDragging.value = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      activeLeftMouseMove = null
      activeLeftMouseUp = null
    }

    activeLeftMouseMove = onMouseMove
    activeLeftMouseUp = onMouseUp
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  function onDragStart(e: MouseEvent): void {
    e.preventDefault()
    isDragging.value = true
    const startX = e.clientX
    const startWidth = rightPanelWidth.value

    function onMouseMove(ev: MouseEvent): void {
      const delta = startX - ev.clientX
      rightPanelWidth.value = clampWidth(startWidth + delta)
    }

    function onMouseUp(): void {
      isDragging.value = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      activeRightMouseMove = null
      activeRightMouseUp = null
    }

    activeRightMouseMove = onMouseMove
    activeRightMouseUp = onMouseUp
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  // ---- Mount: register window resize listener ----
  onMounted(() => {
    window.addEventListener('resize', onWindowResize)
  })

  // ---- Cleanup on unmount ----
  onUnmounted(() => {
    if (activeLeftMouseMove) document.removeEventListener('mousemove', activeLeftMouseMove)
    if (activeLeftMouseUp) document.removeEventListener('mouseup', activeLeftMouseUp)
    if (activeRightMouseMove) document.removeEventListener('mousemove', activeRightMouseMove)
    if (activeRightMouseUp) document.removeEventListener('mouseup', activeRightMouseUp)
    window.removeEventListener('resize', onWindowResize)
  })

  return {
    leftPanelWidth,
    rightPanelWidth,
    isLeftDragging,
    isDragging,
    onLeftDragStart,
    onDragStart
  }
}
