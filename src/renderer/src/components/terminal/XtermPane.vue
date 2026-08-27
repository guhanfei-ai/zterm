<template>
  <div class="xterm-container" ref="containerRef">
    <div class="xterm-wrapper" ref="wrapperRef" :class="{ 'xterm-hidden': !isConnected }"></div>
    <!-- State overlay: disconnected / connecting -->
    <div v-if="!isConnected" class="terminal-overlay">
      <div class="overlay-content">
        <div class="overlay-icon">
          <svg v-if="tabData.status === 'connecting'" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="spin-icon">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          <svg v-else width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.35">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </div>
        <div class="overlay-title">
          {{ tabData.status === 'connecting' ? '正在连接...' : '终端未连接' }}
        </div>
        <div v-if="tabData.status === 'disconnected'" class="overlay-hint">从左侧选择主机并连接</div>
        <div v-if="tabData.error" class="overlay-error">{{ tabData.error }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { useTerminalStore } from '@/stores/terminal'
import { useThemeStore } from '@/stores/theme'

const props = defineProps<{
  tabId: string
}>()

const terminalStore = useTerminalStore()
const themeStore = useThemeStore()
const wrapperRef = ref<HTMLDivElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const fallbackTabData = {
  id: props.tabId,
  title: '终端',
  status: 'disconnected' as const,
  hostId: null,
  hostName: '未连接',
  error: null,
  recentOutput: '',
  generation: 0,
  mode: 'direct' as const
}

const tabData = computed(() =>
  terminalStore.getTabById(props.tabId) || fallbackTabData
)

const isConnected = computed(() => tabData.value.status === 'connected')

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let unsubscribeData: (() => void) | null = null
let xtermCleanup: (() => void) | null = null
let cursorStyleInterceptor: { dispose: () => void } | null = null

let fitTimer: ReturnType<typeof setTimeout> | null = null

// ---- Input ring buffer for offline buffering ----
const MAX_BUFFER_SIZE = 64 * 1024 // 64KB character limit
let _inputBuffer: string[] = []
let _bufferSize: number = 0

/** Flush all buffered input data to the terminal in one write call */
function flushInputBuffer(): void {
  if (_inputBuffer.length === 0) return
  const merged = _inputBuffer.join('')
  _inputBuffer = []
  _bufferSize = 0
  window.electronAPI.terminal.write(props.tabId, merged)
}

function scheduleFit(delay = 0): void {
  if (fitTimer) clearTimeout(fitTimer)
  fitTimer = setTimeout(() => {
    if (fitAddon) {
      try {
        fitAddon.fit()
      } catch {
        // ignore fit errors
      }
    }
    fitTimer = null
  }, delay)
}

onMounted(() => {
  if (!wrapperRef.value) return

  term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: themeStore.currentTheme.xterm,
    scrollback: 10000,
    allowProposedApi: true
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(wrapperRef.value)

  // 锁定光标样式：拦截 DECSCUSR（CSI Ps SP q / \x1b[ q 系列）
  // 远程程序（vim、shell 等）经常通过这个序列把方块改成竖线。
  // 注册一个返回 true 的 handler 把它消费掉，默认 handler 就不会再修改 cursorStyle。
  try {
    cursorStyleInterceptor = term.parser.registerCsiHandler(
      { intermediates: ' ', final: 'q' },
      () => true
    )
  } catch {
    // 极个别 xterm 版本 / API 变化时忽略，不阻塞终端使用
    cursorStyleInterceptor = null
  }

  scheduleFit(100)

  // Handle user input — buffer when disconnected, write when connected
  term.onData((data) => {
    if (tabData.value.status === 'connected') {
      // Connected: flush any buffered data first, then write live data
      flushInputBuffer()
      window.electronAPI.terminal.write(props.tabId, data)
    } else {
      // Not connected: buffer data (drop oldest if over capacity)
      const dataLen = data.length
      while (_bufferSize + dataLen > MAX_BUFFER_SIZE && _inputBuffer.length > 0) {
        const dropped = _inputBuffer.shift()!
        _bufferSize -= dropped.length
      }
      if (_bufferSize + dataLen <= MAX_BUFFER_SIZE) {
        _inputBuffer.push(data)
        _bufferSize += dataLen
      }
      // If data alone exceeds MAX_BUFFER_SIZE, it's simply dropped
    }
  })

  // Handle resize — send with tabId
  term.onResize(({ cols, rows }) => {
    if (tabData.value.status === 'connected') {
      window.electronAPI.terminal.resize(props.tabId, cols, rows)
    }
  })

  // Listen for terminal data — filter by tabId
  unsubscribeData = window.electronAPI.terminal.onData((payload) => {
    if (payload.tabId === props.tabId && term) {
      term.write(payload.data)
    }
  })

  // Watch tab status changes
  const stopWatch = watch(
    () => tabData.value.status,
    (status) => {
      if (!term) return
      // 锁死方块：任何状态下都把 cursorStyle 强制为 block
      term.options.cursorStyle = 'block'
      if (status === 'connected') {
        term.options.cursorBlink = true
        // Flush any buffered input that accumulated while disconnected
        flushInputBuffer()
        scheduleFit(50)
        scheduleFit(200)
      } else if (status === 'connecting') {
        term.options.cursorBlink = true
        term.clear()
      } else if (status === 'disconnected') {
        term.options.cursorBlink = true
        term.writeln('\r\n\x1b[33m--- 连接已断开 ---\x1b[0m\r\n')
      }
    }
  )

  // Watch when this tab becomes active to re-fit
  const stopActiveWatch = watch(
    () => terminalStore.activeTabId === props.tabId,
    (isActive) => {
      if (isActive) {
        // 使用 requestAnimationFrame 确保布局完成后再 fit
        requestAnimationFrame(() => {
          scheduleFit(0)
        })
        scheduleFit(100) // 保留兜底
      }
    }
  )

  // Watch current theme — 切换终端主题
  const stopThemeWatch = watch(
    () => themeStore.currentTheme,
    (theme) => {
      if (term) {
        term.options.theme = theme.xterm
      }
    }
  )

  // Resize observer
  const resizeObserver = new ResizeObserver(() => {
    scheduleFit(20)
  })
  if (containerRef.value) {
    resizeObserver.observe(containerRef.value)
  }

  xtermCleanup = () => {
    stopWatch()
    stopActiveWatch()
    stopThemeWatch()
    if (fitTimer) {
      clearTimeout(fitTimer)
      fitTimer = null
    }
    if (unsubscribeData) {
      unsubscribeData()
      unsubscribeData = null
    }
    if (cursorStyleInterceptor) {
      try { cursorStyleInterceptor.dispose() } catch { /* ignore */ }
      cursorStyleInterceptor = null
    }
    resizeObserver.disconnect()
    if (term) {
      term.dispose()
      term = null
    }
    fitAddon = null
  }
})

onUnmounted(() => {
  if (xtermCleanup) {
    xtermCleanup()
    xtermCleanup = null
  }
})
</script>

<style scoped>
.xterm-container {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.xterm-wrapper {
  width: 100%;
  height: 100%;
  padding-left: 8px;
}

.xterm-wrapper :deep(.xterm) {
  padding: 0;
  height: 100%;
}

.xterm-wrapper :deep(.xterm-viewport) {
  height: 100% !important;
}

.xterm-wrapper :deep(.xterm-screen) {
  height: 100% !important;
}

.xterm-hidden {
  opacity: 0;
  pointer-events: none;
}

.terminal-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  z-index: 10;
}

.overlay-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
}

.overlay-icon {
  margin-bottom: 8px;
  color: var(--text-tertiary);
}

.spin-icon {
  animation: spin 1.2s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.overlay-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.overlay-hint {
  font-size: 12px;
  color: var(--text-disabled);
  margin-top: 2px;
}

.overlay-error {
  font-size: 12px;
  color: var(--danger);
  margin-top: 6px;
  padding: 4px 10px;
  background: var(--danger-muted);
  border-radius: 4px;
  max-width: 280px;
}
</style>
