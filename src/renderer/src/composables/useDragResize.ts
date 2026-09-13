import { ref, onMounted, onUnmounted, watch, type Ref } from 'vue'
import {
  LEFT_PANEL_MIN,
  LEFT_PANEL_DEFAULT,
  LEFT_PANEL_MAX,
  RIGHT_PANEL_MIN,
  RIGHT_PANEL_DEFAULT,
  panelWidthLimit
} from '@/constants/layout'

/**
 * Composable that manages resizable panel widths (left + right) with drag
 * and window-resize clamping. Panel widths always start at defaults on
 * every app launch; drag adjustments are session-only and not persisted.
 */
export function useDragResize(visibility: { left: Readonly<Ref<boolean>>; right: Readonly<Ref<boolean>> }) {

  const leftPanelWidth = ref(LEFT_PANEL_DEFAULT)
  const rightPanelWidth = ref(RIGHT_PANEL_DEFAULT)
  const isLeftDragging = ref(false)
  const isDragging = ref(false)

  // ---- Clamping helpers ----
  function getMaxLeftWidth(): number {
    const available = panelWidthLimit(window.innerWidth, rightPanelWidth.value, visibility.right.value)
    return Math.max(Math.min(available, LEFT_PANEL_MAX), LEFT_PANEL_MIN)
  }

  function clampLeftWidth(w: number): number {
    return Math.min(Math.max(w, LEFT_PANEL_MIN), getMaxLeftWidth())
  }

  function getMaxRightWidth(): number {
    const available = panelWidthLimit(window.innerWidth, leftPanelWidth.value, visibility.left.value)
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

  watch([visibility.left, visibility.right], onWindowResize)

  function resizeLeftBy(delta: number): void {
    leftPanelWidth.value = clampLeftWidth(leftPanelWidth.value + delta)
  }

  function resizeRightBy(delta: number): void {
    rightPanelWidth.value = clampWidth(rightPanelWidth.value + delta)
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
    onWindowResize()
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
    onDragStart,
    resizeLeftBy,
    resizeRightBy
  }
}
