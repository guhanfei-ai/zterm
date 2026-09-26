import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  useTerminalPrefsStore,
  TERMINAL_PREFS_DEFAULTS,
  TERMINAL_FONT_OPTIONS
} from '../terminalPrefs'

describe('terminalPrefs store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts from defaults when nothing is stored', () => {
    const store = useTerminalPrefsStore()
    expect(store.prefs.fontSize).toBe(TERMINAL_PREFS_DEFAULTS.fontSize)
    expect(store.prefs.scrollback).toBe(TERMINAL_PREFS_DEFAULTS.scrollback)
    expect(store.prefs.cursorStyle).toBe('block')
  })

  it('clamps fontSize and scrollback and rejects invalid enum values', () => {
    const store = useTerminalPrefsStore()

    store.update({ fontSize: 99, scrollback: 1 })
    expect(store.prefs.fontSize).toBe(24)
    expect(store.prefs.scrollback).toBe(100)

    store.update({ fontSize: 2, scrollback: 999999 })
    expect(store.prefs.fontSize).toBe(10)
    expect(store.prefs.scrollback).toBe(500000)

    // 非法枚举与未知字体栈回退默认值，不抛错
    store.update({
      cursorStyle: 'wavy' as never,
      fontFamily: 'Comic Sans MS, cursive'
    })
    expect(store.prefs.cursorStyle).toBe(TERMINAL_PREFS_DEFAULTS.cursorStyle)
    expect(store.prefs.fontFamily).toBe(TERMINAL_FONT_OPTIONS[0].stack)
  })

  it('applies valid patches and resets to defaults', () => {
    const store = useTerminalPrefsStore()

    store.update({ fontSize: 16, cursorStyle: 'bar', cursorBlink: false })
    expect(store.prefs.fontSize).toBe(16)
    expect(store.prefs.cursorStyle).toBe('bar')
    expect(store.prefs.cursorBlink).toBe(false)

    store.resetToDefaults()
    expect(store.prefs).toEqual(TERMINAL_PREFS_DEFAULTS)
  })
})

/** 在 globalThis 上临时挂载 window mock（node 测试环境默认无 window） */
async function withWindowMock<T>(electronAPI: unknown, fn: () => Promise<T>): Promise<T> {
  const globalRef = globalThis as unknown as { window?: unknown }
  const orig = globalRef.window
  globalRef.window = { electronAPI }
  try {
    return await fn()
  } finally {
    if (orig === undefined) delete globalRef.window
    else globalRef.window = orig
  }
}

/** 临时挂载 localStorage mock */
function withLocalStorageMock(ls: unknown, fn: () => void): void {
  const globalRef = globalThis as unknown as { localStorage?: unknown }
  const orig = globalRef.localStorage
  globalRef.localStorage = ls
  try {
    fn()
  } finally {
    if (orig === undefined) delete globalRef.localStorage
    else globalRef.localStorage = orig
  }
}

describe('terminalPrefs recovery from preferences', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('recovers from preferences when localStorage has no config', async () => {
    const saved = { ...TERMINAL_PREFS_DEFAULTS, fontSize: 20, cursorStyle: 'bar' }
    const get = vi.fn().mockResolvedValue(saved)
    const set = vi.fn().mockResolvedValue(undefined)

    await withWindowMock({ preferences: { get, set } }, async () => {
      const store = useTerminalPrefsStore()
      await vi.waitFor(() => expect(store.prefs.fontSize).toBe(20))
      expect(store.prefs.cursorStyle).toBe('bar')
      expect(get).toHaveBeenCalledWith('terminalPrefs')
    })
  })

  it('keeps user modifications made while recovery is pending', async () => {
    let resolveGet: (value: unknown) => void = () => {}
    const get = vi.fn().mockReturnValue(new Promise((resolve) => { resolveGet = resolve }))
    const set = vi.fn().mockResolvedValue(undefined)

    await withWindowMock({ preferences: { get, set } }, async () => {
      const store = useTerminalPrefsStore()
      // IPC 尚未返回时用户已修改偏好
      store.update({ fontSize: 18 })
      resolveGet({ ...TERMINAL_PREFS_DEFAULTS, fontSize: 20 })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(store.prefs.fontSize).toBe(18)
    })
  })

  it('falls back to defaults when both stores are empty', async () => {
    const get = vi.fn().mockResolvedValue(undefined)
    const set = vi.fn().mockResolvedValue(undefined)

    await withWindowMock({ preferences: { get, set } }, async () => {
      const store = useTerminalPrefsStore()
      await vi.waitFor(() => expect(get).toHaveBeenCalled())
      expect(store.prefs).toEqual(TERMINAL_PREFS_DEFAULTS)
    })
  })

  it('does not consult preferences when localStorage already has config', async () => {
    const saved = JSON.stringify({ ...TERMINAL_PREFS_DEFAULTS, fontSize: 16 })
    const get = vi.fn()
    const ls = {
      getItem: vi.fn().mockReturnValue(saved),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn()
    }

    await withWindowMock({ preferences: { get, set: vi.fn() } }, async () => {
      withLocalStorageMock(ls, () => {
        const store = useTerminalPrefsStore()
        expect(store.prefs.fontSize).toBe(16)
      })
      // 留出异步恢复（不应发生）的执行窗口
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(get).not.toHaveBeenCalled()
    })
  })
})
