import { ipcMain } from 'electron'
import { getStore } from '../services/store'
import { storeSecret, getSecret, deleteSecret } from '../services/secretVault'
import { v4 as uuidv4 } from 'uuid'
import { testJumpserverConnection, fetchJumpserverAssets, fetchJumpserverNodes, fetchJumpserverNodeAssets, fetchJumpserverAccounts, createJumpserverConnectionToken, type JumpserverTestResult, type JumpserverAssetsResult, type JumpserverNodesResult, type JumpserverAccountsResult, type JumpserverSessionParamsResult } from '../services/jumpserverClient'

export interface JumpserverConfig {
  id: string
  name: string
  baseUrl: string
  authMode: 'token' | 'password' | 'access_key'
  username?: string
  accessKeyId?: string
  verifyTls: boolean
  createdAt: string
  updatedAt: string
}

interface JumpserverSaveData {
  name: string
  baseUrl: string
  authMode: 'token' | 'password' | 'access_key'
  username?: string
  accessKeyId?: string
  accessKeySecret?: string
  verifyTls: boolean
  credential?: string
}

// ===== 存储键（P14：单实例 → 多实例）=====
const CONFIGS_KEY = 'jumpserver_configs'
const ACTIVE_CONFIG_KEY = 'jumpserver_active_config_id'
const LEGACY_CONFIG_KEY = 'jumpserver_config' // 单实例时代的旧 key，用于一次性迁移
const LEGACY_CREDENTIAL_KEY = 'jumpserver_credential'
const LEGACY_ACCESS_KEY_SECRET_KEY = 'jumpserver_access_key_secret'
const QUICK_ACCESS_KEY = 'jumpserver_quick_access'
const ACCOUNT_PREF_KEY = 'jumpserver_account_pref'

// ===== 连接上下文缓存（v4.3 新增）=====
// key = 旧 tokenId（jumpserver:createToken 成功后返回给 renderer 的令牌 id）
// value = { configId, assetId, accountId }（非敏感选择信息，绝不含 value）
// 用途：terminal:connectJumpserver 阶段用 renderer 传进来的旧 tokenId 查此缓存，
//       拿到 assetId/accountId 后由主进程重新 create-token 得 fresh 令牌再连 koko SSH。
// 缓存为内存态，进程重启即清空（对应"缓存已过期"场景）。
const jumpserverConnectContextCache = new Map<
  string,
  { configId: string; assetId: string; accountId: string }
>()

/**
 * 以旧 tokenId 查连接上下文（v4.3）
 * terminal:connectJumpserver 用此函数拿到 { configId, assetId, accountId }，
 * 再现连现创 fresh 令牌。查不到时调用方应返回分层错误，不得复用旧 token 或猜测参数。
 */
export function getJumpserverConnectContext(tokenId: string):
  | { configId: string; assetId: string; accountId: string }
  | undefined {
  return jumpserverConnectContextCache.get(tokenId)
}

/**
 * 按 configId 解析 Jumpserver 连接配置与凭据（v4.3.1 新增）
 *
 * 供 terminal:connectJumpserver 使用缓存中的 configId 读取对应实例配置，
 * 而非依赖"当前活跃配置"。解决多实例场景下 createToken 与 connect 之间切换实例
 * 导致的配置错绑问题。
 *
 * 仅支持 access_key 认证模式。返回不含任何敏感凭据的错误描述。
 */
export function resolveJumpserverConfigForConnect(configId: string):
  | { success: true; baseUrl: string; accessKeyId: string; accessKeySecret: string; verifyTls: boolean }
  | { success: false; error: string }
{
  const config = getConfigById(configId)
  if (!config) {
    return { success: false, error: '连接配置已失效，请重新选择资产与账号' }
  }
  if (config.authMode !== 'access_key') {
    return { success: false, error: '当前版本仅支持 API Key / Access Key 认证' }
  }
  const accessKeySecret = getSecret(getCredentialStoreKey(config.id, 'access_key'))
  if (!config.accessKeyId || !accessKeySecret) {
    return { success: false, error: '缺少 Access Key ID 或 Secret，请先完善配置' }
  }
  return {
    success: true,
    baseUrl: config.baseUrl,
    accessKeyId: config.accessKeyId,
    accessKeySecret,
    verifyTls: config.verifyTls
  }
}

