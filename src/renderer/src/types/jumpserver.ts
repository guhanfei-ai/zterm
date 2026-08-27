export interface JumpserverConfig {
  id: string
  name: string
  baseUrl: string
  authMode: 'token' | 'password' | 'access_key'
  username?: string
  accessKeyId?: string
  verifyTls: boolean
  hasCredential: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Jumpserver 多实例接入（P14）：仅返回当前活跃实例的摘要。
 * 获取全部实例请用 jumpserver.getConfigs()。
 */
export type JumpserverActiveConfig = JumpserverConfig

/** JumpServer 用户授权资产 */
export interface JumpserverAsset {
  assetId: string
  name: string
  address: string
  platform: string
  comment: string
}

export interface JumpserverAssetConnectState {
  status: 'unknown' | 'loading' | 'connectable' | 'blocked'
  message: string | null
}

/** JumpServer 资产授权账号 */
export interface JumpserverAccount {
  accountId: string
  name: string
  username: string
  canConnect: boolean
  actions: string[]
}

/** JumpServer 连接会话参数（选账号后申请令牌得到） */
export interface JumpserverSessionParams {
  assetId: string
  accountId: string
  tokenId: string
  clientUrl: string
}

/** JumpServer 资产列表查询参数（分页 + 搜索） */
export interface JumpserverAssetsQuery {
  keyword?: string
  limit?: number
  offset?: number
}

/** JumpServer 资产列表分页结果 */
export interface JumpserverAssetsResult {
  success: boolean
  assets: JumpserverAsset[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
  error?: string
}

/** JumpServer 授权节点 */
export interface JumpserverNode {
  /** 节点主键 id，用于节点资产读取 (nodes/{nodeId}/assets/) */
  nodeId: string
  /** 节点 path key，用于官方子节点接口 (nodes/children/?key=...) */
  key: string
  name: string
  hasChildren: boolean
  assetCount: number
}

/** JumpServer 节点列表结果 */
export interface JumpserverNodesResult {
  success: boolean
  nodes: JumpserverNode[]
  error?: string
}

/** JumpServer 节点下资产列表结果 */
export interface JumpserverNodeAssetsResult {
  success: boolean
  assets: JumpserverAsset[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
  error?: string
}

/** JumpServer 快捷入口项（收藏 / 最近使用） */
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

/** JumpServer 快捷入口数据集 */
export interface JumpserverQuickAccessResult {
  favorites: JumpserverQuickAccessItem[]
  recent: JumpserverQuickAccessItem[]
}

/** 按节点隔离的内联资产状态（L1：树内联资产） */
export interface JumpserverNodeAssetState {
  assets: JumpserverAsset[]
  loading: boolean
  error: string | null
  hasMore: boolean
  loadingMore: boolean
  /** 首次是否已加载过（用于缓存判断） */
  loaded: boolean
}

/** JumpServer 资产账号偏好（按 configId 隔离，仅成功连接后写入） */
export interface JumpserverAccountPreference {
  configId: string
  assetId: string
  accountId: string
  accountName: string
  updatedAt: string
}
