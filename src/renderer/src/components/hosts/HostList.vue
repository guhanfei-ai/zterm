<template>
  <div class="host-list">
    <!-- 直连主机与文件夹共用持久化排序。 -->
    <DirectHostTree v-if="hostsStore.activeMode === 'direct'" :connected-host-ids="connectedHostIds"
      @add-host="$emit('add-host')" @connect="onHostClick" @edit="onEdit" @delete="onDelete" @context="showContextMenu" @folder-context="showFolderContextMenu" />

    <!-- 本地终端模式 -->
    <template v-else-if="hostsStore.activeMode === 'local'">
      <div class="local-terminal-panel">
        <button
          class="lt-add-btn"
          title="新建本地终端会话"
          @click="onLocalTerminal"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <span class="lt-hint">新建本地终端</span>
      </div>
    </template>

    <!-- Jumpserver 模式 -->
    <template v-else>
      <!-- 配置加载中 -->
      <div v-if="jumpserverStore.jumpserverLoading" class="list-placeholder">加载中...</div>
      <template v-else>
        <!-- 多实例切换器（P14）：始终展示当前活跃实例，≥2 个实例时尤为必要 -->
        <JumpserverInstanceSwitcher
          class="jumpserver-instance-switcher"
          @add="onAddInstance"
          @edit="onEditInstance"
        />

        <!-- 未配置 -->
        <div v-if="!jumpserverStore.jumpserverConfig" class="list-placeholder jumpserver-empty">
          <div class="jumpserver-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7zM9 12l2 2 4-5"/></svg></div>
          <div class="jumpserver-empty-title">未配置 Jumpserver</div>
          <div class="jumpserver-empty-desc">点击上方实例切换器新建配置</div>
        </div>

        <!-- 已配置：搜索框 + 资产列表区 -->
        <template v-else>
          <!-- 搜索框 -->
          <div class="jumpserver-search-bar">
            <input
              v-model="searchKeyword"
              class="jumpserver-search-input"
              type="text"
              placeholder="搜索资产..."
              @keyup.enter="onSearch"
            />
            <button v-if="searchKeyword" class="jumpserver-search-clear" title="清空搜索" @click="onClearSearch"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
            <button
              class="jumpserver-refresh-btn"
              :class="{ spinning: jumpserverStore.jumpserverRefreshing }"
              :disabled="jumpserverStore.jumpserverRefreshing"
              title="刷新当前视图"
              @click="onRefresh"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/></svg>
            </button>
          </div>

          <div v-if="jumpserverAssetHint" class="jumpserver-asset-hint">
            {{ jumpserverAssetHint }}
          </div>

          <!-- 无关键字 → 快捷入口 + 资产树浏览 -->
          <template v-if="!searchKeyword">
            <JumpserverQuickAccessSection
              title="收藏"
              :items="jumpserverStore.jumpserverFavorites"
              :is-favorite="jumpserverStore.isJumpserverFavorite"
              :collapsed="favoritesCollapsed"
              @toggle-collapsed="favoritesCollapsed = !favoritesCollapsed"
              @asset-click="onAssetClick"
              @toggle-favorite="jumpserverStore.toggleJumpserverFavorite"
            />
            <JumpserverNodeTree
              :collapsed="assetTreeCollapsed"
              @toggle-collapsed="assetTreeCollapsed = !assetTreeCollapsed"
              @asset-click="onAssetClick"
              @toggle-favorite="jumpserverStore.toggleJumpserverFavorite"
            />
            <JumpserverQuickAccessSection
              title="最近使用"
              :items="jumpserverStore.jumpserverRecent"
              :is-favorite="jumpserverStore.isJumpserverFavorite"
              :collapsed="recentCollapsed"
              show-when-empty
              @toggle-collapsed="recentCollapsed = !recentCollapsed"
              @asset-click="onAssetClick"
              @toggle-favorite="jumpserverStore.toggleJumpserverFavorite"
            />
          </template>

          <!-- 有关键字 → 搜索分页模式 -->
          <template v-else>
            <div v-if="jumpserverStore.jumpserverAssetsLoading" class="list-placeholder">正在拉取资产列表...</div>

            <div v-else-if="jumpserverStore.jumpserverAssetsError" class="list-placeholder jumpserver-error">
              <div class="jumpserver-empty-icon">⚠️</div>
              <div class="jumpserver-empty-title">拉取失败</div>
              <div class="jumpserver-empty-desc">{{ jumpserverStore.jumpserverAssetsError }}</div>
              <button class="btn-retry" @click="onRetry">重试</button>
            </div>

            <div v-else-if="!jumpserverStore.jumpserverAssets.length" class="list-placeholder jumpserver-empty">
              <div class="jumpserver-empty-icon">🔍</div>
              <div class="jumpserver-empty-title">未找到匹配资产</div>
              <div class="jumpserver-empty-desc">尝试更换关键字</div>
            </div>

            <template v-else>
              <div class="jumpserver-config-header">
                <span class="jumpserver-config-name">{{ jumpserverStore.jumpserverConfig.name }}</span>
              </div>
              <JumpserverAssetItem
                v-for="asset in jumpserverStore.jumpserverAssets"
                :key="asset.assetId"
                :asset="asset"
                :is-favorite="jumpserverStore.isJumpserverFavorite(asset.assetId)"
                :connect-state="jumpserverStore.getJumpserverAssetConnectState(asset.assetId).status"
                @click="onAssetClick"
                @toggle-favorite="jumpserverStore.toggleJumpserverFavorite"
              />

              <div v-if="jumpserverStore.jumpserverAssetsHasMore" class="jumpserver-load-more">
                <button
                  class="btn-load-more"
                  :disabled="jumpserverStore.jumpserverAssetsLoadingMore"
                  @click="jumpserverStore.loadMoreJumpserverAssets()"
                >
                  {{ jumpserverStore.jumpserverAssetsLoadingMore ? '加载中...' : '加载更多' }}
                </button>
              </div>
              <div class="jumpserver-assets-count">
                已加载 {{ jumpserverStore.jumpserverAssets.length }} / {{ jumpserverStore.jumpserverAssetsTotal }} 台
              </div>
            </template>
          </template>
        </template>
      </template>
    </template>

    <HostFormDialog
      v-if="editTarget !== undefined"
      :host="editTarget"
      :folder-id="createFolderId"
      @close="editTarget = undefined; createFolderId = undefined"
    />

    <!-- 多实例（P14）：Jumpserver 配置对话框挂在 HostList 内部，
         由 JumpserverInstanceSwitcher 通过 ref 触发 open/close，不再依赖 App.vue -->
    <JumpserverConfigLauncher ref="configLauncher" />

    <JumpserverAccountDialog
      v-if="accountDialogAsset !== null"
      :asset="accountDialogAsset"
      :accounts="jumpserverStore.jumpserverAccounts"
      :accounts-loading="jumpserverStore.jumpserverAccountsLoading"
      :accounts-error="jumpserverStore.jumpserverAccountsError"
      @close="closeAccountDialog"
      @success="closeAccountDialog"
    />

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenuHost !== null || contextMenuFolder !== null"
        class="host-context-menu"
        :style="{ left: contextMenuPos.x + 'px', top: contextMenuPos.y + 'px' }"
        @click.stop
      >
        <button v-if="contextMenuFolder" class="ctx-item ctx-item-button" :disabled="!hostsStore.treeLoaded || hostsStore.loading || hostsStore.treeSaving" @click="onCreateHostInFolder">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          创建主机
        </button>
        <template v-else-if="contextMenuHost">
        <div class="ctx-item" @click="onContextMenuConnect">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          连接服务器
        </div>
        <div class="ctx-divider" />
        <div class="ctx-item" @click="onEdit(contextMenuHost!); hideContextMenu()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          编辑主机
        </div>
        <div class="ctx-item" @click="onResetHostTrust(contextMenuHost!); hideContextMenu()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 3 3 9 9 9"/></svg>
          移除已信任指纹
        </div>
        <div class="ctx-item ctx-item-danger" @click="onDelete(contextMenuHost!); hideContextMenu()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          删除主机
        </div>
        </template>
      </div>
      <div v-if="contextMenuHost !== null || contextMenuFolder !== null" class="ctx-overlay" @click="hideContextMenu" @contextmenu.prevent="hideContextMenu" />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHostsStore } from '@/stores/hosts'
