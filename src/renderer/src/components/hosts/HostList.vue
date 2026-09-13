<template>
  <div class="host-list">
    <!-- 直连模式 -->
    <template v-if="hostsStore.activeMode === 'direct'">
      <label v-if="hostsStore.hosts.length" class="host-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 4 4"/></svg>
        <input v-model="hostFilter" type="search" aria-label="搜索主机、地址或用户" placeholder="搜索主机、地址或用户" />
      </label>
      <div v-if="hostsStore.loading" class="list-placeholder">加载中...</div>
      <div v-else-if="!hostsStore.hosts.length" class="list-placeholder host-empty-state">
        <div class="jumpserver-empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/></svg></div>
        <div class="jumpserver-empty-title">暂无主机</div>
        <div class="jumpserver-empty-desc">添加一台主机，或从已有的 OpenSSH 配置文件导入</div>
        <div class="host-empty-actions">
          <button class="host-empty-btn primary" @click="$emit('add-host')">添加主机</button>
          <button class="host-empty-btn" @click="$emit('import-hosts')">导入 OpenSSH 配置</button>
        </div>
      </div>
      <div
        v-for="{ host, index } in visibleHosts"
        :key="host.id"
        class="host-item-wrapper"
      >
        <div
          v-if="!hostFilter.trim()"
          :data-drop-index="index"
          class="drop-indicator-zone"
          @dragover.prevent="onDragOverZone($event, index)"
          @drop.prevent="onDropOnZone($event, index)"
        />
        <div
          :data-host-id="host.id"
          class="host-item"
          :class="{ active: hostsStore.activeHostId === host.id }"
          :draggable="!hostFilter.trim()"
          role="button"
          tabindex="0"
          :aria-label="`连接 ${host.name}`"
          @keydown.enter.self.prevent="onHostClick(host)"
          @keydown.space.self.prevent="onHostClick(host)"
          @click="onHostClick(host)"
          @dragstart="onDragStart($event, host)"
          @dragover.prevent="onDragOver($event, host)"
          @drop.prevent="onDrop($event, host)"
          @dragend="onDragEnd"
          @contextmenu="showContextMenu($event, host)"
        >
          <div class="drag-handle" :title="hostFilter.trim() ? '清空搜索后可拖动排序' : '拖动排序'"><svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="4" cy="4" r="1"/><circle cx="8" cy="4" r="1"/><circle cx="4" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="8" cy="12" r="1"/></svg></div>
          <span class="host-connection-dot" :class="{ connected: connectedHostIds.has(host.id) }" :title="connectedHostIds.has(host.id) ? '已有连接' : '未连接'" />
          <div class="host-item-info">
            <div class="host-name">{{ host.name }}</div>
            <div class="host-detail">{{ host.username }}@{{ host.host }}:{{ host.port }}</div>
          </div>
          <div class="host-item-actions">
            <button
              class="btn-icon tiny"
              title="编辑主机"
              @click.stop="onEdit(host)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m16 4 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg>
            </button>
            <button
              class="btn-icon tiny btn-danger"
              title="删除主机"
              @click.stop="onDelete(host)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 3h6l1 4H8zm-3 4 1 14h12l1-14M10 11v6m4-6v6"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="!hostFilter.trim()"
        :data-drop-index="hostsStore.hosts.length"
        class="drop-indicator-zone"
        @dragover.prevent="onDragOverZone($event, hostsStore.hosts.length)"
        @drop.prevent="onDropOnZone($event, hostsStore.hosts.length)"
      />
      <div v-if="hostsStore.hosts.length && !visibleHosts.length" class="list-placeholder">未找到匹配主机</div>
      <div v-if="hostsStore.hosts.length" class="host-count">{{ hostFilter.trim() ? `${visibleHosts.length} / ${hostsStore.hosts.length}` : hostsStore.hosts.length }} 台主机</div>
    </template>

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
      @close="editTarget = undefined"
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
        v-if="contextMenuHost !== null"
        class="host-context-menu"
        :style="{ left: contextMenuPos.x + 'px', top: contextMenuPos.y + 'px' }"
        @click.stop
      >
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
      </div>
      <div v-if="contextMenuHost !== null" class="ctx-overlay" @click="hideContextMenu" />
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
import type { JumpserverAsset } from '@/types/jumpserver'
import HostFormDialog from './HostFormDialog.vue'
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
  'import-hosts': []
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
const hostFilter = ref('')
const visibleHosts = computed(() => {
  const keyword = hostFilter.value.trim().toLocaleLowerCase()
  return hostsStore.hosts.map((host, index) => ({ host, index })).filter(({ host }) =>
    `${host.name} ${host.host} ${host.username}`.toLocaleLowerCase().includes(keyword)
  )
})
const connectedHostIds = computed(() => new Set(terminalStore.tabs
  .filter((tab) => tab.status === 'connected' && tab.hostId)
  .map((tab) => tab.hostId)))
