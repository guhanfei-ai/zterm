import { ref } from 'vue'

interface ConfirmState {
  show: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
}

// Singleton confirm state shared across all components
const confirmState = ref<ConfirmState>({
  show: false,
  title: '',
  message: '',
  onConfirm: () => {},
  onCancel: () => {}
})

// 当前待答确认框的 resolve；新 show() 覆盖前需先 settle 旧 Promise，避免调用方永远挂起
let pendingResolve: ((value: boolean) => void) | null = null

export function useConfirm() {
  function show(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      // 已有待答确认框被覆盖：按取消语义 resolve 旧 Promise
      if (pendingResolve) {
        pendingResolve(false)
        pendingResolve = null
      }
      pendingResolve = resolve
      const settle = (value: boolean): void => {
        pendingResolve = null
        confirmState.value = { show: false, title: '', message: '', onConfirm: () => {}, onCancel: () => {} }
        resolve(value)
      }
      confirmState.value = {
        show: true,
        title,
        message,
        onConfirm: () => settle(true),
        onCancel: () => settle(false)
      }
    })
  }

  return {
    confirmState,
    // Shortcut: confirm("删除主机", "确定要删除主机 \"xxx\" 吗？")
    confirm: show
  }
}