function normalizeJumpserverBaseUrlInput(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return trimmed

  try {
    const url = new URL(trimmed)
    const normalizedPath = url.pathname.replace(/\/+$/, '')
    url.pathname = normalizedPath === '/api' ? '' : normalizedPath
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return trimmed.replace(/\/api\/?$/, '').replace(/\/+$/, '')
  }
}

function getCredentialStoreKey(configId: string, authMode: string): string {
  return authMode === 'access_key'
    ? `${LEGACY_ACCESS_KEY_SECRET_KEY}_${configId}`
    : `${LEGACY_CREDENTIAL_KEY}_${configId}`
}

function getQuickAccessStoreKey(configId: string): string {
  return `${QUICK_ACCESS_KEY}_${configId}`
}

function getAccountPrefStoreKey(configId: string): string {
  return `${ACCOUNT_PREF_KEY}_${configId}`
}

/**
 * 读取某配置下的账号偏好表（assetId -> 偏好记录）。
 * 数据按 configId 隔离，不保存任何凭据/会话令牌。
 */
function getAccountPreferences(configId: string): Record<string, JumpserverAccountPreference> {
  const raw = getStore().get(getAccountPrefStoreKey(configId))
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, JumpserverAccountPreference>
  }
  return {}
}

function saveAccountPreferences(configId: string, data: Record<string, JumpserverAccountPreference>): void {
  getStore().set(getAccountPrefStoreKey(configId), data)
}

function deleteAccountPreferences(configId: string): void {
  getStore().delete(getAccountPrefStoreKey(configId))
}

function getQuickAccess(configId: string): { favorites: JumpserverQuickAccessItem[]; recent: JumpserverQuickAccessItem[] } {
  const raw = getStore().get(getQuickAccessStoreKey(configId))
  if (
    raw &&
    typeof raw === 'object' &&
    Array.isArray((raw as Record<string, unknown>).favorites) &&
    Array.isArray((raw as Record<string, unknown>).recent)
  ) {
    return {
      favorites: (raw as { favorites: JumpserverQuickAccessItem[] }).favorites,
      recent: (raw as { recent: JumpserverQuickAccessItem[] }).recent
    }
  }
  return { favorites: [], recent: [] }
}

function saveQuickAccess(configId: string, data: { favorites: JumpserverQuickAccessItem[]; recent: JumpserverQuickAccessItem[] }): void {
  getStore().set(getQuickAccessStoreKey(configId), data)
}

function deleteQuickAccess(configId: string): void {
  getStore().delete(getQuickAccessStoreKey(configId))
}

export interface JumpserverQuickAccessItem {
  configId: string
  assetId: string
  name: string
  address: string
  platform: string
  comment: string
  favoritedAt?: string
  lastUsedAt?: string
}

/**
 * Jumpserver 资产账号偏好记录（本地体验能力，按 configId 隔离，不含任何凭据）。
 * 仅在终端连接真正成功后写入，用于「有条件一键连接」减少重复选账号。
 */
export interface JumpserverAccountPreference {
  configId: string
  assetId: string
  accountId: string
  accountName: string
  updatedAt: string
}

// ===== 配置存取（多实例）=====

