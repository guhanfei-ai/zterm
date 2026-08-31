import {
  normalizeWorkspaceSnapshot,
  type WorkspaceSnapshotParseResult,
  type WorkspaceSnapshotV1
} from '../model/workspace'
import { getStore } from './store'

export const WORKSPACE_SNAPSHOT_STORE_KEY = 'workspace_snapshot_v1'

export type WorkspaceSnapshotLoadResult =
  | { found: false }
  | WorkspaceSnapshotParseResult

export function loadWorkspaceSnapshot(): WorkspaceSnapshotLoadResult {
  try {
    const raw = getStore().get(WORKSPACE_SNAPSHOT_STORE_KEY)
    if (raw === undefined) return { found: false }
    return normalizeWorkspaceSnapshot(raw)
  } catch {
    console.error('[workspace] 读取工作区快照失败')
    return { recoverable: false, reason: '读取已保存工作区失败' }
  }
}

export function saveWorkspaceSnapshot(value: unknown): { success: true; snapshot: WorkspaceSnapshotV1 } | { success: false; error: string } {
  const result = normalizeWorkspaceSnapshot(value)
  if (!result.recoverable) {
    return { success: false, error: result.reason }
  }

  try {
    getStore().set(WORKSPACE_SNAPSHOT_STORE_KEY, result.snapshot)
    return { success: true, snapshot: result.snapshot }
  } catch {
    console.error('[workspace] 保存工作区快照失败')
    return { success: false, error: '保存工作区失败' }
  }
}

export function clearWorkspaceSnapshot(): { success: boolean; error?: string } {
  try {
    getStore().delete(WORKSPACE_SNAPSHOT_STORE_KEY)
    return { success: true }
  } catch {
    console.error('[workspace] 清除工作区快照失败')
    return { success: false, error: '清除已保存工作区失败' }
  }
}
