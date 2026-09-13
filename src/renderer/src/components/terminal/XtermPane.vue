<template>
  <div class="xterm-container" ref="containerRef" :style="{ background: themeStore.currentTheme.xterm.background }">
    <div class="xterm-wrapper" ref="wrapperRef" :class="{ 'xterm-hidden': !isConnected }"></div>
    <!-- 终端内搜索栏（Cmd/Ctrl+F） -->
    <div v-if="searchVisible" class="terminal-search-bar">
      <button
        class="ts-case-btn"
        :class="{ active: searchCaseSensitive }"
        title="区分大小写"
        @click="toggleCaseSensitive"
      >Aa</button>
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        class="ts-input"
        type="text"
        placeholder="在终端中查找..."
        @keydown.enter.prevent="onSearchEnter($event)"
        @keydown.esc.prevent="closeSearch"
      />
      <button class="ts-nav-btn" title="上一个 (Shift+Enter)" @click="findPrev"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 6-6 6 6"/></svg></button>
      <button class="ts-nav-btn" title="下一个 (Enter)" @click="findNext"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 10 6 6 6-6"/></svg></button>
      <button class="ts-close-btn" title="关闭 (Esc)" @click="closeSearch"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
    </div>
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
        <div v-if="tabData.status === 'disconnected'" class="overlay-hint">
          {{ reconnectHint }}
        </div>
        <button
          v-if="tabData.status === 'disconnected' && tabData.reconnectTarget"
          class="btn btn-primary reconnect-button"
          @click="emit('reconnect', props.tabId)"
        >{{ reconnectLabel }}</button>
        <div v-if="tabData.error" class="overlay-error">{{ tabData.error }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { SearchAddon } from 'xterm-addon-search'
import 'xterm/css/xterm.css'
import { useTerminalStore } from '@/stores/terminal'
import { useTerminalPrefsStore } from '@/stores/terminalPrefs'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  tabId: string
}>()

const emit = defineEmits<{
  reconnect: [tabId: string]
}>()

const terminalStore = useTerminalStore()
const themeStore = useThemeStore()
const prefsStore = useTerminalPrefsStore()
const { info: toastInfo, success: toastSuccess, error: toastError } = useToast()
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
  mode: 'direct' as const,
  reconnectTarget: null
}

const tabData = computed(() =>
  terminalStore.getTabById(props.tabId) || fallbackTabData
)

const isConnected = computed(() => tabData.value.status === 'connected')
const reconnectHint = computed(() => {
  if (!tabData.value.reconnectTarget) return '从左侧选择主机并连接'
  return tabData.value.reconnectTarget.kind === 'local'
    ? '此标签可启动新的本地 shell，不会恢复旧会话或目录'
    : '可在原标签中手动重连'
})
const reconnectLabel = computed(() => tabData.value.reconnectTarget?.kind === 'local' ? '启动新的本地 shell' : '重连')

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let searchAddon: SearchAddon | null = null
let unsubscribeData: (() => void) | null = null
let xtermCleanup: (() => void) | null = null
let cursorStyleInterceptor: { dispose: () => void } | null = null

let fitTimer: ReturnType<typeof setTimeout> | null = null

// ---- Terminal search state ----
const searchVisible = ref(false)
const searchQuery = ref('')
const searchCaseSensitive = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

const SEARCH_DECORATIONS = {
  matchBackground: 'rgba(255, 213, 79, 0.35)',
  activeMatchBackground: 'rgba(255, 152, 0, 0.65)',
  matchOverviewRuler: 'rgba(255, 213, 79, 0.5)',
  activeMatchColorOverviewRuler: 'rgba(255, 152, 0, 0.8)'
}

function runSearch(direction: 'next' | 'prev'): void {
  const query = searchQuery.value
  if (!searchAddon || !query) return
  const options = {
    caseSensitive: searchCaseSensitive.value,
    decorations: SEARCH_DECORATIONS
  }
  if (direction === 'next') {
    searchAddon.findNext(query, options)
  } else {
    searchAddon.findPrevious(query, options)
  }
}

function findNext(): void {
  runSearch('next')
}

function findPrev(): void {
  runSearch('prev')
}

function onSearchEnter(event: KeyboardEvent): void {
  if (event.shiftKey) {
    findPrev()
  } else {
    findNext()
  }
}

function toggleCaseSensitive(): void {
  searchCaseSensitive.value = !searchCaseSensitive.value
  if (searchQuery.value) findNext()
}

function openSearch(): void {
  searchVisible.value = true
  void nextTick(() => {
    searchInputRef.value?.focus()
    searchInputRef.value?.select()
  })
}

function closeSearch(): void {
  searchVisible.value = false
  searchAddon?.clearDecorations()
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
  // 关闭搜索后把焦点还给终端，保证可继续输入
  term?.focus()
}

// 输入即高亮（去抖），避免每个字符都触发全 buffer 扫描
watch(searchQuery, (query) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  if (!query) {
    searchAddon?.clearDecorations()
    return
  }
  searchDebounceTimer = setTimeout(() => findNext(), 200)
})

// ---- Terminal output export ----
/** 从 xterm buffer 提取全部滚动回溯文本（右侧去空格，丢弃末尾空行） */
function extractBufferText(): string {
  if (!term) return ''
  const buffer = term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i)
    lines.push(line ? line.translateToString(true) : '')
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