const editTarget = ref<HostRecord | null | undefined>(undefined)
const contextMenuHost = ref<HostRecord | null>(null)
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
  contextMenuHost.value = host
  contextMenuPos.value = { x: e.clientX, y: e.clientY }
}

function hideContextMenu(): void {
  contextMenuHost.value = null
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

function reorderHostsByDrag(newOrder: HostRecord[]): void {
  hostsStore.hosts.splice(0, hostsStore.hosts.length, ...newOrder)
  hostsStore.saveHostOrder(newOrder.map((h) => h.id))
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

let dragSourceId: string | null = null
let dragTargetIndex: number | null = null

function clearDropIndicators(): void {
  document.querySelectorAll('.drop-indicator-zone').forEach((el) => el.classList.remove('active'))
}

function onDragStart(e: DragEvent, host: HostRecord): void {
  dragSourceId = host.id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-host-id="${host.id}"]`)
    if (el) el.classList.add('dragging')
  })
}

function onDragOver(e: DragEvent, host: HostRecord): void {
  if (!dragSourceId || host.id === dragSourceId) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragTargetIndex = hostsStore.hosts.findIndex((h) => h.id === host.id)
}

function onDragOverZone(e: DragEvent, index: number): void {
  if (!dragSourceId) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  clearDropIndicators()
  const zone = document.querySelector(`[data-drop-index="${index}"]`)
  if (zone) zone.classList.add('active')
  dragTargetIndex = index
}

function onDropOnZone(e: DragEvent, dropIndex: number): void {
  e.preventDefault()
  if (!dragSourceId) return
  const srcIdx = hostsStore.hosts.findIndex((h) => h.id === dragSourceId)
  if (srcIdx === -1) return
  if (srcIdx === dropIndex || srcIdx === dropIndex - 1) {
    clearDropIndicators()
    dragSourceId = null
    dragTargetIndex = null
    return
  }
  const newList = [...hostsStore.hosts]
  const [moved] = newList.splice(srcIdx, 1)
  const dstIdx = srcIdx < dropIndex ? dropIndex - 1 : dropIndex
  newList.splice(dstIdx, 0, moved)
  reorderHostsByDrag(newList)
  clearDropIndicators()
  dragSourceId = null
  dragTargetIndex = null
}

function onDrop(e: DragEvent, host: HostRecord): void {
  e.preventDefault()
  if (!dragSourceId || host.id === dragSourceId) return
  const srcIdx = hostsStore.hosts.findIndex((h) => h.id === dragSourceId)
  const dstIdx = hostsStore.hosts.findIndex((h) => h.id === host.id)
  if (srcIdx === -1 || dstIdx === -1) return
  const newList = [...hostsStore.hosts]
  const [moved] = newList.splice(srcIdx, 1)
  // 与 onDropOnZone 语义对齐：向下拖拽时源项已先移除，目标索引需前移一位（插到目标项之前）
  const insertIdx = srcIdx < dstIdx ? dstIdx - 1 : dstIdx
  newList.splice(insertIdx, 0, moved)
  reorderHostsByDrag(newList)
  dragSourceId = null
}

function onDragEnd(): void {
  document.querySelectorAll('.host-item.dragging').forEach((el) => el.classList.remove('dragging'))
  clearDropIndicators()
  dragSourceId = null
  dragTargetIndex = null
}
</script>

<style scoped>
.host-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
}

.host-search { display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin: 0 2px 12px; padding: 8px 10px; min-height: 34px; border: 1px solid var(--divider); border-radius: var(--radius-control); background: var(--bg); color: var(--text-tertiary); }
.host-search:focus-within { border-color: var(--accent); }
.host-search svg { flex-shrink: 0; }
.host-search input { min-width: 0; width: 100%; font-size: 11px; line-height: 18px; color: var(--text-primary); background: transparent; border: 0; outline: 0; }
.host-search input::placeholder { color: var(--text-tertiary); }
.host-count { margin-top: auto; padding: 18px 10px 4px; font-size: 11px; color: var(--text-tertiary); }
.host-connection-dot { width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: var(--text-tertiary); margin-right: 10px; }
.host-connection-dot.connected { background: var(--success); }

.list-placeholder {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.7;
}

/* ===== 直连模式空主机列表 ===== */
.host-empty-state {
  padding-top: 40px;
}

.host-empty-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

.host-empty-btn {
  width: 180px;
  padding: 7px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--surface-alt);
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}

.host-empty-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.host-empty-btn.primary {
  color: var(--accent-contrast, #fff);
  background: var(--accent);
  border-color: var(--accent);
}

.host-empty-btn.primary:hover {
  opacity: 0.9;
  color: var(--accent-contrast, #fff);
}

.host-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 8px;
  min-height: 56px;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: var(--radius-card);
  transition: all var(--transition-fast);
  position: relative;
}

.host-item:hover {
  background: var(--hover-overlay);
}

.host-item.active {
  background: color-mix(in srgb, var(--accent) 8%, var(--surface-muted));
  border-color: transparent;
  box-shadow: 0 2px 12px color-mix(in srgb, var(--accent) 8%, transparent);
}

.host-item-info {
  flex: 1;
  min-width: 0;
  padding-right: 32px;
}

.host-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.host-detail {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 3px;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-item-actions {
  display: flex;
  flex-direction: column;
  gap: 0;
  position: absolute;
  right: 6px;
  top: 4px;
  opacity: 0;
  pointer-events: none;
}

.host-item:hover .host-item-actions, .host-item:focus-within .host-item-actions {
  opacity: 1;
  pointer-events: auto;
}

.btn-icon.tiny {
  width: 24px;
  height: 24px;
  font-size: 12px;
}

.drag-handle {
  cursor: grab;
  color: var(--text-tertiary);
  position: absolute;
  left: -3px;
  opacity: 0;
  font-size: 14px;
  letter-spacing: -1px;
  user-select: none;
  flex-shrink: 0;
}

.drag-handle:active {
  cursor: grabbing;
}

.host-item.dragging {
  opacity: 0.5;
  transform: scale(1.02);
}

.drop-indicator-zone {
  height: 4px;
  margin: 0 14px;
  border-radius: 2px;
  background: transparent;
  transition: background var(--transition-fast), height var(--transition-fast);
  position: relative;
}

.drop-indicator-zone.active {
  height: 6px;
  background: var(--accent);
}

.drop-indicator-zone.active::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -3px;
  height: 4px;
  border-radius: 2px;
  background: var(--accent);
}

.host-item[draggable]:hover .drag-handle {
  color: var(--text-secondary);
  opacity: 1;
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

.jumpserver-placeholder {
  padding: 24px 16px;
  text-align: center;
}

.jumpserver-placeholder-icon {
  font-size: 28px;
  margin-bottom: 10px;
}

.jumpserver-placeholder-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.jumpserver-placeholder-detail {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 12px;
}

.jumpserver-url {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
}

.jumpserver-placeholder-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  font-style: italic;
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

.host-detail-sep {
  margin: 0 4px;
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
