import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerHostsIpc } from './ipc/hosts'
import { registerJumpserverIpc } from './ipc/jumpserver'
import { registerKeysIpc } from './ipc/keys'
import { registerAiIpc, aiClient } from './ipc/ai'
import { registerTerminalIpc } from './ipc/terminal'
import { disposeAllLocalSessions, terminalSessionManager } from './data/terminal/terminalSessionRegistry'
import { registerAgentIpc, setAiClient, disposeAllAgentTabs } from './ipc/agent'
import { registerUpdateIpc } from './ipc/update'
import { restoreOnBoot as restoreUpdateState } from './services/updateService'
import { registerPreferencesIpc } from './ipc/preferences'
import { registerWorkspaceIpc } from './ipc/workspace'
import { initStore } from './services/store'
import { initSecretVault } from './services/secretVault'
import { calculateWindowOptions } from './services/windowState'

function resolvePreloadPath(): string {
  const jsPath = join(__dirname, '../preload/index.js')
  if (existsSync(jsPath)) {
    return jsPath
  }
  return join(__dirname, '../preload/index.mjs')
}

function isAllowedAppNavigation(url: string): boolean {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    try {
      return new URL(url).origin === new URL(process.env['ELECTRON_RENDERER_URL']).origin
    } catch {
      return false
    }
  }

  try {
    const parsed = new URL(url)
    return parsed.protocol === 'file:' && parsed.pathname.endsWith('/index.html')
  } catch {
    return false
  }
}

function handleNavigationAttempt(event: Electron.Event, url: string): void {
  if (isAllowedAppNavigation(url)) return

  event.preventDefault()

  if (isSafeExternalUrl(url)) {
    void shell.openExternal(url)
  }
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const windowOptions = calculateWindowOptions()
  const mainWindow = new BrowserWindow({
    ...windowOptions,
    show: false,
    ...(isMac
      ? { titleBarStyle: 'hidden' as const }
      : { frame: false }
    ),
    webPreferences: {
      preload: resolvePreloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    handleNavigationAttempt(event, url)
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    handleNavigationAttempt(event, url)
  })

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximizeChange', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximizeChange', false)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

/**
 * 逐项初始化：单项失败记录日志并继续，不影响其余模块。
 * 此前整条初始化链没有 catch，任何一步抛错（如 safeStorage 不可用时
 * jumpserver 旧凭据迁移加密失败）都会让后面的 createWindow 不再执行，
 * 应用进程存活但没有任何窗口（点击图标无反应的"假死"）。
 */
function tryInit(label: string, fn: () => void): void {
  try {
    fn()
  } catch (err) {
    console.error(`[main] 初始化失败（${label}）:`, err)
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.zterm')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  tryInit('store', () => initStore())
  tryInit('secretVault', () => initSecretVault())
  // 启动时清理上次未完成的更新包（防止 SHA 不匹配 / 强杀残留）
  tryInit('updateState', () => restoreUpdateState())
  tryInit('preferencesIpc', () => registerPreferencesIpc())
  tryInit('workspaceIpc', () => registerWorkspaceIpc())
  tryInit('hostsIpc', () => registerHostsIpc())
  tryInit('jumpserverIpc', () => registerJumpserverIpc())
  tryInit('keysIpc', () => registerKeysIpc())
  tryInit('aiIpc', () => registerAiIpc())
  tryInit('terminalIpc', () => registerTerminalIpc())
  tryInit('aiClient', () => setAiClient(aiClient))
  tryInit('agentIpc', () => registerAgentIpc())
  tryInit('updateIpc', () => registerUpdateIpc())

  // Window control IPC：只注册一次，macOS 从 Dock 重建窗口时不重复注册；
  // handler 内动态取当前窗口，不闭包引用某个具体窗口实例
  const getTargetWindow = (): BrowserWindow | undefined =>
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  ipcMain.handle('window:minimize', () => getTargetWindow()?.minimize())
  ipcMain.handle('window:maximize', () => {
    const win = getTargetWindow()
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })
  ipcMain.handle('window:close', () => getTargetWindow()?.close())
  ipcMain.handle('window:isMaximized', () => getTargetWindow()?.isMaximized() ?? false)

  try {
    createWindow()
  } catch (err) {
    console.error('[main] 创建主窗口失败:', err)
    dialog.showErrorBox('应用启动失败', err instanceof Error ? err.message : String(err))
    app.quit()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((err: unknown) => {
  // 兜底：初始化链任何未预期异常都不允许演变成 unhandled rejection + 无窗口假死
  console.error('[main] 应用初始化异常:', err)
  try {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  } catch (err2) {
    console.error('[main] 兜底创建窗口失败:', err2)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 应用退出前清理所有资源
app.on('before-quit', () => {
  try {
    // 1. 清理所有 SSH 终端会话
    terminalSessionManager.dispose()
    // 2. 清理所有本地 PTY 会话
    disposeAllLocalSessions()
    // 3. 中止所有 Agent 任务
    disposeAllAgentTabs()
  } catch {
    // 静默处理清理错误
  }
})

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0) {
      const mainWindow = windows[0]
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}