import { useJumpserverStore } from '@/stores/jumpserver'
import { useTerminalStore } from '@/stores/terminal'
import { useConfirm } from '@/composables/useConfirm'
import type { HostRecord } from '@/types/host'
import type { HostTreeFolder } from '@/utils/hostTree'
import type { JumpserverAsset } from '@/types/jumpserver'
import HostFormDialog from './HostFormDialog.vue'
import DirectHostTree from './DirectHostTree.vue'
import JumpserverAccountDialog from './JumpserverAccountDialog.vue'
import JumpserverNodeTree from './JumpserverNodeTree.vue'
import JumpserverAssetItem from './JumpserverAssetItem.vue'
import JumpserverQuickAccessSection from './JumpserverQuickAccessSection.vue'
import JumpserverInstanceSwitcher from './JumpserverInstanceSwitcher.vue'
import JumpserverConfigLauncher from './JumpserverConfigLauncher.vue'
import type { JumpserverConfig } from '@/types/jumpserver'
import { estimateTerminalSize } from '@/utils/terminalSize'

const { confirm } = useConfirm()

// 空主机列表的行动入口：转发给 PanelLeft → App.vue 的添加 / 导入流程
defineEmits<{
  'add-host': []
}>()

// 多实例（P14）：在 HostList 内部承接「新建 / 编辑实例」入口，
// 不再依赖 App.vue 改动。Launcher 用 ref 暴露 open/close，模板里挂一个空挂载点即可。
const configLauncher = ref<InstanceType<typeof JumpserverConfigLauncher> | null>(null)

