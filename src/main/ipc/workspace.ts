import { registerIpcHandler } from '../services/ipcSecurity'
import {
  clearWorkspaceSnapshot,
  loadWorkspaceSnapshot,
  saveWorkspaceSnapshot
} from '../services/workspaceSnapshotStore'

export function registerWorkspaceIpc(): void {
  registerIpcHandler('workspace:load', () => loadWorkspaceSnapshot())
  registerIpcHandler('workspace:save', (_event, snapshot: unknown) => saveWorkspaceSnapshot(snapshot))
  registerIpcHandler('workspace:clear', () => clearWorkspaceSnapshot())
}
