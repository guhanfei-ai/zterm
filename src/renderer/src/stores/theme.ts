import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  THEMES,
  getTheme,
  getDefaultThemeForKind,
  type ThemeDefinition
} from '@/assets/themes'

export type ApplyStrategy = 'manual' | 'system'
export type ThemeMode = 'system' | 'dark' | 'light'

const STORAGE_THEME_ID = 'zterm_theme_id'
const STORAGE_STRATEGY = 'zterm_theme_strategy'

function readStored(): { id: string | null; strategy: ApplyStrategy | null } {
  if (typeof localStorage === 'undefined') return { id: null, strategy: null }
  const strategyRaw = localStorage.getItem(STORAGE_STRATEGY)
  return {
    id: localStorage.getItem(STORAGE_THEME_ID),
    strategy: strategyRaw === 'manual' || strategyRaw === 'system' ? strategyRaw : null
  }
}

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

let lastAppliedTokenKeys: string[] = []
// P2-7：bootstrapThemeFromStorage 已在 Pinia 挂载前 apply 一次，避免 store 初始化时重复 apply 造成重渲染闪烁。
let preBootstrapped = false

function applyThemeToDocument(theme: ThemeDefinition): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.setAttribute('data-theme', theme.kind)
  root.setAttribute('data-theme-id', theme.id)
  const style = root.style as CSSStyleDeclaration & { [key: string]: string }
  for (const key of lastAppliedTokenKeys) {
    style.removeProperty(key)
  }
  for (const [k, v] of Object.entries(theme.tokens)) {
    style.setProperty(k, v)
  }
  lastAppliedTokenKeys = Object.keys(theme.tokens)
  preBootstrapped = true
}

function pickInitialTheme(): { theme: ThemeDefinition; strategy: ApplyStrategy } {
  const { id, strategy } = readStored()
  const storedTheme = id ? getTheme(id) : null

  if (strategy === 'manual' && storedTheme && !storedTheme.isPlaceholder) {
    return { theme: storedTheme, strategy: 'manual' }
  }
  if (strategy === 'system') {
    return { theme: getDefaultThemeForKind(getSystemPrefersDark() ? 'dark' : 'light'), strategy: 'system' }
  }
  return { theme: getDefaultThemeForKind('dark'), strategy: 'manual' }
}

/**
 * 在 Pinia 还没挂载时由 main.ts 提前调用，避免首屏闪默认主题。
 * 解析 storage + 系统偏好后直接写入 <html data-theme="..." data-theme-id="..." style.--xxx=...>。
 */
export function bootstrapThemeFromStorage(): void {
  const { theme } = pickInitialTheme()
  applyThemeToDocument(theme)
}

let mql: MediaQueryList | null = null
let systemChangeHandler: ((e: MediaQueryListEvent) => void) | null = null

/**
 * 在 main.ts 应用挂载后调用一次，建立全局系统主题变化监听。
 * 即使用户没进入外观页，系统亮暗变化也会驱动主题更新（仅在 system 策略下生效）。
 */
export function bootstrapThemeListener(): void {
  if (typeof window === 'undefined' || !window.matchMedia) return
  if (mql) return

  const store = useThemeStore()

  mql = window.matchMedia('(prefers-color-scheme: dark)')
  store.systemPrefersDark = mql.matches

  systemChangeHandler = () => {
    store.systemPrefersDark = mql ? mql.matches : true
  }
  if (mql.addEventListener) {
    mql.addEventListener('change', systemChangeHandler)
  } else if ((mql as MediaQueryList & { addListener?: (cb: (e: MediaQueryListEvent) => void) => void }).addListener) {
    (mql as MediaQueryList & { addListener: (cb: (e: MediaQueryListEvent) => void) => void }).addListener(systemChangeHandler)
  }
}

export const useThemeStore = defineStore('theme', () => {
  const initial = pickInitialTheme()
  const themeId = ref(initial.theme.id)
  const applyStrategy = ref<ApplyStrategy>(initial.strategy)
  const systemPrefersDark = ref(getSystemPrefersDark())

  const currentTheme = computed<ThemeDefinition>(() => {
    if (applyStrategy.value === 'system') {
      return getDefaultThemeForKind(systemPrefersDark.value ? 'dark' : 'light')
    }
    return getTheme(themeId.value) ?? initial.theme
  })

  const resolvedKind = computed<'dark' | 'light'>(() => currentTheme.value.kind)

  const resolved = computed<'dark' | 'light'>(() => resolvedKind.value)
  const mode = computed<ThemeMode>(() =>
    applyStrategy.value === 'system' ? 'system' : resolvedKind.value
  )

  function setThemeId(nextId: string): void {
    const target = getTheme(nextId)
    if (!target || target.isPlaceholder) return
    applyStrategy.value = 'manual'
    themeId.value = target.id
  }

  function setStrategy(next: ApplyStrategy): void {
    if (next === 'system') {
      applyStrategy.value = 'system'
    } else {
      const target = getTheme(themeId.value)
      applyStrategy.value = 'manual'
      if (!target || target.isPlaceholder) {
        themeId.value = getDefaultThemeForKind('dark').id
      }
    }
  }

  function quickToggle(): void {
    const cur = currentTheme.value
    const targetKind: 'light' | 'dark' = cur.kind === 'dark' ? 'light' : 'dark'
    const target = getDefaultThemeForKind(targetKind)
    applyStrategy.value = 'manual'
    themeId.value = target.id
  }

  function listAvailableThemes(): ReadonlyArray<ThemeDefinition> {
    return THEMES
  }

  watch([themeId, applyStrategy], () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_THEME_ID, themeId.value)
      localStorage.setItem(STORAGE_STRATEGY, applyStrategy.value)
    }
    if (typeof window !== 'undefined' && window.electronAPI) {
      void window.electronAPI.preferences.set('themeId', themeId.value)
      void window.electronAPI.preferences.set('themeApplyStrategy', applyStrategy.value)
    }
  }, { immediate: false })

  watch(currentTheme, (theme) => {
    // P2-7：如果 bootstrapThemeFromStorage 已经写过同一份主题（首屏），跳过避免重复渲染。
    if (preBootstrapped) {
      preBootstrapped = false
      return
    }
    applyThemeToDocument(theme)
  }, { immediate: true })

  return {
    themeId,
    applyStrategy,
    systemPrefersDark,
    currentTheme,
    resolvedKind,
    resolved,
    mode,
    setThemeId,
    setStrategy,
    quickToggle,
    listAvailableThemes
  }
})
