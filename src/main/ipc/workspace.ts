import { ipcMain } from 'electron'
import {
  clearWorkspaceSnapshot,
  loadWorkspaceSnapshot,
  saveWorkspaceSnapshot
} from '../services/workspaceSnapshotStore'

export function registerWorkspaceIpc(): void {
  ipcMain.handle('workspace:load', () => loadWorkspaceSnapshot())
  ipcMain.handle('workspace:save', (_event, snapshot: unknown) => saveWorkspaceSnapshot(snapshot))
  ipcMain.handle('workspace:clear', () => clearWorkspaceSnapshot())
}
