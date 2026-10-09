import { ipcMain, BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'

let entryUrl = ''
let developmentOrigin = ''

export function configureTrustedRenderer(entryPath: string, devUrl?: string): void {
  entryUrl = pathToFileURL(entryPath).href
  developmentOrigin = devUrl ? new URL(devUrl).origin : ''
}

/** 文件页面必须精确匹配入口；开发页面仅来自指定 dev server。 */
export function isTrustedRendererUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (developmentOrigin) return url.origin === developmentOrigin
    url.hash = ''
    return Boolean(entryUrl) && url.href === entryUrl
  } catch { return false }
}

export function isTrustedIpcSender(event: IpcMainInvokeEvent): boolean {
  return Boolean(event.senderFrame && event.senderFrame === event.sender.mainFrame &&
    !event.sender.isDestroyed() && isTrustedRendererUrl(event.senderFrame.url))
}

/** 每个 invoke 都重新核对主 frame 和页面来源，不能只在窗口创建时信任。 */
export function registerIpcHandler(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedIpcSender(event)) throw new Error('拒绝来自非受信任页面的请求')
    return listener(event, ...args)
  })
}

/** 敏感内容的显示需要主进程原生确认，页面脚本不能自行确认。 */
export async function confirmSecretDisclosure(event: IpcMainInvokeEvent, label: string): Promise<boolean> {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return false
  const { response } = await dialog.showMessageBox(window, {
    type: 'question', title: '显示敏感凭据',
    message: '是否允许显示' + label + '？', detail: '凭据将显示在当前窗口中，请确认周围环境安全。',
    buttons: ['取消', '显示'], defaultId: 0, cancelId: 0,
  })
  return response === 1 && isTrustedIpcSender(event)
}
