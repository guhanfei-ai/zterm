import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { TEST_SANDBOX } from '../../../test/setup'
const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>())
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) },
  BrowserWindow: { fromWebContents: () => ({}) },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
}))
import { dialog } from 'electron'
import { configureTrustedRenderer, isTrustedRendererUrl, registerIpcHandler, confirmSecretDisclosure } from '../ipcSecurity'

const entry = join(TEST_SANDBOX.root, 'renderer', 'index.html')
const entryUrl = pathToFileURL(entry).href
function event(url = entryUrl): IpcMainInvokeEvent {
  const mainFrame = { url }
  return { senderFrame: mainFrame, sender: { mainFrame, isDestroyed: () => false } } as unknown as IpcMainInvokeEvent
}
beforeEach(() => { handlers.clear(); vi.clearAllMocks(); configureTrustedRenderer(entry) })

describe('桌面 IPC 来源边界', () => {
  it('只信任准确入口，拒绝其他同名 index.html', () => {
    expect(isTrustedRendererUrl(entryUrl + '#settings')).toBe(true)
    expect(isTrustedRendererUrl('file:///tmp/evil/index.html')).toBe(false)
    expect(isTrustedRendererUrl('https://example.invalid/index.html')).toBe(false)
  })
  it('拒绝子 frame、导航后的页面和销毁的窗口', () => {
    const called = vi.fn()
    registerIpcHandler('test', called)
    const invoke = handlers.get('test')!
    const good = event()
    invoke(good, 'ok')
    expect(called).toHaveBeenCalledOnce()
    expect(() => invoke({ ...good, senderFrame: { url: good.senderFrame!.url } })).toThrow()
    expect(() => invoke(event('https://example.invalid'))).toThrow()
    expect(() => invoke({ ...good, sender: { ...good.sender, isDestroyed: () => true } })).toThrow()
    expect(called).toHaveBeenCalledOnce()
  })
  it('密钥显示需要原生确认，并在确认后再次核对页面', async () => {
    expect(await confirmSecretDisclosure(event(), '测试凭据')).toBe(false)
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    expect(await confirmSecretDisclosure(event(), '测试凭据')).toBe(true)
    const navigated = event()
    vi.mocked(dialog.showMessageBox).mockImplementationOnce(async () => {
      Object.assign(navigated.senderFrame!, { url: 'https://example.invalid' })
      return { response: 1, checkboxChecked: false }
    })
    expect(await confirmSecretDisclosure(navigated, '测试凭据')).toBe(false)
  })
})
