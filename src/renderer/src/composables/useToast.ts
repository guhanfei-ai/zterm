import { ref } from 'vue'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

// Singleton toast state shared across all components（与 useConfirm 同一套单例模式）
const toasts = ref<ToastItem[]>([])
let nextId = 1

// 同时最多展示条数，超出丢弃最旧的通知
const MAX_VISIBLE = 5

function dismiss(id: number): void {
  const idx = toasts.value.findIndex((t) => t.id === id)
  if (idx !== -1) toasts.value.splice(idx, 1)
}

export function useToast() {
  function show(kind: ToastKind, message: string, duration: number): number {
    const id = nextId++
    toasts.value.push({ id, kind, message })
    while (toasts.value.length > MAX_VISIBLE) toasts.value.shift()
    setTimeout(() => dismiss(id), duration)
    return id
  }

  return {
    toasts,
    dismiss,
    info: (message: string, duration = 4000) => show('info', message, duration),
    success: (message: string, duration = 4000) => show('success', message, duration),
    // 错误信息通常更长（含原因与路径），默认多留 2 秒
    error: (message: string, duration = 6000) => show('error', message, duration)
  }
}