function onAddInstance(): void {
  configLauncher.value?.open(null)
}

function onEditInstance(config: JumpserverConfig & { hasCredential: boolean }): void {
  // 编辑不切换活跃实例：仅打开对话框，由 store / launcher 负责不动 activeConfigId
  configLauncher.value?.open(config)
}

const hostsStore = useHostsStore()
const jumpserverStore = useJumpserverStore()
const terminalStore = useTerminalStore()
const connectedHostIds = computed(() => new Set(terminalStore.tabs
  .filter((tab) => tab.status === 'connected')
  .map((tab) => tab.hostId)
  .filter((id): id is string => typeof id === 'string')))
const editTarget = ref<HostRecord | null | undefined>(undefined)
const createFolderId = ref<string | undefined>()
const contextMenuHost = ref<HostRecord | null>(null)
const contextMenuFolder = ref<HostTreeFolder | null>(null)
const contextMenuPos = ref({ x: 0, y: 0 })
const accountDialogAsset = ref<JumpserverAsset | null>(null)
const jumpserverAssetHint = ref<string | null>(null)
const searchKeyword = ref('')
const favoritesCollapsed = ref(false)
const assetTreeCollapsed = ref(false)
const recentCollapsed = ref(false)

function onSearch(): void {
  const keyword = searchKeyword.value.trim()
  if (keyword) {
    jumpserverStore.searchJumpserverAssets(keyword)
  } else {
    // 空搜索 → 切回树浏览模式
    jumpserverStore.searchJumpserverAssets('') // 重置搜索状态
    jumpserverStore.fetchJumpserverRootNodes()
  }
}

function onClearSearch(): void {
  searchKeyword.value = ''
  jumpserverStore.searchJumpserverAssets('') // 重置搜索状态（清空 keyword）
  jumpserverStore.fetchJumpserverRootNodes()
}

function onRetry(): void {
  if (jumpserverStore.jumpserverAssetsKeyword) {
    jumpserverStore.searchJumpserverAssets(jumpserverStore.jumpserverAssetsKeyword)
  } else {
    jumpserverStore.fetchJumpserverAssets()
  }
}

function showContextMenu(e: MouseEvent, host: HostRecord): void {
  e.preventDefault()
  contextMenuFolder.value = null
  contextMenuHost.value = host
  contextMenuPos.value = { x: e.clientX, y: e.clientY }
}

