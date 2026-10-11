import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow as ElectronWindow, IpcMainInvokeEvent } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { TEST_SANDBOX } from '../../../test/setup'

const { handlers, windowStub } = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
  windowStub: {}
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(channel, handler) },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => windowStub),
    getAllWindows: vi.fn(() => [windowStub])
  },
  dialog: { showSaveDialog: vi.fn() }
}))
// 保存通道使用真实 IPC 来源检查与文件写入，不实例化模型执行体。
vi.mock('../../application/agent/agentApplication', () => ({ AgentApplication: class {} }))

import { BrowserWindow, dialog } from 'electron'
import { registerAgentIpc } from '../../ipc/agent'
import { configureTrustedRenderer } from '../ipcSecurity'

const entry = join(TEST_SANDBOX.root, 'renderer', 'index.html')
const markdown = '\n## 结论\n\n| 服务 | 端口 |\n| --- | --- |\n| nginx | 80 |\n\n```bash\nprintf "<ok>"\n```\n'

function event(url = pathToFileURL(entry).href): IpcMainInvokeEvent {
  const mainFrame = { url }
  return { senderFrame: mainFrame, sender: { mainFrame, isDestroyed: () => false } } as unknown as IpcMainInvokeEvent
}

function save(content: string, sender = event()): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> {
  const handler = handlers.get('agent:saveMarkdown')
  if (!handler) throw new Error('Markdown 保存通道未注册')
  return handler(sender, { content }) as ReturnType<typeof save>
}

beforeEach(() => {
  handlers.clear()
  vi.clearAllMocks()
  vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(windowStub as ElectronWindow)
  configureTrustedRenderer(entry)
  registerAgentIpc()
})

describe('Markdown 原文保存 IPC', () => {
  it('新通道原样写入正文，保留表格、代码块和首尾换行', async () => {
    const filePath = join(TEST_SANDBOX.root, 'reply.md')
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath })
    expect(handlers.has('agent:saveConclusion')).toBe(false)
    expect(await save(markdown)).toEqual({ success: true, filePath })
    expect(readFileSync(filePath, 'utf-8')).toBe(markdown)
  })

  it('取消保存不写入文件', async () => {
    const filePath = join(TEST_SANDBOX.root, 'canceled.md')
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath })
    expect(await save(markdown)).toEqual({ success: false, canceled: true })
    expect(existsSync(filePath)).toBe(false)
  })

  it('写入失败返回错误，不宣告保存成功', async () => {
    const filePath = join(TEST_SANDBOX.root, 'missing-parent', 'reply.md')
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath })
    expect(await save(markdown)).toMatchObject({ success: false, error: expect.stringContaining('ENOENT') })
    expect(existsSync(filePath)).toBe(false)
  })

  it('新通道继续拒绝非受信任页面，拒绝前不打开保存窗口', () => {
    expect(() => save(markdown, event('https://example.invalid'))).toThrow('非受信任页面')
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
  })
})
