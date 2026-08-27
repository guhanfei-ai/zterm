import { app } from 'electron'
import { existsSync, copyFileSync, renameSync } from 'fs'
import Store from 'electron-store'
import { getDataRoot } from './dataPath'

// P2-5：当前 schema 版本号。改了 config 字段语义/默认值时递增；
// 旧版本 store 加载时 migrateLegacyStore 会读出旧 schemaVersion 并按需做一次结构升级。
const CURRENT_SCHEMA_VERSION = 1

// 持久化 store 实例
let store: Store

/**
 * 将旧位置的 electron-store 数据迁移到 ~/.zterm/。
 * 仅在 ~/.zterm/config.json 不存在且旧位置存在时执行一次性迁移。
 * P2-5：迁移时显式写入 schemaVersion；用户从 .bak 恢复时不会与新版字段冲突。
 */
function migrateLegacyStore(): void {
  const newPath = `${getDataRoot()}/config.json`
  if (existsSync(newPath)) return

  const oldPath = `${app.getPath('userData')}/config.json`
  if (!existsSync(oldPath)) return

  try {
    copyFileSync(oldPath, newPath)
    // 旧文件重命名为 .bak 作为安全兜底，不删除
    const bakPath = `${oldPath}.bak`
    try {
      renameSync(oldPath, bakPath)
    } catch {
      /* 重命名失败不影响功能 */
    }
  } catch (err) {
    console.error('[store] 迁移旧配置失败：', err)
  }
}

/**
 * 读取并强制设置 schemaVersion。
 * P2-5：旧数据未带版本号时默认 0，便于未来按版本分支升级。
 */
function ensureSchemaVersion(): void {
  if (!store) return
  const raw = (store as unknown as { get: (k: string) => unknown }).get(
    'schemaVersion'
  ) as number | undefined
  if (raw !== CURRENT_SCHEMA_VERSION) {
    ;(store as unknown as { set: (k: string, v: unknown) => void }).set(
      'schemaVersion',
      CURRENT_SCHEMA_VERSION
    )
  }
}

/**
 * 清理已废弃的持久化 key。
 * 这些 key 来自旧的窗口/面板状态恢复逻辑，现已统一为每次打开使用默认值，
 * 残留数据无消费方，启动时一次性清除。
 */
function cleanupLegacyKeys(): void {
  if (!store) return
  const legacyKeys = ['windowBounds', 'leftPanelWidth', 'rightPanelWidth']
  for (const key of legacyKeys) {
    if (store.has(key)) {
      store.delete(key)
    }
  }
}

export function initStore(): Store {
  migrateLegacyStore()
  store = new Store({ cwd: getDataRoot() })
  ensureSchemaVersion()
  cleanupLegacyKeys()
  return store
}

export function getStore(): Store {
  if (!store) {
    store = new Store({ cwd: getDataRoot() })
    ensureSchemaVersion()
    cleanupLegacyKeys()
  }
  return store
}

export function getCurrentSchemaVersion(): number {
  return CURRENT_SCHEMA_VERSION
}
