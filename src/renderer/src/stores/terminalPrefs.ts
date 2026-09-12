import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type TerminalCursorStyle = 'block' | 'bar' | 'underline'

export interface TerminalPrefs {
  /** 字号（px），范围 10–24 */
  fontSize: number
  /** 等宽字体栈（取自 TERMINAL_FONT_OPTIONS） */
  fontFamily: string
  /** 滚动回溯行数 */
  scrollback: number
  /** 光标样式；配合 DECSCUSR 拦截器锁定，远程程序（vim 等）无法更改 */
  cursorStyle: TerminalCursorStyle
  /** 光标闪烁 */
  cursorBlink: boolean
}

export const TERMINAL_FONT_OPTIONS: { id: string; label: string; stack: string }[] = [
  { id: 'menlo', label: 'Menlo / Monaco（macOS 默认）', stack: 'Menlo, Monaco, "Courier New", monospace' },
  { id: 'consolas', label: 'Consolas（Windows）', stack: 'Consolas, "Courier New", monospace' },
  { id: 'dejavu', label: 'DejaVu Sans Mono（Linux）', stack: '"DejaVu Sans Mono", "Liberation Mono", monospace' },
  { id: 'system', label: '系统等宽字体', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  { id: 'courier', label: 'Courier New', stack: '"Courier New", Courier, monospace' }
]

export const TERMINAL_SCROLLBACK_OPTIONS = [1000, 5000, 10000, 50000, 100000]

export const TERMINAL_PREFS_DEFAULTS: TerminalPrefs = {
  fontSize: 13,
  fontFamily: TERMINAL_FONT_OPTIONS[0].stack,
  scrollback: 10000,
  cursorStyle: 'block',
  cursorBlink: true
}

const STORAGE_KEY = 'zterm_terminal_prefs'
const PREF_KEY = 'terminalPrefs'

const CURSOR_STYLES: TerminalCursorStyle[] = ['block', 'bar', 'underline']
const FONT_STACKS = TERMINAL_FONT_OPTIONS.map((o) => o.stack)

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? Math.round(value) : NaN
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 容错解析：任何字段非法时回退默认值，不抛错 */
function sanitize(raw: unknown): TerminalPrefs {
  if (typeof raw !== 'object' || raw === null) return { ...TERMINAL_PREFS_DEFAULTS }
  const r = raw as Record<string, unknown>
  return {
    fontSize: clampInt(r.fontSize, 10, 24, TERMINAL_PREFS_DEFAULTS.fontSize),
    fontFamily: FONT_STACKS.includes(r.fontFamily as string)
      ? (r.fontFamily as string)
      : TERMINAL_PREFS_DEFAULTS.fontFamily,
    scrollback: clampInt(r.scrollback, 100, 500000, TERMINAL_PREFS_DEFAULTS.scrollback),
    cursorStyle: CURSOR_STYLES.includes(r.cursorStyle as TerminalCursorStyle)
      ? (r.cursorStyle as TerminalCursorStyle)
      : TERMINAL_PREFS_DEFAULTS.cursorStyle,
    cursorBlink: typeof r.cursorBlink === 'boolean' ? r.cursorBlink : TERMINAL_PREFS_DEFAULTS.cursorBlink
  }
}

/** 从 localStorage 同步读取；found 表示是否存在可解析的已存配置（含内容非法的情形） */
function readStoredSync(): { prefs: TerminalPrefs; found: boolean } {
  if (typeof localStorage === 'undefined') return { prefs: { ...TERMINAL_PREFS_DEFAULTS }, found: false }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { prefs: { ...TERMINAL_PREFS_DEFAULTS }, found: false }
    return { prefs: sanitize(JSON.parse(raw)), found: true }
  } catch {
    return { prefs: { ...TERMINAL_PREFS_DEFAULTS }, found: false }
  }
}

export const useTerminalPrefsStore = defineStore('terminalPrefs', () => {
  // localStorage 同步读保证首帧即正确；localStorage 无有效配置时异步从 preferences 恢复
  const stored = readStoredSync()
  const prefs = ref<TerminalPrefs>(stored.prefs)
  const userModified = ref(false)
  let recoverStarted = false

  /** localStorage 缺失或损坏时，从主进程 preferences 恢复上次的偏好备份 */
  async function recoverFromPreferences(): Promise<void> {
    if (recoverStarted || stored.found) return
    if (typeof window === 'undefined' || !window.electronAPI) return
    recoverStarted = true
    try {
      const raw = await window.electronAPI.preferences.get(PREF_KEY)
      // 等待 IPC 期间用户已修改偏好：保留用户的新值，丢弃恢复结果
      if (userModified.value) return
      prefs.value = sanitize(raw)
    } catch {
      // 读取失败不阻塞终端使用，保持当前值（默认值）
    }
  }

  function update(patch: Partial<TerminalPrefs>): void {
    userModified.value = true
    prefs.value = sanitize({ ...prefs.value, ...patch })
  }

  function resetToDefaults(): void {
    userModified.value = true
    prefs.value = { ...TERMINAL_PREFS_DEFAULTS }
  }

  if (!stored.found) {
    void recoverFromPreferences()
  }

  watch(prefs, (p) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
    } catch {
      // localStorage 不可用时忽略，preferences 仍会写入
    }
    if (typeof window !== 'undefined' && window.electronAPI) {
      void window.electronAPI.preferences.set(PREF_KEY, p)
    }
  }, { deep: true })

  return { prefs, update, resetToDefaults }
})
