import { ipcMain, BrowserWindow, app } from 'electron'
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  isAllowedUpdateDownloadUrl,
  isAllowedInstallerPath
} from '../services/updateService'

export function registerUpdateIpc(): void {
  ipcMain.handle('update:check', async () => {
    try {
      const result = await checkForUpdate()
      return { success: true, data: result }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('update:download', async (event, downloadUrl: string, sha256: string) => {
    try {
      // 信任边界：下载源必须锁定为官方 OSS 更新源，不信任 renderer 传入的任意 URL
      if (!isAllowedUpdateDownloadUrl(downloadUrl)) {
        return { success: false, filePath: '', error: '非官方更新源，已拒绝下载' }
      }
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await downloadUpdate(downloadUrl, sha256, (downloaded, total) => {
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send('update:download-progress', { downloaded, total })
        }
      })
      return result
    } catch (e: any) {
      return { success: false, filePath: '', error: e.message }
    }
  })

  ipcMain.handle('update:install', async (_event, filePath: string) => {
    try {
      // 信任边界：只允许安装本进程下载到 temp 目录的更新包（命名模式锁定），
      // installUpdate 内部会以管理员权限执行安装，不得放行任意路径
      if (!isAllowedInstallerPath(filePath)) {
        return { success: false, message: '非法的安装包路径，已拒绝安装' }
      }
      const result = installUpdate(filePath)
      return result
    } catch (e: any) {
      return { success: false, message: e.message }
    }
  })

  ipcMain.handle('update:getVersion', async () => {
    return app.getVersion()
  })
}