function showFolderContextMenu(e: MouseEvent, folder: HostTreeFolder): void {
  e.preventDefault()
  contextMenuHost.value = null
  contextMenuFolder.value = folder
  contextMenuPos.value = { x: e.clientX, y: e.clientY }
}

function onCreateHostInFolder(): void {
  if (!contextMenuFolder.value) return
  createFolderId.value = contextMenuFolder.value.id
  editTarget.value = null
  hideContextMenu()
}

function hideContextMenu(): void {
  contextMenuHost.value = null
  contextMenuFolder.value = null
}

/** 手动刷新当前 Jumpserver 视图（搜索 / 根层 / 选中节点 / 快捷入口 + 账号偏好） */
async function onRefresh(): Promise<void> {
  jumpserverAssetHint.value = null
  await jumpserverStore.refreshJumpserverContext()
}

async function onAssetClick(asset: JumpserverAsset): Promise<void> {
  const connectState = await jumpserverStore.prefetchJumpserverAssetConnectState(asset.assetId)
  if (connectState.status === 'blocked') {
    jumpserverAssetHint.value = connectState.message || '当前资产暂无可连接账号'
    return
  }

  jumpserverAssetHint.value = null
  accountDialogAsset.value = asset
  // 打开新资产前清掉旧会话状态，避免旧 token 串到新资产
  jumpserverStore.clearJumpserverSession()
  jumpserverStore.fetchJumpserverAccounts(asset.assetId)
}

function closeAccountDialog(): void {
  accountDialogAsset.value = null
  jumpserverStore.clearJumpserverAccounts()
  // 关闭弹窗时清掉本轮会话状态
  jumpserverStore.clearJumpserverSession()
}

function onContextMenuConnect(): void {
  if (contextMenuHost.value) {
    onHostClick(contextMenuHost.value)
  }
  hideContextMenu()
}

async function onLocalTerminal(): Promise<void> {
  // 新建终端标签
  const targetTabId = terminalStore.addTab('local')
  terminalStore.switchTab(targetTabId)

  // 标记为本地终端
  terminalStore.setCurrentHostByTabId(targetTabId, '__local__', '本地终端')
  terminalStore.setStatusByTabId(targetTabId, 'connecting')

  const container = document.querySelector('.terminal-container')
  const { cols, rows } = estimateTerminalSize(container as HTMLElement | null)

  const result = await window.electronAPI.terminal.connectLocal(targetTabId, cols, rows)
  if (typeof result.generation === 'number') {
    terminalStore.setGenerationByTabId(targetTabId, result.generation)
  }
  if (!result.success) {
    terminalStore.setErrorByTabId(targetTabId, result.error || '启动本地终端失败')
    terminalStore.setStatusByTabId(targetTabId, 'disconnected')
  }
}

async function onHostClick(host: HostRecord): Promise<void> {
  // 统一入口：每次连接都新建并激活一个终端标签
  const targetTabId = terminalStore.addTab('direct')
  terminalStore.switchTab(targetTabId)

  hostsStore.setActiveHost(host.id)
  terminalStore.setCurrentHostByTabId(targetTabId, host.id, host.name)
  terminalStore.setStatusByTabId(targetTabId, 'connecting')

  const container = document.querySelector('.terminal-container')
  const { cols, rows } = estimateTerminalSize(container as HTMLElement | null)

  const result = await window.electronAPI.terminal.connect(targetTabId, host.id, cols, rows)
  if (typeof result.generation === 'number') {
    terminalStore.setGenerationByTabId(targetTabId, result.generation)
  }
  if (!result.success) {
    terminalStore.setErrorByTabId(targetTabId, result.error || '连接失败')
    terminalStore.setStatusByTabId(targetTabId, 'disconnected')
  }
}

function onEdit(host: HostRecord): void {
  createFolderId.value = undefined
  editTarget.value = { ...host }
}

async function onDelete(host: HostRecord): Promise<void> {
  const ok = await confirm('删除主机', `确定要删除主机「${host.name}」吗？`)
  if (ok) {
    await hostsStore.deleteHost(host.id)
    for (const tab of terminalStore.tabs) {
      if (tab.hostId === host.id) {
        await window.electronAPI.terminal.disconnect(tab.id)
        terminalStore.clearStateByTabId(tab.id)
      }
    }
  }
}