/** 读取所有 Jumpserver 配置（按 updatedAt 倒序，最近编辑的在前） */
function getAllConfigs(): JumpserverConfig[] {
  const raw = getStore().get(CONFIGS_KEY)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const map = raw as Record<string, JumpserverConfig>
  return Object.values(map).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

function getConfigMap(): Record<string, JumpserverConfig> {
  const raw = getStore().get(CONFIGS_KEY)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, JumpserverConfig>
}

function saveConfigMap(map: Record<string, JumpserverConfig>): void {
  getStore().set(CONFIGS_KEY, map)
}

/** 读取当前活跃配置 ID */
function getActiveConfigId(): string | null {
  const id = getStore().get(ACTIVE_CONFIG_KEY)
  return typeof id === 'string' && id ? id : null
}

function setActiveConfigId(id: string | null): void {
  if (id === null) {
    getStore().delete(ACTIVE_CONFIG_KEY)
  } else {
    getStore().set(ACTIVE_CONFIG_KEY, id)
  }
}

/** 通过 ID 读取某条配置 */
function getConfigById(id: string): JumpserverConfig | null {
  return getConfigMap()[id] ?? null
}

/** 读取当前活跃配置 */
function getActiveConfig(): JumpserverConfig | null {
  const id = getActiveConfigId()
  if (!id) return null
  return getConfigById(id)
}

function hasCredentialForConfig(config: JumpserverConfig): boolean {
  return !!getSecret(getCredentialStoreKey(config.id, config.authMode))
}

/**
 * 获取 Access Key Secret（用于 UI 显示/隐藏切换）
 * 返回明文，由前端控制是否显示
 */
function getAccessKeySecret(configId: string): string | null {
  const secret = getSecret(getCredentialStoreKey(configId, 'access_key'))
  return secret || null
}

/** 返回渲染层安全的配置摘要（不含明文凭据、不含 accessKeySecret） */
function toSafeConfig(config: JumpserverConfig): JumpserverConfig & { hasCredential: boolean } {
  return {
    ...config,
    hasCredential: hasCredentialForConfig(config)
    // 注意：不在此处返回任何明文凭据。
    // UI 需要"显示/隐藏 Secret"时由 jumpserver:getSecret 按需获取；
    // 此前这里曾随所有配置查询发送完整明文 Secret（maskedSecret 字段），已移除。
  }
}

/** 删除某条配置的所有凭据（含旧 key 兜底） */
function clearCredentialsForConfig(configId: string, authMode?: string): void {
  if (authMode === 'access_key') {
    deleteSecret(getCredentialStoreKey(configId, 'access_key'))
  } else {
    deleteSecret(getCredentialStoreKey(configId, 'token'))
    deleteSecret(getCredentialStoreKey(configId, 'password'))
  }
}

/**
 * 旧单实例迁移：检测到 jumpserver_config 旧 key 时，平移到多实例存储并清理旧凭据 key。
 * 已迁移过则跳过。返回是否发生过迁移。
 */
function migrateLegacySingleConfig(): boolean {
  const legacy = getStore().get(LEGACY_CONFIG_KEY)
  if (!legacy || typeof legacy !== 'object') return false

  // 若多实例键已有数据，不再迁移避免覆盖
  if (getAllConfigs().length > 0) {
    // 清理旧 key 防止重复触发
    getStore().delete(LEGACY_CONFIG_KEY)
    deleteSecret(LEGACY_CREDENTIAL_KEY)
    deleteSecret(LEGACY_ACCESS_KEY_SECRET_KEY)
    return false
  }

  const legacyConfig = legacy as JumpserverConfig
  const newId = legacyConfig.id || uuidv4()
  const newConfig: JumpserverConfig = { ...legacyConfig, id: newId }

  const map: Record<string, JumpserverConfig> = { [newId]: newConfig }
  saveConfigMap(map)
  setActiveConfigId(newId)

  // 迁移凭据：旧 key → 新 key
  const oldCred = getSecret(LEGACY_CREDENTIAL_KEY)
  if (oldCred) {
    storeSecret(getCredentialStoreKey(newId, newConfig.authMode), oldCred)
    deleteSecret(LEGACY_CREDENTIAL_KEY)
  }
  const oldAccessSecret = getSecret(LEGACY_ACCESS_KEY_SECRET_KEY)
  if (oldAccessSecret) {
    storeSecret(getCredentialStoreKey(newId, 'access_key'), oldAccessSecret)
    deleteSecret(LEGACY_ACCESS_KEY_SECRET_KEY)
  }

  // 清理旧 key
  getStore().delete(LEGACY_CONFIG_KEY)
  return true
}

/**
 * 删除一条配置（含其凭据、快捷入口、账号偏好）。如删除的是活跃配置，按回退规则更新 activeConfigId。
 * 返回删除后新的 activeConfigId。
 */
function deleteConfigById(configId: string): string | null {
  const map = getConfigMap()
  const target = map[configId]
  if (!target) return getActiveConfigId()

  // 清理该实例的所有本地数据
  delete map[configId]
  saveConfigMap(map)
  clearCredentialsForConfig(configId, target.authMode)
  deleteQuickAccess(configId)
  deleteAccountPreferences(configId)

  // 回退规则：若删除的是活跃配置
  if (getActiveConfigId() === configId) {
    const remaining = Object.values(map)
    if (remaining.length > 0) {
      // 自动切到剩余实例中的第一个（按 updatedAt 倒序，已由 getAllConfigs 保证顺序一致）
      const fallback = remaining.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )[0]
      setActiveConfigId(fallback.id)
      return fallback.id
    }
    setActiveConfigId(null)
    return null
  }
  return getActiveConfigId()
}

