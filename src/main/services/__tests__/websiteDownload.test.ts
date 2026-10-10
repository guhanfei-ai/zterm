import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const script = readFileSync(new URL('../../../../web/script.js', import.meta.url), 'utf8')
const official = 'https://github.com/guhanfei-ai/zterm/releases/latest'

class Element {
  textContent = ''; href = ''; disabled = false
  classList = { add() {}, remove() {}, toggle() {} }
  setAttribute(name: string) { if (name === 'aria-disabled') this.disabled = true }
  removeAttribute(name: string) { if (name === 'aria-disabled') this.disabled = false }
}

async function run(manifestBase?: string, fetch = vi.fn()) {
  const elements = new Map<string, Element>()
  const document = {
    querySelector: (selector: string) => {
      if (!elements.has(selector)) elements.set(selector, new Element())
      return elements.get(selector)
    },
    querySelectorAll: () => [], getElementById: () => null,
  }
  runInNewContext(script, {
    window: { ZTERM_MANIFEST_BASE: manifestBase, addEventListener() {} }, document,
    HTMLAnchorElement: Element, navigator: { userAgent: 'Mac OS X' },
    URL, Date, Intl, AbortSignal, fetch, console: { warn() {} },
  })
  await vi.waitFor(() => expect(elements.get('[data-field="macos-link"]')?.href).toBeTruthy())
  return elements
}

describe('官网真实下载脚本（内存 DOM，无浏览器或外部请求）', () => {
  it('不配置清单时仍有可用官方入口，不声称已经检测到处理器架构', async () => {
    const fetch = vi.fn()
    const elements = await run(undefined, fetch)
    expect(fetch).not.toHaveBeenCalled()
    for (const platform of ['macos', 'windows']) {
      const button = elements.get(`[data-field="${platform}-link"]`)!
      expect(button.href).toBe(official); expect(button.disabled).toBe(false)
    }
    expect(elements.get('[data-platform-badge="macos"]')?.textContent).not.toContain('与你的设备匹配')
  })
  it('网络失败和畸形清单都回退到发布页，不能提供不安全的下载链接', async () => {
    for (const fetch of [vi.fn().mockRejectedValue(new Error('offline')),
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'javascript:alert(1)', version: 'broken' }) })]) {
      const elements = await run('https://updates.example', fetch)
      expect(elements.get('[data-field="macos-link"]')?.href).toBe(official)
    }
  })
})
