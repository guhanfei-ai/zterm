import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, h, nextTick, reactive, ssrContextKey } from 'vue'
import XtermPane from './XtermPane.vue'

// 使用内存渲染器验证连接与 fit 的先后顺序，不启动浏览器、SSH 或本地 PTY。
const fixtures = vi.hoisted(() => ({
  tab: { id: 'tab', status: 'connecting' as 'connecting' | 'connected' | 'disconnected', generation: 1, reconnectTarget: null, error: null, title: 'fixture' },
  prefs: { fontSize: 13, fontFamily: 'monospace', scrollback: 1000, cursorStyle: 'block', cursorBlink: false },
  resize: vi.fn(async (_id: string, _cols: number, _rows: number) => {}),
  fit: vi.fn(),
  term: null as any,
}))
vi.mock('@/stores/terminal', () => ({ useTerminalStore: () => ({ getTabById: () => fixtures.tab, activeTabId: 'tab' }) }))
vi.mock('@/stores/terminalPrefs', () => ({ useTerminalPrefsStore: () => ({ prefs: fixtures.prefs }) }))
vi.mock('@/stores/theme', () => ({ useThemeStore: () => ({ currentTheme: { xterm: {} } }) }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ info: vi.fn(), success: vi.fn(), error: vi.fn() }) }))
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80
  rows = 24
  options: Record<string, unknown>
  element: any
  resizeListener?: (size: { cols: number; rows: number }) => void
  parser = { registerCsiHandler: () => ({ dispose() {} }) }
  constructor(options: Record<string, unknown>) { this.options = options; fixtures.term = this }
  loadAddon(addon: { activate?: (terminal: unknown) => void }) { addon.activate?.(this) }
  open(element: unknown) { this.element = element }
  onData() { return { dispose() {} } }
  onResize(listener: (size: { cols: number; rows: number }) => void) { this.resizeListener = listener; return { dispose() {} } }
  resize(cols: number, rows: number) {
    if (this.cols === cols && this.rows === rows) return
    this.cols = cols; this.rows = rows; this.resizeListener?.({ cols, rows })
  }
  clear() {}
  write() {}
  writeln() {}
  dispose() {}
} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {
  fit() { fixtures.fit(); fixtures.term.resize(120, 42) }
} }))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))

function node(text = ''): any { return { text, children: [], parent: null, props: {}, clientWidth: 960, clientHeight: 680, getClientRects: () => [{}] } }
const renderer = createRenderer<any, any>({
  createElement: () => node(), createText: text => node(text), createComment: text => node(text),
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child)
  },
  remove(child) { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1) },
  parentNode: child => child.parent,
  nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
  setText: (child, text) => { child.text = text },
  setElementText: (child, text) => { child.text = text; child.children = [] },
  patchProp: (child, key, _old, value) => { child.props[key] = value },
})
let app: ReturnType<typeof renderer.createApp> | undefined

beforeEach(() => {
  vi.useFakeTimers()
  fixtures.tab = reactive({ ...fixtures.tab, status: 'connecting', generation: 1 })
  fixtures.prefs = reactive({ ...fixtures.prefs, fontSize: 13 })
  fixtures.resize.mockReset(); fixtures.resize.mockResolvedValue(undefined)
  fixtures.fit.mockClear(); fixtures.term = null
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {}, electronAPI: { terminal: {
    resize: fixtures.resize,
    onData: () => () => {}, onAgentBusy: () => () => {},
    isAgentBusy: async () => ({ busy: false, generation: fixtures.tab.generation }),
  } } })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1 })
  // Vitest 的 Vue 插件使用 SSR 编译；这里保留真实 setup，用两层容器提供 DOM ref。
  app = renderer.createApp({ ...XtermPane, render() {
    return h('div', { ref: 'containerRef' }, [h('div', { ref: 'wrapperRef' })])
  } }, { tabId: 'tab' })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(node())
})
afterEach(() => { app?.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('xterm 与连接的尺寸同步', () => {
  it('连接中已 fit，连接成功后尺寸没变化也必须把准确尺寸传给 PTY', async () => {
    await vi.advanceTimersByTimeAsync(100)
    expect(fixtures.term.cols).toBe(120)
    expect(fixtures.resize).not.toHaveBeenCalled()
    fixtures.tab.status = 'connected'
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)
    expect(fixtures.resize).toHaveBeenCalledExactlyOnceWith('tab', 120, 42)
    fixtures.prefs.fontSize++
    await nextTick()
    await vi.advanceTimersByTimeAsync(60)
    expect(fixtures.resize).toHaveBeenCalledTimes(1)
  })

  it('重连到新代际，即使本地行列数相同也重新同步', async () => {
    fixtures.tab.status = 'connected'
    await nextTick(); await vi.advanceTimersByTimeAsync(250)
    fixtures.resize.mockClear()
    fixtures.tab.generation = 2
    await nextTick(); await vi.advanceTimersByTimeAsync(250)
    expect(fixtures.resize).toHaveBeenCalledExactlyOnceWith('tab', 120, 42)
  })

  it('隐藏的容器不向远端发送拟合尺寸', async () => {
    fixtures.term.element.clientWidth = 0
    fixtures.term.element.clientHeight = 0
    fixtures.tab.status = 'connected'
    await nextTick(); await vi.advanceTimersByTimeAsync(250)
    expect(fixtures.fit).not.toHaveBeenCalled()
    expect(fixtures.resize).not.toHaveBeenCalled()
  })

  it('尺寸 IPC 失败后，下一次 fit 能重试相同行列数', async () => {
    await vi.advanceTimersByTimeAsync(100)
    fixtures.resize.mockRejectedValueOnce(new Error('模拟传输失败'))
    fixtures.tab.status = 'connected'
    await nextTick(); await vi.advanceTimersByTimeAsync(250)
    expect(fixtures.resize).toHaveBeenCalledTimes(1)
    fixtures.prefs.fontSize++
    await nextTick(); await vi.advanceTimersByTimeAsync(60)
    expect(fixtures.resize).toHaveBeenCalledTimes(2)
    expect(fixtures.resize).toHaveBeenLastCalledWith('tab', 120, 42)
  })
})
