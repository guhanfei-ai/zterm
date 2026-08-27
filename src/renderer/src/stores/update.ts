import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'no-update'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'

export const useUpdateStore = defineStore('update', () => {
  const state = ref<UpdateState>('idle')
  const currentVersion = ref('')
  const latestVersion = ref('')
  const notes = ref('')
  const downloadUrl = ref('')
  const sha256 = ref('')
  const downloadedFilePath = ref('')
  const downloadPercent = ref(0)
  const error = ref('')

  // 内存级去重：本次运行已关闭/忽略的版本号
  const dismissedVersion = ref('')

  // 浮窗显示控制：独立于状态，控制 toast 是否可见
  // 用于 downloaded 状态下，用户选择"稍后"后保持浮窗隐藏
  const toastVisible = ref(false)

  const hasUpdate = computed(() =>
    state.value === 'available' || state.value === 'downloaded'
  )

  let removeProgressListener: (() => void) | null = null

  async function loadDismissedVersion(): Promise<void> {
    try {
      const saved = await window.electronAPI.preferences.get('updateDismissedVersion')
      dismissedVersion.value = typeof saved === 'string' ? saved : ''
    } catch {
      dismissedVersion.value = ''
    }
  }

  async function fetchCurrentVersion(): Promise<void> {
    try {
      currentVersion.value = await window.electronAPI.update.getVersion()
    } catch {
      currentVersion.value = ''
    }
  }

  // 静默检查：用于启动自动检测和定时轮询，失败不报错、不打扰用户
  async function silentCheck(): Promise<void> {
    if (
      state.value === 'checking' ||
      state.value === 'downloading' ||
      state.value === 'downloaded' ||
      state.value === 'installing'
    ) {
      return
    }
    state.value = 'checking'
    error.value = ''
    try {
      const result = await window.electronAPI.update.check()
      if (!result.success || !result.data) {
        state.value = 'idle'
        return
      }
      if (result.data.hasUpdate) {
        latestVersion.value = result.data.latestVersion
        notes.value = result.data.notes
        downloadUrl.value = result.data.downloadUrl
        sha256.value = result.data.sha256
        state.value = 'available'
      } else {
        state.value = 'no-update'
      }
    } catch {
      state.value = 'idle'
    }
  }

  // 手动检查：用于手动面板，失败时暴露错误信息
  async function manualCheck(): Promise<void> {
    if (
      state.value === 'checking' ||
      state.value === 'downloading' ||
      state.value === 'downloaded' ||
      state.value === 'installing'
    ) {
      return
    }
    state.value = 'checking'
    error.value = ''
    try {
      const result = await window.electronAPI.update.check()
      if (!result.success) {
        error.value = result.error || '检查更新失败'
        state.value = 'idle'
        return
      }
      if (result.data?.hasUpdate) {
        latestVersion.value = result.data.latestVersion
        notes.value = result.data.notes
        downloadUrl.value = result.data.downloadUrl
        sha256.value = result.data.sha256
        state.value = 'available'
      } else {
        state.value = 'no-update'
      }
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : '检查更新失败'
      state.value = 'idle'
    }
  }

  async function startDownload(): Promise<void> {
    // P2-3：dismiss 后允许在 downloading 中重新发起（同进程内幂等）。
    // 之前会拦掉，导致用户 dismiss 浮窗后无法恢复。
    // idle/no-update 下 downloadUrl 可能为空，不允许进入下载。
    if (state.value !== 'available' && state.value !== 'downloading') {
      return
    }
    state.value = 'downloading'
    toastVisible.value = true
    downloadPercent.value = 0
    error.value = ''

    if (removeProgressListener) {
      removeProgressListener()
      removeProgressListener = null
    }

    removeProgressListener = window.electronAPI.update.onDownloadProgress(
      (progress) => {
        if (progress.total > 0) {
          downloadPercent.value = Math.round(
            (progress.downloaded / progress.total) * 100
          )
        }
      }
    )

    try {
      const result = await window.electronAPI.update.download(
        downloadUrl.value,
        sha256.value
      )
      if (removeProgressListener) {
        removeProgressListener()
        removeProgressListener = null
      }

      if (result.success && result.filePath) {
        downloadedFilePath.value = result.filePath
        state.value = 'downloaded'
        toastVisible.value = true
        return
      }

      error.value = result.error || '下载失败'
      // 下载失败回到 available：清除对本版本的 dismiss 抑制，确保错误提示入口可见
      if (dismissedVersion.value && dismissedVersion.value === latestVersion.value) {
        dismissedVersion.value = ''
        void window.electronAPI.preferences.set('updateDismissedVersion', '')
      }
      state.value = 'available'
    } catch (err: unknown) {
      if (removeProgressListener) {
        removeProgressListener()
        removeProgressListener = null
      }
      error.value = err instanceof Error ? err.message : '下载失败'
      if (dismissedVersion.value && dismissedVersion.value === latestVersion.value) {
        dismissedVersion.value = ''
        void window.electronAPI.preferences.set('updateDismissedVersion', '')
      }
      state.value = 'available'
    }
  }

  async function startInstall(): Promise<void> {
    if (state.value !== 'downloaded' || !downloadedFilePath.value) {
      return
    }
    state.value = 'installing'
    error.value = ''
    try {
      const result = await window.electronAPI.update.install(
        downloadedFilePath.value
      )
      if (!result.success) {
        error.value = result.message || '安装失败'
        state.value = 'downloaded'
      }
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : '安装失败'
      state.value = 'downloaded'
    }
  }

  function dismiss(version: string): void {
    dismissedVersion.value = version
    void window.electronAPI.preferences.set('updateDismissedVersion', version)
    // downloading/downloaded/installing 状态关闭浮窗，但不中断下载/丢失安装能力
    if (
      state.value === 'downloading' ||
      state.value === 'downloaded' ||
      state.value === 'installing'
    ) {
      toastVisible.value = false
    }
  }

  function showToast(): void {
    toastVisible.value = true
  }

  function reset(): void {
    if (
      state.value === 'checking' ||
      state.value === 'downloading' ||
      state.value === 'downloaded' ||
      state.value === 'installing'
    ) {
      return
    }
    state.value = 'idle'
    error.value = ''
  }

  return {
    state,
    currentVersion,
    latestVersion,
    notes,
    downloadUrl,
    sha256,
    downloadedFilePath,
    downloadPercent,
    error,
    dismissedVersion,
    toastVisible,
    hasUpdate,
    loadDismissedVersion,
    fetchCurrentVersion,
    silentCheck,
    manualCheck,
    startDownload,
    startInstall,
    dismiss,
    showToast,
    reset
  }
})