async function exportOutput(): Promise<void> {
  const content = extractBufferText()
  if (!content.trim()) {
    toastInfo('终端当前没有可导出的内容')
    return
  }
  const safeTitle = (tabData.value.title || 'terminal').replace(/[\\/:*?"<>|\s]+/g, '_')
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const header = [
    `# zTerm 终端记录导出`,
    `# 标签: ${tabData.value.title}`,
    `# 主机: ${tabData.value.hostName}`,
    `# 导出时间: ${new Date().toLocaleString()}`,
    ''
  ].join('\n')
  const result = await window.electronAPI.terminal.exportOutput({
    defaultFileName: `zterm-${safeTitle}-${stamp}.log`,
    content: header + content + '\n'
  })
  if (result.success && result.filePath) {
    toastSuccess(`已导出到: ${result.filePath}`)
  } else if (!result.success) {
    toastError(`导出失败: ${result.error || '未知错误'}`)
  }
}

// 暴露给父组件（PanelCenter 工具栏）调用
defineExpose({ openSearch, exportOutput })

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

/** Cmd/Ctrl+F 打开终端搜索（仅本标签为当前活动标签时生效） */
function handleGlobalFindKey(event: KeyboardEvent): void {
  const isFindKey = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey &&
    event.key.toLowerCase() === 'f'
  if (!isFindKey) return
  event.preventDefault()
  openSearch()
}

onMounted(() => {
  if (!wrapperRef.value) return

  term = new Terminal({
    cursorBlink: prefsStore.prefs.cursorBlink,
    cursorStyle: prefsStore.prefs.cursorStyle,
    fontSize: prefsStore.prefs.fontSize,
    fontFamily: prefsStore.prefs.fontFamily,
    theme: themeStore.currentTheme.xterm,
    scrollback: prefsStore.prefs.scrollback,
    allowProposedApi: true
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  searchAddon = new SearchAddon()
  term.loadAddon(searchAddon)
  term.open(wrapperRef.value)

  // 锁定光标样式：拦截 DECSCUSR（CSI Ps SP q / \x1b[ q 系列）
  // 远程程序（vim、shell 等）经常通过这个序列改光标形状；
  // 消费掉该序列后，光标样式始终跟随用户在设置中的偏好。
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

  // Watch terminal preferences — 即时应用字体 / 字号 / 回溯 / 光标设置
  const stopPrefsWatch = watch(
    () => prefsStore.prefs,
    (p) => {
      if (!term) return
      term.options.fontSize = p.fontSize
      term.options.fontFamily = p.fontFamily
      term.options.scrollback = p.scrollback
      term.options.cursorStyle = p.cursorStyle
      term.options.cursorBlink = p.cursorBlink
      // 字号变化会改变行列数，需要重新 fit
      scheduleFit(50)
    },
    { deep: true }
  )

  // Watch tab status changes
  const stopWatch = watch(
    () => tabData.value.status,
    (status) => {
      if (!term) return
      // 重新断言用户偏好的光标样式（DECSCUSR 已被拦截，此处兜底）
      term.options.cursorStyle = prefsStore.prefs.cursorStyle
      term.options.cursorBlink = prefsStore.prefs.cursorBlink
      if (status === 'connected') {
        // Flush any buffered input that accumulated while disconnected
        flushInputBuffer()
        scheduleFit(50)
        scheduleFit(200)
      } else if (status === 'connecting') {
        term.clear()
      } else if (status === 'disconnected') {
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
    stopPrefsWatch()
    if (fitTimer) {
      clearTimeout(fitTimer)
      fitTimer = null
    }
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = null
    }
    window.removeEventListener('keydown', handleGlobalFindKey)
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
    searchAddon = null
  }

  // 仅当本标签可见（活动）时接管 Cmd/Ctrl+F，避免多标签重复响应
  watch(
    () => terminalStore.activeTabId === props.tabId,
    (isActive) => {
      if (isActive) {
        window.addEventListener('keydown', handleGlobalFindKey)
      } else {
        window.removeEventListener('keydown', handleGlobalFindKey)
        if (searchVisible.value) closeSearch()
      }
    },
    { immediate: true }
  )
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
  padding: 16px 12px 8px 18px;
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

/* ---- 终端搜索栏 ---- */
.terminal-search-bar {
  position: absolute;
  top: 12px;
  right: 14px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  max-width: calc(100% - 28px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
}

.ts-input {
  width: 180px;
  min-width: 0;
  padding: 3px 8px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg);
  border: 1px solid var(--divider);
  border-radius: 4px;
  outline: none;
}

.ts-input:focus {
  border-color: var(--accent, #4a9eff);
}

.ts-case-btn,
.ts-nav-btn,
.ts-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  height: 28px;
  padding: 2px 7px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 4px;
}

.ts-case-btn:hover,
.ts-nav-btn:hover,
.ts-close-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover, rgba(128, 128, 128, 0.15));
}

.ts-case-btn.active {
  color: var(--accent, #4a9eff);
  background: rgba(74, 158, 255, 0.15);
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
  gap: 10px;
  padding: 24px;
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
  font-size: 19px;
  font-weight: 500;
  color: var(--text-secondary);
}

.overlay-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.7;
  margin-top: 2px;
}

.reconnect-button {
  margin-top: 8px;
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