async function onResetHostTrust(host: HostRecord): Promise<void> {
  const ok = await confirm(
    '移除已信任指纹',
    `确定移除「${host.name}」的 SSH 主机信任记录吗？移除后不会自动重连。`
  )
  if (ok) {
    await window.electronAPI.terminal.resetHostTrust(host.id)
  }
}
</script>

<style scoped>
.host-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
}

.list-placeholder {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.7;
}

/* ===== 右键菜单 ===== */
.ctx-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.host-context-menu {
  position: fixed;
  z-index: 1000;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-control);
  box-shadow: var(--shadow-dialog);
  padding: 3px;
  min-width: 140px;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.ctx-item:hover {
  background: var(--surface-alt);
}

.ctx-item-button { width: 100%; border: 0; background: transparent; text-align: left; font-family: inherit; }
.ctx-item-button:disabled { opacity: .5; cursor: default; }

.ctx-item svg {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.ctx-divider {
  height: 1px;
  background: var(--divider-soft);
  margin: 4px 0;
}

.ctx-item-danger {
  color: var(--danger);
}

.ctx-item-danger svg {
  color: var(--danger);
}

/* ===== Jumpserver 占位态 ===== */
.jumpserver-empty {
  padding-top: 40px;
}

.jumpserver-empty-icon {
  font-size: 32px;
  margin-bottom: 12px;
  opacity: 0.6;
}

.jumpserver-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.jumpserver-empty-desc {
  font-size: 12px;
  color: var(--text-tertiary);
}

.jumpserver-asset-hint {
  margin: 8px 12px 10px;
  padding: 8px 10px;
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--warning, #d6a353) 12%, transparent);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

/* ===== Jumpserver 资产列表 ===== */
.jumpserver-error {
  padding-top: 40px;
}

.jumpserver-config-header {
  padding: 8px 12px 6px;
  border-bottom: 1px solid var(--divider);
  margin-bottom: 4px;
}

.jumpserver-config-name {
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.btn-retry {
  margin-top: 12px;
  padding: 4px 16px;
  border: 1px solid var(--divider);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: border-color 0.15s, color 0.15s;
}

.btn-retry:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* ===== Jumpserver 搜索与分页 ===== */
.jumpserver-instance-switcher {
  padding: 6px 10px;
  border-bottom: 1px solid var(--divider);
}

.jumpserver-search-bar {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--divider);
}

.jumpserver-search-input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  font-size: 12px;
  background: var(--bg);
  border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.15s;
}

.jumpserver-search-input:focus {
  border-color: var(--accent);
}

.jumpserver-search-input::placeholder {
  color: var(--text-tertiary);
}

.jumpserver-search-clear {
  margin-left: 6px;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.15s;
}

.jumpserver-search-clear:hover {
  color: var(--text-primary);
}

.jumpserver-refresh-btn {
  margin-left: 6px;
  padding: 2px 8px;
  font-size: 14px;
  line-height: 1;
  color: var(--text-tertiary);
  background: transparent;
  border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.jumpserver-refresh-btn:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
}

.jumpserver-refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.jumpserver-refresh-btn.spinning {
  animation: jumpserver-refresh-spin 0.9s linear infinite;
  color: var(--accent);
}

@keyframes jumpserver-refresh-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.jumpserver-load-more {
  text-align: center;
  padding: 8px 0;
}

.btn-load-more {
  padding: 4px 20px;
  border: 1px solid var(--divider);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: border-color 0.15s, color 0.15s;
}

.btn-load-more:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.btn-load-more:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.jumpserver-assets-count {
  text-align: center;
  padding: 4px 0 8px;
  font-size: 11px;
  color: var(--text-tertiary);
}

/* ===== 本地终端入口 ===== */
.local-terminal-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  gap: 10px;
}

.lt-add-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--divider);
  background: var(--surface-alt);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.lt-add-btn:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast, #fff);
}

.lt-add-btn:active {
  transform: scale(0.93);
}

.lt-add-btn svg {
  flex-shrink: 0;
}

.lt-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
}</style>
