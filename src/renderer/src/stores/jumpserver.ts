import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { JumpserverConfig, JumpserverAsset, JumpserverNode, JumpserverAccount, JumpserverSessionParams, JumpserverQuickAccessItem, JumpserverAccountPreference, JumpserverNodeAssetState, JumpserverAssetConnectState } from '../types/jumpserver'

export const useJumpserverStore = defineStore('jumpserver', () => {
  // ===== Jumpserver 多实例（P14）=====
  /** 全部已保存的 Jumpserver 实例（按 updatedAt 倒序） */
  const jumpserverConfigs = ref<Array<JumpserverConfig & { hasCredential: boolean }>>([])
  /** 当前活跃实例 ID；null = 没有任何活跃实例 */
  const jumpserverActiveConfigId = ref<string | null>(null)
  /** 当前活跃实例摘要（兼容旧访问点，内部从 jumpserverConfigs 中按 id 选出） */
  const jumpserverConfig = ref<(JumpserverConfig & { hasCredential: boolean }) | null>(null)
  const jumpserverLoading = ref(false)
  const jumpserverAssets = ref<JumpserverAsset[]>([])
  const jumpserverAssetsLoading = ref(false)
  const jumpserverAssetsError = ref<string | null>(null)
  const jumpserverAssetsKeyword = ref('')
  const jumpserverAssetsTotal = ref(0)
  const jumpserverAssetsHasMore = ref(false)
  const jumpserverAssetsLoadingMore = ref(false)
  const jumpserverSelectedAssetId = ref<string | null>(null)
  const jumpserverAccounts = ref<JumpserverAccount[]>([])
  const jumpserverAccountsLoading = ref(false)
  const jumpserverAccountsError = ref<string | null>(null)
  const jumpserverAssetConnectStates = ref<Record<string, JumpserverAssetConnectState>>({})
  const jumpserverSessionParams = ref<JumpserverSessionParams | null>(null)
  const jumpserverSessionLoading = ref(false)
  const jumpserverSessionError = ref<string | null>(null)

  // ===== 节点树（P9）=====
  const jumpserverRootNodes = ref<JumpserverNode[]>([])
  const jumpserverChildNodes = ref<Record<string, JumpserverNode[]>>({})
  const jumpserverRootNodesLoading = ref(false)
  const jumpserverNodeChildrenLoading = ref<Record<string, boolean>>({})
  /** L1验收：按节点隔离的子节点加载错误（不污染全局 jumpserverNodesError） */
  const jumpserverNodeChildrenErrors = ref<Record<string, string | null>>({})
  const jumpserverNodesError = ref<string | null>(null)
  const jumpserverExpandedNodeIds = ref<Record<string, boolean>>({})
  const jumpserverSelectedNodeId = ref<string | null>(null)
  const jumpserverNodeAssets = ref<JumpserverAsset[]>([])
  const jumpserverNodeAssetsLoading = ref(false)
  const jumpserverNodeAssetsError = ref<string | null>(null)
  const jumpserverNodeAssetsTotal = ref(0)
  const jumpserverNodeAssetsHasMore = ref(false)
  const jumpserverNodeAssetsLoadingMore = ref(false)

  // ===== 树内联资产状态（L1）：按 nodeId 隔离 =====
  const jumpserverNodeAssetStates = ref<Record<string, JumpserverNodeAssetState>>({})

  // ===== 快捷入口（P10）：收藏 + 最近使用 =====
  const jumpserverFavorites = ref<JumpserverQuickAccessItem[]>([])
  const jumpserverRecent = ref<JumpserverQuickAccessItem[]>([])
  const jumpserverQuickAccessLoading = ref(false)

  // ===== 账号偏好（P12）：assetId -> 偏好记录，按当前配置隔离 =====
  const jumpserverAccountPreferences = ref<Record<string, JumpserverAccountPreference>>({})
  const jumpserverAssetConnectRequests = new Map<string, Promise<JumpserverAssetConnectState>>()

  function getAssetConnectStateKey(assetId: string): string {
    return `${jumpserverActiveConfigId.value ?? 'no-config'}:${assetId}`
  }

  function getJumpserverAssetConnectState(assetId: string): JumpserverAssetConnectState {
    return jumpserverAssetConnectStates.value[getAssetConnectStateKey(assetId)] ?? {
      status: 'unknown',
      message: null
    }
  }

  // ===== 运行时：按当前活跃实例同步 jumpserverConfig 派生值 =====
  /**
   * 从 jumpserverConfigs + jumpserverActiveConfigId 派生 jumpserverConfig。
   * 兼容旧访问点（组件直接读 jumpserverConfig.name / hasCredential 等）。
   */
  function syncActiveConfig(): void {
    const id = jumpserverActiveConfigId.value
    if (!id) {
      jumpserverConfig.value = null
      return
    }
    const found = jumpserverConfigs.value.find((c) => c.id === id) ?? null
    jumpserverConfig.value = found
  }

  /**
   * 清空所有依赖活跃实例的运行时状态：节点树、搜索、选中节点、资产列表、账号、会话。
   * 在切换/删除活跃实例时调用，避免旧数据串台。
   */
  function clearJumpserverRuntimeState(): void {
    jumpserverAssets.value = []
    jumpserverAssetsKeyword.value = ''
    jumpserverAssetsTotal.value = 0
    jumpserverAssetsHasMore.value = false
    jumpserverAssetsLoadingMore.value = false
    jumpserverAssetsError.value = null
    jumpserverAssetsLoading.value = false

    jumpserverRootNodes.value = []
    jumpserverChildNodes.value = {}
    jumpserverExpandedNodeIds.value = {}
    jumpserverSelectedNodeId.value = null
    jumpserverNodeAssets.value = []
    jumpserverNodeAssetsTotal.value = 0
    jumpserverNodeAssetsHasMore.value = false
    jumpserverNodeAssetsLoadingMore.value = false
    jumpserverNodeAssetsError.value = null
    jumpserverNodeAssetsLoading.value = false
    jumpserverRootNodesLoading.value = false

    // L1：清空树内联资产状态
    jumpserverNodeAssetStates.value = {}
    jumpserverNodeInlineAssetRequestIds = {}
    jumpserverNodeChildrenLoading.value = {}
    jumpserverNodeChildrenErrors.value = {}
    jumpserverNodesError.value = null

    jumpserverSelectedAssetId.value = null
    jumpserverAccounts.value = []
    jumpserverAccountsError.value = null
    jumpserverAssetConnectStates.value = {}
    jumpserverAssetConnectRequests.clear()

    jumpserverSessionParams.value = null
    jumpserverSessionError.value = null
  }

  // ===== 手动刷新（P13）：聚合刷新进行态，给左侧刷新入口清晰 loading =====
  const jumpserverRefreshing = ref(false)

  // ===== Jumpserver 配置管理（多实例 P14）=====

  async function fetchJumpserverConfig(): Promise<void> {
    jumpserverLoading.value = true
    try {
      // 一次性加载全部实例 + 当前活跃 id
      const [configs, activeId] = await Promise.all([
        window.electronAPI.jumpserver.getConfigs(),
        window.electronAPI.jumpserver.getActiveConfigId()
      ])
      jumpserverConfigs.value = configs
      jumpserverActiveConfigId.value = activeId
      syncActiveConfig()

      if (jumpserverConfig.value) {
        loadJumpserverQuickAccess()
        loadJumpserverAccountPreferences()
        if (!jumpserverAssetsKeyword.value) {
          fetchJumpserverRootNodes()
        } else {
          fetchJumpserverAssets()
        }
      } else {
        clearJumpserverQuickAccess()
      }
    } catch (err: unknown) {
      // fire-and-forget 调用场景下静默兜底，避免 unhandled rejection
      console.warn('[jumpserver] 加载配置失败', err)
    } finally {
      jumpserverLoading.value = false
    }
  }

  async function saveJumpserverConfig(data: {
    name: string
    baseUrl: string
    authMode: 'token' | 'password' | 'access_key'
    username?: string
    accessKeyId?: string
    accessKeySecret?: string
    verifyTls: boolean
    credential?: string
  }, configId?: string | null): Promise<void> {
    // 1. 记录保存前的 activeConfigId
    const oldActiveId = jumpserverActiveConfigId.value

    // 2. 保存
    const result = await window.electronAPI.jumpserver.saveConfig(data, configId)

    // 3. 重新拉取配置列表和活跃 ID
    await fetchJumpserverConfigsOnly()
    syncActiveConfig()

    // 4. 检测活跃实例是否发生变化
    if (jumpserverActiveConfigId.value !== oldActiveId) {
      // 活跃实例变化了（通常是新增实例自动成为活跃）
      // 执行与 setActiveJumpserverConfig() 一致的完整切换
      clearJumpserverRuntimeState()
      if (jumpserverConfig.value) {
        await loadJumpserverQuickAccess()
        await loadJumpserverAccountPreferences()
        await fetchJumpserverRootNodes()
      }
    } else {
      // 活跃实例未变（编辑已有实例），保持原有逻辑
      if (jumpserverConfig.value) {
        await loadJumpserverQuickAccess()
        await loadJumpserverAccountPreferences()
      }
    }
  }

  /**
   * 仅刷新实例列表与活跃 id，不触发节点树/资产加载；
   * 用于 saveJumpserverConfig 等局部更新后的轻量同步。
   */
  async function fetchJumpserverConfigsOnly(): Promise<void> {
    const [configs, activeId] = await Promise.all([
      window.electronAPI.jumpserver.getConfigs(),
      window.electronAPI.jumpserver.getActiveConfigId()
    ])
    jumpserverConfigs.value = configs
    jumpserverActiveConfigId.value = activeId
  }

  async function deleteJumpserverConfig(configId?: string | null): Promise<boolean> {
    // 不传 configId 时默认为删除当前活跃实例（兼容旧 dialog 行为）
    const targetId = configId ?? jumpserverActiveConfigId.value
    if (!targetId) return false

    // 记录删除前的活跃 id：仅当活跃 id 真的变化时才清运行时状态
    const activeBeforeDelete = jumpserverActiveConfigId.value
    const isDeletingActive = activeBeforeDelete === targetId

    const result = await window.electronAPI.jumpserver.deleteConfig(targetId)
    if (!result) return false

    // 重新拉实例列表以反映新的 active 回退
    await fetchJumpserverConfigsOnly()
    syncActiveConfig()

    if (isDeletingActive) {
      // 仅在删除的就是当前实例时，才清理旧运行时状态并加载新活跃实例的数据
      clearJumpserverRuntimeState()

      if (jumpserverConfig.value) {
        // 发生了 active 回退：新活跃实例加载自己的快捷入口 / 偏好 / 根节点
        await loadJumpserverQuickAccess()
        await loadJumpserverAccountPreferences()
        await fetchJumpserverRootNodes()
      } else {
        // 没有任何剩余实例：彻底清空
        clearJumpserverQuickAccess()
      }
    }
    // 删除非当前实例：不改 active、不清运行时、不重拉快捷入口/偏好
    return result
  }

  /**
   * 切换活跃实例：清掉旧运行时状态 → 加载新实例的快捷入口 + 偏好 + 根节点树。
   */
  async function setActiveJumpserverConfig(configId: string): Promise<void> {
    if (configId === jumpserverActiveConfigId.value) return
    const target = await window.electronAPI.jumpserver.setActiveConfig(configId)
    if (!target) return

    jumpserverActiveConfigId.value = target.id
    syncActiveConfig()

    clearJumpserverRuntimeState()
    await loadJumpserverQuickAccess()
    await loadJumpserverAccountPreferences()
    await fetchJumpserverRootNodes()
  }

  async function testJumpserverConfig(configId?: string): Promise<{
    success: boolean
    user?: { id: string; username: string; name: string }
    error?: string
  }> {
    return await window.electronAPI.jumpserver.testConfig(configId)
  }

  /**
   * 获取 Access Key Secret（用于 UI 显示/隐藏切换）
   * 返回明文，由前端控制是否显示
   */
  async function getJumpserverSecret(configId: string): Promise<string | null> {
    return await window.electronAPI.jumpserver.getSecret(configId)
  }

  // ===== 手动刷新（P13）=====
  /**
   * 根据当前所在上下文（搜索 / 根层 / 选中节点）刷新数据，
   * 同时刷新快捷入口与账号偏好。无副作用地复用现有 fetch 动作。
   * 节点层（已展开的子节点 / 子层资产加载更多）由 JumpserverNodeTree 自行触发，不在此聚合。
   */
  async function refreshJumpserverContext(): Promise<void> {
    if (jumpserverRefreshing.value) return
    jumpserverRefreshing.value = true
    try {
      // 1) 快捷入口 + 账号偏好：按当前配置刷新
      if (jumpserverConfig.value) {
        await Promise.allSettled([
          loadJumpserverQuickAccess(),
          loadJumpserverAccountPreferences()
        ])
      }

      // 2) 资产视图：按当前所在上下文走对应 fetch
      if (jumpserverAssetsKeyword.value) {
        await searchJumpserverAssets(jumpserverAssetsKeyword.value)
        return
      }
      if (jumpserverSelectedNodeId.value) {
        // 用户停留在某个节点视图：刷新该节点资产
        await selectJumpserverNode(jumpserverSelectedNodeId.value)
        return
      }
      // 默认：根层节点
      await fetchJumpserverRootNodes()
    } finally {
      jumpserverRefreshing.value = false
    }
  }

  /** 防旧响应覆盖：每次首屏/搜索递增 requestId，回调中检查是否过期 */
  let jumpserverAssetsRequestId = 0

  /** 防加载更多状态卡死：首屏/搜索时递增，loadMore 的 finally 中校验 */
  let jumpserverLoadMoreRequestId = 0

  /** 防根层节点加载旧响应覆盖：与子层 requestId 隔离，避免互相抢同一计数器导致 loading 卡死 */
  let jumpserverRootNodesRequestId = 0

  /** 按节点隔离的子节点请求代际：每个节点独立计数，避免 A 节点 loading 被 B 节点请求覆盖而无法收口 */
  let jumpserverNodeChildrenRequestIds: Record<string, number> = {}

  /** 防节点资产加载旧响应覆盖 */
  let jumpserverNodeAssetsRequestId = 0

  /** 防节点资产加载更多卡死 */
  let jumpserverNodeAssetsLoadMoreId = 0

  /** L1：按节点隔离的树内联资产请求代际 */
  let jumpserverNodeInlineAssetRequestIds: Record<string, number> = {}

  /** 首屏加载 JumpServer 资产（重置列表，从第一页开始） */
  async function fetchJumpserverAssets(): Promise<void> {
    jumpserverAssetsLoading.value = true
    jumpserverAssetsError.value = null
    jumpserverAssetsKeyword.value = ''
    jumpserverAssets.value = []
    jumpserverAssetsTotal.value = 0
    jumpserverAssetsHasMore.value = false
    jumpserverAssetsLoadingMore.value = false
    jumpserverLoadMoreRequestId++

    const requestId = ++jumpserverAssetsRequestId

    try {
      const result = await window.electronAPI.jumpserver.listAssets()
      if (requestId !== jumpserverAssetsRequestId) return

      if (result.success) {
        jumpserverAssets.value = result.assets
        jumpserverAssetsTotal.value = result.total
        jumpserverAssetsHasMore.value = result.hasMore
      } else {
        jumpserverAssets.value = []
        jumpserverAssetsError.value = result.error || '拉取资产列表失败'
      }
    } catch (err: unknown) {
      if (requestId !== jumpserverAssetsRequestId) return
      jumpserverAssets.value = []
      jumpserverAssetsError.value = err instanceof Error ? err.message : '拉取资产列表失败'
    } finally {
      if (requestId === jumpserverAssetsRequestId) {
        jumpserverAssetsLoading.value = false
      }
    }
  }

  /** 关键字搜索 JumpServer 资产（重置列表，从第一页开始） */
  async function searchJumpserverAssets(keyword: string): Promise<void> {
    jumpserverAssetsLoading.value = true
    jumpserverAssetsError.value = null
    jumpserverAssetsKeyword.value = keyword
    jumpserverAssets.value = []
    jumpserverAssetsTotal.value = 0
    jumpserverAssetsHasMore.value = false
    jumpserverAssetsLoadingMore.value = false
    jumpserverLoadMoreRequestId++

    const requestId = ++jumpserverAssetsRequestId

    try {
      const result = await window.electronAPI.jumpserver.listAssets({ keyword: keyword || undefined })
      if (requestId !== jumpserverAssetsRequestId) return

      if (result.success) {
        jumpserverAssets.value = result.assets
        jumpserverAssetsTotal.value = result.total
        jumpserverAssetsHasMore.value = result.hasMore
      } else {
        jumpserverAssets.value = []
        jumpserverAssetsError.value = result.error || '搜索资产失败'
      }
    } catch (err: unknown) {
      if (requestId !== jumpserverAssetsRequestId) return
      jumpserverAssets.value = []
      jumpserverAssetsError.value = err instanceof Error ? err.message : '搜索资产失败'
    } finally {
      if (requestId === jumpserverAssetsRequestId) {
        jumpserverAssetsLoading.value = false
      }
    }
  }

  /** 加载更多 JumpServer 资产（下一页，追加到已有列表） */
  async function loadMoreJumpserverAssets(): Promise<void> {
    if (!jumpserverAssetsHasMore.value || jumpserverAssetsLoadingMore.value) return

    jumpserverAssetsLoadingMore.value = true
    const currentLoadMoreId = ++jumpserverLoadMoreRequestId

    const requestId = jumpserverAssetsRequestId

    try {
      const nextOffset = jumpserverAssets.value.length
      const result = await window.electronAPI.jumpserver.listAssets({
        keyword: jumpserverAssetsKeyword.value || undefined,
        offset: nextOffset
      })

      if (requestId !== jumpserverAssetsRequestId) return

      if (result.success) {
        jumpserverAssets.value.push(...result.assets)
        jumpserverAssetsTotal.value = result.total
        jumpserverAssetsHasMore.value = result.hasMore
      } else {
        jumpserverAssetsError.value = result.error || '加载更多失败'
      }
    } catch (err: unknown) {
      if (requestId !== jumpserverAssetsRequestId) return
      jumpserverAssetsError.value = err instanceof Error ? err.message : '加载更多失败'
    } finally {
      if (currentLoadMoreId === jumpserverLoadMoreRequestId) {
        jumpserverAssetsLoadingMore.value = false
      }
    }
  }

  // ===== 节点树方法（P9）=====

  /** 拉取 JumpServer 根层节点 */
  async function fetchJumpserverRootNodes(): Promise<void> {
    jumpserverRootNodesLoading.value = true
    jumpserverNodesError.value = null
    jumpserverRootNodes.value = []
    jumpserverChildNodes.value = {}
    jumpserverExpandedNodeIds.value = {}
    jumpserverSelectedNodeId.value = null
    jumpserverNodeAssets.value = []
    // 重拉根层时一并丢弃旧树的 per-node loading 与代际，避免旧 loading 残留
    jumpserverNodeChildrenLoading.value = {}
    jumpserverNodeChildrenRequestIds = {}
    // L1：重拉根层时清空内联资产状态与代际
    jumpserverNodeAssetStates.value = {}
    jumpserverNodeInlineAssetRequestIds = {}
    // L1验收：重拉根层时清空 per-node 子节点错误
    jumpserverNodeChildrenErrors.value = {}

    const requestId = ++jumpserverRootNodesRequestId

    try {
      const result = await window.electronAPI.jumpserver.listNodes()
      if (requestId !== jumpserverRootNodesRequestId) return

      if (result.success) {
        let rootNodes = result.nodes

        // JumpServer 的 /nodes/children/ 不传 key 时，会把 Default 的子节点也平铺返回到根层。
        // 需要额外请求 Default 的直接子节点，把它们从根层移除，只保留在 Default 下面。
        const defaultNode = rootNodes.find((n) => n.name === 'Default')
        if (defaultNode) {
          try {
            const childrenResult = await window.electronAPI.jumpserver.listNodes(defaultNode.key)
            if (requestId !== jumpserverRootNodesRequestId) return
            if (childrenResult.success && childrenResult.nodes.length > 0) {
              const childIds = new Set(childrenResult.nodes.map((c) => c.nodeId))
              rootNodes = rootNodes.filter((n) => n.nodeId === defaultNode.nodeId || !childIds.has(n.nodeId))
              // 预填充 Default 的子节点缓存，用户展开 Default 时无需重复请求
              jumpserverChildNodes.value = { ...jumpserverChildNodes.value, [defaultNode.nodeId]: childrenResult.nodes }
            }
          } catch {
            // 额外请求失败不影响根层展示
          }
        }

        // 排序：收藏夹 > Default > 其余 > 未分组
        const SPECIAL_ORDER: Record<string, number> = { '收藏夹': 0, 'Default': 1, '未分组': 99 }
        rootNodes.sort((a, b) => {
          const oa = SPECIAL_ORDER[a.name] ?? 50
          const ob = SPECIAL_ORDER[b.name] ?? 50
          return oa - ob
        })

        jumpserverRootNodes.value = rootNodes
      } else {
        jumpserverNodesError.value = result.error || '拉取节点列表失败'
      }
    } catch (err: unknown) {
      if (requestId !== jumpserverRootNodesRequestId) return
      jumpserverNodesError.value = err instanceof Error ? err.message : '拉取节点列表失败'
    } finally {
      if (requestId === jumpserverRootNodesRequestId) {
        jumpserverRootNodesLoading.value = false
      }
    }
  }

  /**
   * 在根层或子层中查找节点的 path key（用于 nodes/children/?key=... 懒加载）
   */
  function findNodeKey(nodeId: string): string | null {
    const root = jumpserverRootNodes.value.find((n) => n.nodeId === nodeId)
    if (root) return root.key
    for (const children of Object.values(jumpserverChildNodes.value)) {
      const child = children.find((n) => n.nodeId === nodeId)
      if (child) return child.key
    }
    return null
  }

  /**
   * L1验收：展开/折叠节点。
   * 展开时立即置 expanded=true（不阻塞等子节点请求），并行触发内联资产 + 子节点懒加载。
   * 子节点加载失败写入 per-node 错误，不污染全局 jumpserverNodesError。
   */
  async function toggleJumpserverNode(nodeId: string): Promise<void> {
    const isExpanded = jumpserverExpandedNodeIds.value[nodeId]

    if (isExpanded) {
      // 折叠：只收起显示，不清空已加载缓存
      delete jumpserverExpandedNodeIds.value[nodeId]
      jumpserverExpandedNodeIds.value = { ...jumpserverExpandedNodeIds.value }
      // 收起时顺便清掉该节点的局部错误（重展开时重新请求）
      delete jumpserverNodeChildrenErrors.value[nodeId]
      jumpserverNodeChildrenErrors.value = { ...jumpserverNodeChildrenErrors.value }
      return
    }

    // L1验收：立即展开，不等待任何请求完成
    jumpserverExpandedNodeIds.value = { ...jumpserverExpandedNodeIds.value, [nodeId]: true }

    // 清除该节点旧有的局部错误（新一轮展开）
    delete jumpserverNodeChildrenErrors.value[nodeId]
    jumpserverNodeChildrenErrors.value = { ...jumpserverNodeChildrenErrors.value }

    // L1：触发内联资产加载（首次才请求，已加载过则复用缓存）
    fetchNodeAssetsInline(nodeId)

    // 如果已经加载过子节点，跳过子节点请求
    if (jumpserverChildNodes.value[nodeId]) {
      // 展开后发现子列表为空 → 修正 hasChildren
      if (jumpserverChildNodes.value[nodeId].length === 0) {
        updateNodeHasChildren(nodeId, false)
      }
      return
    }

    // 懒加载子节点：官方接口走 nodes/children/?key=node.key
    const parentKey = findNodeKey(nodeId)
    if (!parentKey) {
      // L1验收：写入 per-node 错误，不写全局
      jumpserverNodeChildrenErrors.value = { ...jumpserverNodeChildrenErrors.value, [nodeId]: '节点 key 缺失，无法读取子节点' }
      return
    }

    jumpserverNodeChildrenLoading.value = { ...jumpserverNodeChildrenLoading.value, [nodeId]: true }

    // 按节点隔离的代际控制：A、B 节点并发请求时互不污染
    const currentRequestId = (jumpserverNodeChildrenRequestIds[nodeId] ?? 0) + 1
    jumpserverNodeChildrenRequestIds[nodeId] = currentRequestId

    try {
      const result = await window.electronAPI.jumpserver.listNodes(parentKey)
      if (currentRequestId !== jumpserverNodeChildrenRequestIds[nodeId]) return

      if (result.success) {
        jumpserverChildNodes.value = { ...jumpserverChildNodes.value, [nodeId]: result.nodes }

        // 子列表为空 → 修正 hasChildren
        if (result.nodes.length === 0) {
          updateNodeHasChildren(nodeId, false)
        }
      } else {
        // L1验收：写入 per-node 错误，不写全局
        jumpserverNodeChildrenErrors.value = { ...jumpserverNodeChildrenErrors.value, [nodeId]: result.error || '拉取子节点失败' }
      }
    } catch (err: unknown) {
      if (currentRequestId !== jumpserverNodeChildrenRequestIds[nodeId]) return
      jumpserverNodeChildrenErrors.value = { ...jumpserverNodeChildrenErrors.value, [nodeId]: err instanceof Error ? err.message : '拉取子节点失败' }
    } finally {
      if (currentRequestId === jumpserverNodeChildrenRequestIds[nodeId]) {
        jumpserverNodeChildrenLoading.value = { ...jumpserverNodeChildrenLoading.value, [nodeId]: false }
      }
    }
  }

  /** 更新某节点的 hasChildren 标记（根层或子层） */
  function updateNodeHasChildren(nodeId: string, hasChildren: boolean): void {
    // 查找并更新根层
    const rootIdx = jumpserverRootNodes.value.findIndex((n) => n.nodeId === nodeId)
    if (rootIdx !== -1) {
      jumpserverRootNodes.value[rootIdx] = { ...jumpserverRootNodes.value[rootIdx], hasChildren }
      return
    }
    // 查找并更新子层
    const childNodes = jumpserverChildNodes.value
    for (const parentId of Object.keys(childNodes)) {
      const children = childNodes[parentId]
      const idx = children.findIndex((n) => n.nodeId === nodeId)
      if (idx !== -1) {
        childNodes[parentId] = [
          ...children.slice(0, idx),
          { ...children[idx], hasChildren },
          ...children.slice(idx + 1)
        ]
        jumpserverChildNodes.value = { ...childNodes }
        return
      }
    }
  }

  /** 选中节点并加载其资产列表 */
  async function selectJumpserverNode(nodeId: string): Promise<void> {
    jumpserverSelectedNodeId.value = nodeId
    jumpserverNodeAssetsLoading.value = true
    jumpserverNodeAssetsError.value = null
    jumpserverNodeAssets.value = []
    jumpserverNodeAssetsTotal.value = 0
    jumpserverNodeAssetsHasMore.value = false
    jumpserverNodeAssetsLoadingMore.value = false

    const requestId = ++jumpserverNodeAssetsRequestId

    try {
      const result = await window.electronAPI.jumpserver.listNodeAssets(nodeId)
      if (requestId !== jumpserverNodeAssetsRequestId) return

      if (result.success) {
        jumpserverNodeAssets.value = result.assets
        jumpserverNodeAssetsTotal.value = result.total
        jumpserverNodeAssetsHasMore.value = result.hasMore
      } else {
        jumpserverNodeAssetsError.value = result.error || '拉取节点资产失败'
      }
    } catch (err: unknown) {
      if (requestId !== jumpserverNodeAssetsRequestId) return
      jumpserverNodeAssetsError.value = err instanceof Error ? err.message : '拉取节点资产失败'
    } finally {
      if (requestId === jumpserverNodeAssetsRequestId) {
        jumpserverNodeAssetsLoading.value = false
      }
    }
  }

  /** 加载更多节点资产 */
  async function loadMoreJumpserverNodeAssets(): Promise<void> {
    if (!jumpserverNodeAssetsHasMore.value || jumpserverNodeAssetsLoadingMore.value) return
    if (!jumpserverSelectedNodeId.value) return

    jumpserverNodeAssetsLoadingMore.value = true
    const currentLoadMoreId = ++jumpserverNodeAssetsLoadMoreId

    const requestId = jumpserverNodeAssetsRequestId
    const nodeId = jumpserverSelectedNodeId.value

    try {
      const nextOffset = jumpserverNodeAssets.value.length
      const result = await window.electronAPI.jumpserver.listNodeAssets(nodeId, {
        offset: nextOffset
      })

      if (requestId !== jumpserverNodeAssetsRequestId) return

      if (result.success) {
        jumpserverNodeAssets.value.push(...result.assets)
        jumpserverNodeAssetsTotal.value = result.total
        jumpserverNodeAssetsHasMore.value = result.hasMore
      } else {
        jumpserverNodeAssetsError.value = result.error || '加载更多失败'
      }
    } catch (err: unknown) {
      if (requestId !== jumpserverNodeAssetsRequestId) return
      jumpserverNodeAssetsError.value = err instanceof Error ? err.message : '加载更多失败'
    } finally {
      if (currentLoadMoreId === jumpserverNodeAssetsLoadMoreId) {
        jumpserverNodeAssetsLoadingMore.value = false
      }
    }
  }

 /**
   * L1：获取某节点的当前内联资产状态（不存在则返回默认空态）。
   * 供 JumpserverNodeRow 读取。
   */
  function getNodeAssetState(nodeId: string): JumpserverNodeAssetState {
    return jumpserverNodeAssetStates.value[nodeId] ?? {
      assets: [],
      loading: false,
      error: null,
      hasMore: false,
      loadingMore: false,
      loaded: false
    }
  }

  /**
   * L1验收：读取某节点的子节点加载错误（无则返回 null）。
   * 供 JumpserverNodeRow 局部展示。
   */
  function getNodeChildrenError(nodeId: string): string | null {
    return jumpserverNodeChildrenErrors.value[nodeId] ?? null
  }

  /**
   * L1验收：重试某节点的子节点加载。
   * 清空该节点缓存的子节点数据 + 局部错误，然后直接重发子节点请求
   * （不调用 toggleJumpserverNode，因为节点已展开，调用会反而折叠它）。
   */
  async function retryNodeChildren(nodeId: string): Promise<void> {
    // 清除缓存的子节点数据
    delete jumpserverChildNodes.value[nodeId]
    jumpserverChildNodes.value = { ...jumpserverChildNodes.value }
    // 清除局部错误
    delete jumpserverNodeChildrenErrors.value[nodeId]
    jumpserverNodeChildrenErrors.value = { ...jumpserverNodeChildrenErrors.value }

    // 直接重发子节点加载请求
    const parentKey = findNodeKey(nodeId)
    if (!parentKey) {
      jumpserverNodeChildrenErrors.value = { ...jumpserverNodeChildrenErrors.value, [nodeId]: '节点 key 缺失，无法读取子节点' }
      return
    }

    jumpserverNodeChildrenLoading.value = { ...jumpserverNodeChildrenLoading.value, [nodeId]: true }
    const currentRequestId = (jumpserverNodeChildrenRequestIds[nodeId] ?? 0) + 1
    jumpserverNodeChildrenRequestIds[nodeId] = currentRequestId

    try {
      const result = await window.electronAPI.jumpserver.listNodes(parentKey)
      if (currentRequestId !== jumpserverNodeChildrenRequestIds[nodeId]) return

      if (result.success) {
        jumpserverChildNodes.value = { ...jumpserverChildNodes.value, [nodeId]: result.nodes }
        if (result.nodes.length === 0) updateNodeHasChildren(nodeId, false)
      } else {
        jumpserverNodeChildrenErrors.value = { ...jumpserverNodeChildrenErrors.value, [nodeId]: result.error || '拉取子节点失败' }
      }
    } catch (err: unknown) {
      if (currentRequestId !== jumpserverNodeChildrenRequestIds[nodeId]) return
      jumpserverNodeChildrenErrors.value = { ...jumpserverNodeChildrenErrors.value, [nodeId]: err instanceof Error ? err.message : '拉取子节点失败' }
    } finally {
      if (currentRequestId === jumpserverNodeChildrenRequestIds[nodeId]) {
        jumpserverNodeChildrenLoading.value = { ...jumpserverNodeChildrenLoading.value, [nodeId]: false }
      }
    }
  }

  /**
   * L1：加载某节点第一页资产（内联到树中）。
   * 首次展开时调用；已加载过的节点复用缓存不重复请求。
   */
  async function fetchNodeAssetsInline(nodeId: string): Promise<void> {
    const existing = jumpserverNodeAssetStates.value[nodeId]
    // 已加载过 → 复用缓存，不重复请求
    if (existing?.loaded) return

    jumpserverNodeAssetStates.value = {
      ...jumpserverNodeAssetStates.value,
      [nodeId]: {
        assets: [],
        loading: true,
        error: null,
        hasMore: false,
        loadingMore: false,
        loaded: false
      }
    }

    const currentRequestId = (jumpserverNodeInlineAssetRequestIds[nodeId] ?? 0) + 1
    jumpserverNodeInlineAssetRequestIds[nodeId] = currentRequestId

    try {
      const result = await window.electronAPI.jumpserver.listNodeAssets(nodeId)
      if (currentRequestId !== jumpserverNodeInlineAssetRequestIds[nodeId]) return

      if (result.success) {
        jumpserverNodeAssetStates.value = {
          ...jumpserverNodeAssetStates.value,
          [nodeId]: {
            assets: result.assets,
            loading: false,
            error: null,
            hasMore: result.hasMore,
            loadingMore: false,
            loaded: true
          }
        }
      } else {
        // 失败不置 loaded：折叠重开时会重新请求，与子节点加载语义一致
        jumpserverNodeAssetStates.value = {
          ...jumpserverNodeAssetStates.value,
          [nodeId]: {
            assets: [],
            loading: false,
            error: result.error || '拉取节点资产失败',
            hasMore: false,
            loadingMore: false,
            loaded: false
          }
        }
      }
    } catch (err: unknown) {
      if (currentRequestId !== jumpserverNodeInlineAssetRequestIds[nodeId]) return
      jumpserverNodeAssetStates.value = {
        ...jumpserverNodeAssetStates.value,
        [nodeId]: {
          assets: [],
          loading: false,
          error: err instanceof Error ? err.message : '拉取节点资产失败',
          hasMore: false,
          loadingMore: false,
          loaded: false
        }
      }
    }
  }

  /**
   * L1：重试某节点的内联资产加载（清空缓存后重新请求）。
   */
  async function retryNodeAssetsInline(nodeId: string): Promise<void> {
    // 清除缓存标记，让 fetchNodeAssetsInline 重新请求
    delete jumpserverNodeAssetStates.value[nodeId]
    jumpserverNodeAssetStates.value = { ...jumpserverNodeAssetStates.value }
    await fetchNodeAssetsInline(nodeId)
  }

  /**
   * L1：加载更多某节点的内联资产（下一页，追加）。
   */
  async function loadMoreNodeAssetsInline(nodeId: string): Promise<void> {
    const state = jumpserverNodeAssetStates.value[nodeId]
    if (!state || !state.hasMore || state.loadingMore) return

    jumpserverNodeAssetStates.value = {
      ...jumpserverNodeAssetStates.value,
      [nodeId]: { ...state, loadingMore: true }
    }

    const currentRequestId = (jumpserverNodeInlineAssetRequestIds[nodeId] ?? 0) + 1
    jumpserverNodeInlineAssetRequestIds[nodeId] = currentRequestId

    try {
      const nextOffset = state.assets.length
      const result = await window.electronAPI.jumpserver.listNodeAssets(nodeId, { offset: nextOffset })
      if (currentRequestId !== jumpserverNodeInlineAssetRequestIds[nodeId]) return

      const prev = jumpserverNodeAssetStates.value[nodeId]
      if (!prev) return

      if (result.success) {
        jumpserverNodeAssetStates.value = {
          ...jumpserverNodeAssetStates.value,
          [nodeId]: {
            ...prev,
            assets: [...prev.assets, ...result.assets],
            hasMore: result.hasMore,
            loadingMore: false
          }
        }
      } else {
        jumpserverNodeAssetStates.value = {
          ...jumpserverNodeAssetStates.value,
          [nodeId]: {
            ...prev,
            error: result.error || '加载更多失败',
            loadingMore: false
          }
        }
      }
    } catch (err: unknown) {
      if (currentRequestId !== jumpserverNodeInlineAssetRequestIds[nodeId]) return
      const prev = jumpserverNodeAssetStates.value[nodeId]
      if (!prev) return
      jumpserverNodeAssetStates.value = {
        ...jumpserverNodeAssetStates.value,
        [nodeId]: {
          ...prev,
          error: err instanceof Error ? err.message : '加载更多失败',
          loadingMore: false
        }
      }
    }
  }

  // ===== 快捷入口方法（P10）：收藏 + 最近使用 =====

  /** 加载当前 Jumpserver 配置下的收藏与最近使用 */
  async function loadJumpserverQuickAccess(): Promise<void> {
    if (!jumpserverConfig.value) {
      jumpserverFavorites.value = []
      jumpserverRecent.value = []
      return
    }
    jumpserverQuickAccessLoading.value = true
    try {
      const result = await window.electronAPI.jumpserver.getQuickAccess()
      jumpserverFavorites.value = result.favorites
      jumpserverRecent.value = result.recent
    } catch (err: unknown) {
      // 快捷入口加载失败不影响主链路，静默兜底
      jumpserverFavorites.value = []
      jumpserverRecent.value = []
    } finally {
      jumpserverQuickAccessLoading.value = false
    }
  }

  /** 清空内存中的快捷入口状态 */
  function clearJumpserverQuickAccess(): void {
    jumpserverFavorites.value = []
    jumpserverRecent.value = []
    jumpserverAccountPreferences.value = {}
  }

  // ===== 账号偏好方法（P12）=====

  /** 加载当前配置下的账号偏好表 */
  async function loadJumpserverAccountPreferences(): Promise<void> {
    if (!jumpserverConfig.value) {
      jumpserverAccountPreferences.value = {}
      return
    }
    try {
      jumpserverAccountPreferences.value = await window.electronAPI.jumpserver.getAccountPreferences()
    } catch {
      // 偏好加载失败不影响主链路，静默兜底
      jumpserverAccountPreferences.value = {}
    }
  }

  /** 读取某资产的偏好账号 ID（无则返回 null） */
  function getPreferredAccountId(assetId: string): string | null {
    return jumpserverAccountPreferences.value[assetId]?.accountId ?? null
  }

  /**
   * 写入某资产的偏好账号（仅应在终端连接真正成功后调用）。
   * 同一资产再次成功连接其它账号时，用新账号覆盖旧偏好。
   */
  async function saveJumpserverAccountPreference(
    assetId: string,
    accountId: string,
    accountName: string
  ): Promise<void> {
    if (!jumpserverConfig.value) return
    if (!assetId || !accountId) return
    try {
      jumpserverAccountPreferences.value = await window.electronAPI.jumpserver.saveAccountPreference(
        assetId,
        accountId,
        accountName
      )
    } catch {
      // 偏好写入失败不影响终端连接体验，静默兜底
    }
  }

  /** 切换某资产的收藏状态 */
  async function toggleJumpserverFavorite(asset: JumpserverAsset): Promise<void> {
    if (!jumpserverConfig.value) return
    try {
      const result = await window.electronAPI.jumpserver.toggleFavorite({
        assetId: asset.assetId,
        name: asset.name,
        address: asset.address,
        platform: asset.platform,
        comment: asset.comment
      })
      jumpserverFavorites.value = result.favorites
      jumpserverRecent.value = result.recent
    } catch (err: unknown) {
      // 静默兜底，避免收藏失败阻断主交互
    }
  }

  /** 记录某资产为最近使用（仅应在终端连接成功后调用） */
  async function recordJumpserverRecent(asset: JumpserverAsset): Promise<void> {
    if (!jumpserverConfig.value) return
    try {
      const result = await window.electronAPI.jumpserver.recordRecent({
        assetId: asset.assetId,
        name: asset.name,
        address: asset.address,
        platform: asset.platform,
        comment: asset.comment
      })
      jumpserverFavorites.value = result.favorites
      jumpserverRecent.value = result.recent
    } catch (err: unknown) {
      // 静默兜底，避免最近使用记录失败影响终端连接体验
    }
  }

  /** 判断某资产是否已被收藏 */
  function isJumpserverFavorite(assetId: string): boolean {
    return jumpserverFavorites.value.some((item) => item.assetId === assetId)
  }

  /** 拉取指定 JumpServer 资产的授权账号 */
  async function fetchJumpserverAccounts(assetId: string): Promise<void> {
    jumpserverSelectedAssetId.value = assetId
    jumpserverAccountsLoading.value = true
    jumpserverAccountsError.value = null
    jumpserverAccounts.value = []
    try {
      const result = await window.electronAPI.jumpserver.listAccounts(assetId)
      if (result.success) {
        jumpserverAccounts.value = result.accounts
        const connectable = result.accounts.some((account) => account.canConnect)
        jumpserverAssetConnectStates.value[getAssetConnectStateKey(assetId)] = connectable
          ? { status: 'connectable', message: null }
          : {
              status: 'blocked',
              message: result.accounts.length
                ? '当前资产下没有你可连接的账号'
                : '当前资产下没有任何授权账号'
            }
      } else {
        jumpserverAccountsError.value = result.error || '拉取账号列表失败'
      }
    } catch (err: unknown) {
      jumpserverAccountsError.value = err instanceof Error ? err.message : '拉取账号列表失败'
    } finally {
      jumpserverAccountsLoading.value = false
    }
  }

  /** 清除当前账号选择状态 */
  function clearJumpserverAccounts(): void {
    jumpserverSelectedAssetId.value = null
    jumpserverAccounts.value = []
    jumpserverAccountsError.value = null
  }

  async function prefetchJumpserverAssetConnectState(assetId: string): Promise<JumpserverAssetConnectState> {
    const key = getAssetConnectStateKey(assetId)
    const cached = jumpserverAssetConnectStates.value[key]
    if (cached && cached.status !== 'unknown') return cached

    const inflight = jumpserverAssetConnectRequests.get(key)
    if (inflight) return inflight

    jumpserverAssetConnectStates.value[key] = { status: 'loading', message: null }

    const request = (async () => {
      try {
        const result = await window.electronAPI.jumpserver.listAccounts(assetId)
        if (!result.success) {
          const nextState: JumpserverAssetConnectState = {
            status: 'unknown',
            message: result.error || '拉取账号列表失败'
          }
          jumpserverAssetConnectStates.value[key] = nextState
          return nextState
        }

        const connectable = result.accounts.some((account) => account.canConnect)
        const nextState: JumpserverAssetConnectState = connectable
          ? { status: 'connectable', message: null }
          : {
              status: 'blocked',
              message: result.accounts.length
                ? '当前资产下没有你可连接的账号'
                : '当前资产下没有任何授权账号'
            }
        jumpserverAssetConnectStates.value[key] = nextState
        return nextState
      } catch (err: unknown) {
        const nextState: JumpserverAssetConnectState = {
          status: 'unknown',
          message: err instanceof Error ? err.message : '拉取账号列表失败'
        }
        jumpserverAssetConnectStates.value[key] = nextState
        return nextState
      } finally {
        jumpserverAssetConnectRequests.delete(key)
      }
    })()

    jumpserverAssetConnectRequests.set(key, request)
    return await request
  }

  /**
   * 为选定的资产 + 账号创建连接令牌
   *
   * 主链路在内部会把 accountId 解析为 v3.7.1 ConnectionToken.account 真实所需的 account name
   * 字符串（参见 jumpserverClient.ts createJumpserverConnectionToken 实现）。
   */
  async function createJumpserverToken(
    assetId: string,
    accountId: string
  ): Promise<boolean> {
    jumpserverSessionLoading.value = true
    jumpserverSessionError.value = null
    jumpserverSessionParams.value = null
    try {
      const result = await window.electronAPI.jumpserver.createToken(assetId, accountId)
      if (result.success && result.params) {
        jumpserverSessionParams.value = result.params
        return true
      } else {
        jumpserverSessionError.value = result.error || '创建连接令牌失败'
        return false
      }
    } catch (err: unknown) {
      jumpserverSessionError.value = err instanceof Error ? err.message : '创建连接令牌失败'
      return false
    } finally {
      jumpserverSessionLoading.value = false
    }
  }

  /** 清除会话参数状态 */
  function clearJumpserverSession(): void {
    jumpserverSessionParams.value = null
    jumpserverSessionError.value = null
  }

  return {
    // 多实例配置（P14）
    jumpserverConfigs,
    jumpserverActiveConfigId,
    jumpserverConfig,
    jumpserverLoading,
    jumpserverAssets,
    jumpserverAssetsLoading,
    jumpserverAssetsError,
    jumpserverAssetsKeyword,
    jumpserverAssetsTotal,
    jumpserverAssetsHasMore,
    jumpserverAssetsLoadingMore,
    jumpserverSelectedAssetId,
    jumpserverAccounts,
    jumpserverAccountsLoading,
    jumpserverAccountsError,
    jumpserverAssetConnectStates,
    jumpserverSessionParams,
    jumpserverSessionLoading,
    jumpserverSessionError,
    // 节点树
    jumpserverRootNodes,
    jumpserverChildNodes,
    jumpserverRootNodesLoading,
    jumpserverNodeChildrenLoading,
    jumpserverNodeChildrenErrors,
    jumpserverNodesError,
    jumpserverExpandedNodeIds,
    jumpserverSelectedNodeId,
    jumpserverNodeAssets,
    jumpserverNodeAssetsLoading,
    jumpserverNodeAssetsError,
    jumpserverNodeAssetsTotal,
    jumpserverNodeAssetsHasMore,
    jumpserverNodeAssetsLoadingMore,
    // L1：树内联资产状态
    jumpserverNodeAssetStates,
    // 快捷入口
    jumpserverFavorites,
    jumpserverRecent,
    jumpserverQuickAccessLoading,
    // 账号偏好
    jumpserverAccountPreferences,
    // 手动刷新
    jumpserverRefreshing,
    // 配置管理
    fetchJumpserverConfig,
    saveJumpserverConfig,
    deleteJumpserverConfig,
    setActiveJumpserverConfig,
    fetchJumpserverConfigsOnly,
    testJumpserverConfig,
    getJumpserverSecret,
    // 资产列表
    fetchJumpserverAssets,
    searchJumpserverAssets,
    loadMoreJumpserverAssets,
    fetchJumpserverAccounts,
    prefetchJumpserverAssetConnectState,
    getJumpserverAssetConnectState,
    clearJumpserverAccounts,
    createJumpserverToken,
    clearJumpserverSession,
    // 节点树方法
    fetchJumpserverRootNodes,
    toggleJumpserverNode,
    selectJumpserverNode,
    loadMoreJumpserverNodeAssets,
    // L1：树内联资产方法
    getNodeAssetState,
    getNodeChildrenError,
    retryNodeChildren,
    fetchNodeAssetsInline,
    retryNodeAssetsInline,
    loadMoreNodeAssetsInline,
    // 快捷入口方法
    loadJumpserverQuickAccess,
    clearJumpserverQuickAccess,
    toggleJumpserverFavorite,
    recordJumpserverRecent,
    isJumpserverFavorite,
    // 账号偏好方法
    loadJumpserverAccountPreferences,
    getPreferredAccountId,
    saveJumpserverAccountPreference,
    // 运行时状态管理
    syncActiveConfig,
    clearJumpserverRuntimeState,
    // 手动刷新
    refreshJumpserverContext
  }
})