/**
 * 保存配置：提供 configId 时更新；不提供时新增并设为活跃。
 * 返回安全摘要 + 实际 configId。
 */
function saveConfigInternal(
  data: JumpserverSaveData,
  configId?: string | null
): { config: JumpserverConfig & { hasCredential: boolean }; configId: string } {
  const now = new Date().toISOString()
  const map = getConfigMap()
  const existing = configId ? map[configId] : null
  const authModeSwitched = existing && existing.authMode !== data.authMode

  // 认证方式切换时，新凭据必须提供
  if (authModeSwitched) {
    const hasNewCredential = (() => {
      switch (data.authMode) {
        case 'access_key':
          return !!data.accessKeyId?.trim() && !!data.accessKeySecret?.trim()
        default:
          return data.credential !== undefined
      }
    })()
    if (!hasNewCredential) {
      throw new Error('切换认证方式时 Access Key ID 和 Secret 都必须填写')
    }
  }

  // access_key 模式：计算最终值并校验
  let finalAccessKeyId: string | undefined
  if (data.authMode === 'access_key') {
    if (data.accessKeyId !== undefined && !data.accessKeyId.trim()) {
      throw new Error('Access Key ID 不能为空')
    }
    if (data.accessKeySecret !== undefined && !data.accessKeySecret.trim()) {
      throw new Error('Access Key Secret 不能为空')
    }
    finalAccessKeyId = data.accessKeyId?.trim() || existing?.accessKeyId
    if (!finalAccessKeyId) {
      throw new Error('Access Key ID 不能为空')
    }
    if (!authModeSwitched) {
      const hasExistingSecret =
        existing?.authMode === 'access_key' &&
        !!getSecret(getCredentialStoreKey(existing.id, 'access_key'))
      const hasNewSecret = !!data.accessKeySecret?.trim()
      if (!hasExistingSecret && !hasNewSecret) {
        throw new Error('Access Key Secret 不能为空')
      }
    }
  }

  const newId = existing?.id || uuidv4()
  const config: JumpserverConfig = {
    id: newId,
    name: data.name,
    baseUrl: normalizeJumpserverBaseUrlInput(data.baseUrl),
    authMode: data.authMode,
    username: data.username || undefined,
    accessKeyId: data.authMode === 'access_key' ? finalAccessKeyId : undefined,
    verifyTls: data.verifyTls,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }

  // 处理凭据存储
  if (authModeSwitched) {
    // 认证方式切换：清除该实例所有旧凭据，只写入新类型的
    clearCredentialsForConfig(newId, existing!.authMode)
    if (data.authMode === 'access_key') {
      if (data.accessKeySecret?.trim()) {
        storeSecret(getCredentialStoreKey(newId, 'access_key'), data.accessKeySecret!.trim())
      }
    } else if (data.credential) {
      storeSecret(getCredentialStoreKey(newId, data.authMode), data.credential)
    }
  } else {
    if (data.authMode === 'access_key') {
      if (data.accessKeySecret?.trim()) {
        storeSecret(getCredentialStoreKey(newId, 'access_key'), data.accessKeySecret!.trim())
      }
    } else if (data.credential !== undefined) {
      storeSecret(getCredentialStoreKey(newId, data.authMode), data.credential)
    }
  }

  map[newId] = config
  saveConfigMap(map)

  // 新增时设为活跃
  if (!existing) {
    setActiveConfigId(newId)
  }

  return { config: toSafeConfig(config), configId: newId }
}

