import { ipcMain } from 'electron'
import { getStore } from '../services/store'

const PREFIX = 'ui_'

/**
 * 注册渲染层偏好读写 IPC handler。
 * 所有偏好以 `ui_` 前缀存入 electron-store（即 ~/.zterm/config.json）。
 */
export function registerPreferencesIpc(): void {
  ipcMain.handle('preferences:get', (_event, key: string) => {
    return getStore().get(`${PREFIX}${key}`)
  })

  ipcMain.handle('preferences:set', (_event, key: string, value: unknown) => {
    getStore().set(`${PREFIX}${key}`, value)
  })
}