/**
 * 给指定 configId 解析凭据；与原 helpResolveCredentials 同形态
 */
function resolveCredentials(config: JumpserverConfig): {
  credential?: string
  accessKeySecret?: string
  error?: string
} {
  switch (config.authMode) {
    case 'access_key':
      {
        const accessKeySecret = getSecret(getCredentialStoreKey(config.id, 'access_key'))
        if (!config.accessKeyId || !accessKeySecret) {
          return { error: '缺少 Access Key ID 或 Secret，请先完善配置' }
        }
        return { accessKeySecret }
      }
    case 'token':
      {
        const credential = getSecret(getCredentialStoreKey(config.id, 'token'))
        if (!credential) return { error: '缺少 Token，请先完善配置' }
        return { credential }
      }
    case 'password':
      {
        const credential = getSecret(getCredentialStoreKey(config.id, 'password'))
        if (!credential || !config.username) {
          return { error: '缺少用户名或密码，请先完善配置' }
        }
        return { credential }
      }
  }
}

export function registerJumpserverIpc(): void {
  // 启动时执行一次性迁移
  migrateLegacySingleConfig()

  // ===== 多实例配置 API（P14）=====

  ipcMain.handle('jumpserver:getConfig', () => {
    const config = getActiveConfig()
    if (!config) return null
    return toSafeConfig(config)
  })

  ipcMain.handle('jumpserver:getConfigs', () => {
    return getAllConfigs().map(toSafeConfig)
  })

  ipcMain.handle('jumpserver:getActiveConfigId', () => {
    return getActiveConfigId()
  })

  ipcMain.handle(
    'jumpserver:saveConfig',
    (_event, data: JumpserverSaveData, configId?: string | null) => {
      try {
        const result = saveConfigInternal(data, configId)
        return { ...result.config, id: result.configId }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('jumpserver:setActiveConfig', (_event, configId: string): JumpserverConfig | null => {
    const map = getConfigMap()
    if (!map[configId]) return null
    setActiveConfigId(configId)
    return toSafeConfig(map[configId])
  })

  /**
   * 兼容旧调用：不传参时删除当前活跃实例；
   * 传参时删除指定实例（用于切换器中明确删除非活跃实例）。
   */
  ipcMain.handle('jumpserver:deleteConfig', (_event, configId?: string | null): boolean => {
    const targetId = configId || getActiveConfigId()
    if (!targetId) return false
    const existed = !!getConfigById(targetId)
    deleteConfigById(targetId)
    return existed
  })

  ipcMain.handle('jumpserver:testConfig', async (_event, configId?: string): Promise<JumpserverTestResult> => {
    const config = configId ? getConfigById(configId) : getActiveConfig()
    if (!config) return { success: false, error: '未找到 Jumpserver 配置' }
    const { credential, accessKeySecret, error } = resolveCredentials(config)
    if (error) return { success: false, error }

    return await testJumpserverConnection({
      baseUrl: config.baseUrl,
      authMode: config.authMode,
      username: config.username,
      credential,
      accessKeyId: config.accessKeyId,
      accessKeySecret,
      verifyTls: config.verifyTls
    })
  })

  /**
   * 获取 Access Key Secret（用于 UI 显示/隐藏切换）
   * 返回明文，由前端控制是否显示
   */
  ipcMain.handle('jumpserver:getSecret', (_event, configId: string): string | null => {
    const config = getConfigById(configId)
    if (!config || config.authMode !== 'access_key') return null
    return getAccessKeySecret(configId)
  })

  ipcMain.handle('jumpserver:listAssets', async (_event, query?: { keyword?: string; limit?: number; offset?: number }): Promise<JumpserverAssetsResult> => {
    const config = getActiveConfig()
    if (!config) {
      return { success: false, assets: [], total: 0, offset: 0, limit: 0, hasMore: false, error: '未找到 Jumpserver 配置' }
    }
    const { credential, accessKeySecret, error } = resolveCredentials(config)
    if (error) return { success: false, assets: [], total: 0, offset: 0, limit: 0, hasMore: false, error }

    return await fetchJumpserverAssets({
      baseUrl: config.baseUrl,
      authMode: config.authMode,
      username: config.username,
      credential,
      accessKeyId: config.accessKeyId,
      accessKeySecret,
      verifyTls: config.verifyTls
    }, query)
  })

  ipcMain.handle('jumpserver:listAccounts', async (_event, assetId: string): Promise<JumpserverAccountsResult> => {
    const config = getActiveConfig()
    if (!config) return { success: false, accounts: [], error: '未找到 Jumpserver 配置' }
    const { credential, accessKeySecret, error } = resolveCredentials(config)
    if (error) return { success: false, accounts: [], error }

    return await fetchJumpserverAccounts({
      baseUrl: config.baseUrl,
      authMode: config.authMode,
      username: config.username,
      credential,
      accessKeyId: config.accessKeyId,
      accessKeySecret,
      verifyTls: config.verifyTls
    }, assetId)
  })

  ipcMain.handle('jumpserver:createToken', async (_event, assetId: string, accountId: string): Promise<JumpserverSessionParamsResult> => {
    const config = getActiveConfig()
    if (!config) return { success: false, error: '未找到 Jumpserver 配置' }
    const { credential, accessKeySecret, error } = resolveCredentials(config)
    if (error) return { success: false, error }

    // 主链路内部会把 accountId 解析为 v3.7.1 ConnectionToken.account 真实所需的 account name 字符串
    // （见 jumpserverClient.ts createJumpserverFreshToken 注释）
    const result = await createJumpserverConnectionToken({
      baseUrl: config.baseUrl,
      authMode: config.authMode,
      username: config.username,
      credential,
      accessKeyId: config.accessKeyId,
      accessKeySecret,
      verifyTls: config.verifyTls
    }, assetId, accountId)

    // v4.3：以旧 tokenId 为 key 登记连接上下文（非敏感，无 value）
    // terminal:connectJumpserver 阶段用此旧 tokenId 查 assetId/accountId，再现连现创 fresh 令牌
    if (result.success && result.params) {
      jumpserverConnectContextCache.set(result.params.tokenId, {
        configId: config.id,
        assetId,
        accountId
      })
      // 防无界增长：只保留最近若干条（条目在 connectJumpserver 消费后即失效，
      // 无删除路径，长期运行会无限累积；裁掉最旧条目即可）
      const CONNECT_CONTEXT_CACHE_LIMIT = 50
      while (jumpserverConnectContextCache.size > CONNECT_CONTEXT_CACHE_LIMIT) {
        const oldestKey = jumpserverConnectContextCache.keys().next().value
        if (oldestKey === undefined) break
        jumpserverConnectContextCache.delete(oldestKey)
      }
    }

    return result
  })

  ipcMain.handle('jumpserver:listNodes', async (_event, parentKey?: string): Promise<JumpserverNodesResult> => {
    const config = getActiveConfig()
    if (!config) return { success: false, nodes: [], error: '未找到 Jumpserver 配置' }
    const { credential, accessKeySecret, error } = resolveCredentials(config)
    if (error) return { success: false, nodes: [], error }

    return await fetchJumpserverNodes({
      baseUrl: config.baseUrl,
      authMode: config.authMode,
      username: config.username,
      credential,
      accessKeyId: config.accessKeyId,
      accessKeySecret,
      verifyTls: config.verifyTls
    }, parentKey)
  })

  ipcMain.handle('jumpserver:listNodeAssets', async (_event, nodeId: string, query?: { keyword?: string; limit?: number; offset?: number }): Promise<JumpserverAssetsResult> => {
    const config = getActiveConfig()
    if (!config) {
      return { success: false, assets: [], total: 0, offset: 0, limit: 0, hasMore: false, error: '未找到 Jumpserver 配置' }
    }
    const { credential, accessKeySecret, error } = resolveCredentials(config)
    if (error) return { success: false, assets: [], total: 0, offset: 0, limit: 0, hasMore: false, error }

    return await fetchJumpserverNodeAssets({
      baseUrl: config.baseUrl,
      authMode: config.authMode,
      username: config.username,
      credential,
      accessKeyId: config.accessKeyId,
      accessKeySecret,
      verifyTls: config.verifyTls
    }, nodeId, query)
  })

  // ===== 本地快捷入口（收藏 / 最近使用）=====
  // 数据按当前 Jumpserver 配置隔离，不依赖远端 API，不保存凭据。

  ipcMain.handle('jumpserver:getQuickAccess', (): { favorites: JumpserverQuickAccessItem[]; recent: JumpserverQuickAccessItem[] } => {
    const config = getActiveConfig()
    if (!config) return { favorites: [], recent: [] }
    return getQuickAccess(config.id)
  })

  ipcMain.handle('jumpserver:toggleFavorite', (_event, asset: { assetId: string; name: string; address: string; platform: string; comment: string }): { favorites: JumpserverQuickAccessItem[]; recent: JumpserverQuickAccessItem[] } => {
    const config = getActiveConfig()
    if (!config) return { favorites: [], recent: [] }

    const data = getQuickAccess(config.id)
    const existingIndex = data.favorites.findIndex((item) => item.assetId === asset.assetId)
    const now = new Date().toISOString()

    if (existingIndex >= 0) {
      data.favorites.splice(existingIndex, 1)
    } else {
      data.favorites.push({
        configId: config.id,
        assetId: asset.assetId,
        name: asset.name,
        address: asset.address,
        platform: asset.platform,
        comment: asset.comment,
        favoritedAt: now
      })
    }

    saveQuickAccess(config.id, data)
    return data
  })

  ipcMain.handle('jumpserver:recordRecent', (_event, asset: { assetId: string; name: string; address: string; platform: string; comment: string }): { favorites: JumpserverQuickAccessItem[]; recent: JumpserverQuickAccessItem[] } => {
    const config = getActiveConfig()
    if (!config) return { favorites: [], recent: [] }

    const data = getQuickAccess(config.id)
    const now = new Date().toISOString()

    data.recent = data.recent.filter((item) => item.assetId !== asset.assetId)
    data.recent.unshift({
      configId: config.id,
      assetId: asset.assetId,
      name: asset.name,
      address: asset.address,
      platform: asset.platform,
      comment: asset.comment,
      lastUsedAt: now
    })

    if (data.recent.length > 10) {
      data.recent = data.recent.slice(0, 10)
    }

    saveQuickAccess(config.id, data)
    return data
  })

  // ===== 账号偏好（P12）=====

  ipcMain.handle('jumpserver:getAccountPreferences', (): Record<string, JumpserverAccountPreference> => {
    const config = getActiveConfig()
    if (!config) return {}
    return getAccountPreferences(config.id)
  })

  ipcMain.handle(
    'jumpserver:saveAccountPreference',
    (_event, assetId: string, accountId: string, accountName: string): Record<string, JumpserverAccountPreference> => {
      const config = getActiveConfig()
      if (!config) return {}
      if (!assetId || !accountId) return getAccountPreferences(config.id)

      const data = getAccountPreferences(config.id)
      data[assetId] = {
        configId: config.id,
        assetId,
        accountId,
        accountName: accountName || '',
        updatedAt: new Date().toISOString()
      }
      saveAccountPreferences(config.id, data)
      return data
    }
  )
}
