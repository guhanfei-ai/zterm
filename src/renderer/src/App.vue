<template>
  <div class="app-shell">
    <!-- Custom Title Bar -->
    <TitleBar
      :show-left-panel-toggle="hostsStore.activeMode !== 'local'"
      :left-panel-visible="leftPanelVisible"
      :right-panel-visible="rightPanelVisible"
      @toggle-left-panel="toggleLeftPanel"
      @toggle-right-panel="toggleRightPanel"
    />

    <!-- Workspace View -->
    <div v-if="currentView === 'workspace'" class="app-container">
      <!-- Nav Rail -->
      <NavRail
        :active-mode="hostsStore.activeMode"
        @set-mode="hostsStore.setActiveMode"
        @open-settings="openSettings"
        @open-about="openAbout"
      />

      <!-- Left Panel (hidden in local mode) -->
      <PanelLeft
        v-if="hostsStore.activeMode !== 'local' && leftPanelVisible"
        :width="leftPanelWidth"
        @add-host="showHostDialog = true"
        @import-hosts="onImportHosts"
        @export-hosts="onExportHosts"
        @show-key-manager="showKeyManager = true"
      />

      <!-- Left Resize Handle -->
      <div
        v-if="hostsStore.activeMode !== 'local' && leftPanelVisible"
        class="left-resize-handle"
        :class="{ active: isLeftDragging }"
        @mousedown="onLeftDragStart"
      ></div>

      <!-- Center Panel: Terminal -->
      <PanelCenter
        :active-mode="hostsStore.activeMode"
        @add-tab="tabSync.onAddTab"
        @add-local-tab="tabSync.onAddLocalTab"
        @close-terminal-tab="tabSync.onCloseTerminalTab"
        @disconnect="tabSync.handleDisconnect"
        @reconnect-terminal-tab="tabSync.reconnectTerminalTab"
      />

      <!-- Right Resize Handle -->
      <div
        v-if="rightPanelVisible"
        class="resize-handle"
        :class="{ active: isDragging }"
        @mousedown="onDragStart"
      ></div>

      <!-- Right Panel: Chat -->
      <PanelRight
        v-if="rightPanelVisible"
        :width="rightPanelWidth"
        @close-chat-tab="tabSync.onCloseChatTab"
      />

      <!-- Dialogs -->
      <HostFormDialog v-if="showHostDialog" @close="showHostDialog = false" />
      <KeyManagerDialog v-if="showKeyManager" @close="showKeyManager = false" />
      <SshConfigImportDialog
        v-if="sshConfigImport"
        :hosts="sshConfigImport.hosts"
        :duplicates="sshConfigImport.duplicates"
        :skipped-blocks="sshConfigImport.skippedBlocks"
        @confirm="onImportConfirmed"
        @cancel="sshConfigImport = null"
      />
      <AppUpdateToast />
      <ToastHost />

      <!-- In-app Confirm Dialog：由 app-shell 顶层统一渲染（见下方说明） -->
    </div>

    <!-- Settings View -->
    <SettingsPage
      v-else-if="currentView === 'settings'"
      :initial-section="settingsSection"
      @back="closeSettings"
    />

    <!--
      Confirm Dialog 放在 app-shell 顶层而不是 workspace 容器内：
      settings 视图（如"关于 → 安装并重启"）也会调用 confirm()，
      若只随 workspace 渲染，settings 下调用会因对话框不存在而 Promise 永久挂起，
      并在返回工作台后出现滞留的幽灵弹窗。
    -->
    <ConfirmDialog
      v-if="confirmState.show"
      :title="confirmState.title"
      :message="confirmState.message"
      @confirm="confirmState.onConfirm"
      @cancel="confirmState.onCancel"
    />

    <WorkspaceRestoreDialog
      v-if="workspaceRestoreDialogState !== 'hidden'"
      :mode="workspaceRestoreDialogState === 'invalid' ? 'invalid' : 'restore'"
      :reason="workspaceRestoreDialogReason"
      @restore="restoreWorkspace"
      @discard="discardSavedWorkspace"
    />

    <SshHostTrustDialog
      v-if="sshHostTrust.isVisible.value && sshHostTrust.request.value"
      :request="sshHostTrust.request.value"
      @decision="sshHostTrust.respond"
      @dismiss="sshHostTrust.dismissChangedTrust"
      @reset="sshHostTrust.resetChangedTrust"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useHostsStore } from '@/stores/hosts'
import { useConfirm } from '@/composables/useConfirm'
import { useToast } from '@/composables/useToast'
import { useDragResize } from '@/composables/useDragResize'
import { useTerminalEvents } from '@/composables/useTerminalEvents'
import { useTabSync } from '@/composables/useTabSync'
import { useWorkspaceRestore } from '@/composables/useWorkspaceRestore'
import { useSshHostTrust } from '@/composables/useSshHostTrust'
import { setupAgentGlobalEvents } from '@/composables/useAgentGlobalEvents'

import TitleBar from '@/components/layout/TitleBar.vue'
import NavRail from '@/components/layout/NavRail.vue'
import PanelLeft from '@/components/layout/PanelLeft.vue'
import PanelCenter from '@/components/layout/PanelCenter.vue'
import PanelRight from '@/components/layout/PanelRight.vue'

import HostFormDialog from '@/components/hosts/HostFormDialog.vue'
import KeyManagerDialog from '@/components/keys/KeyManagerDialog.vue'
import SshConfigImportDialog from '@/components/hosts/SshConfigImportDialog.vue'
import AppUpdateToast from '@/components/common/AppUpdateToast.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ToastHost from '@/components/common/ToastHost.vue'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import WorkspaceRestoreDialog from '@/components/workspace/WorkspaceRestoreDialog.vue'
import SshHostTrustDialog from '@/components/hosts/SshHostTrustDialog.vue'
import type { ParsedSshConfigHost } from '../../main/services/sshConfigFile'

// ===== Stores =====
const hostsStore = useHostsStore()

// ===== Composables =====
const { leftPanelWidth, rightPanelWidth, isLeftDragging, isDragging, onLeftDragStart, onDragStart } = useDragResize()
const sshHostTrust = useSshHostTrust()
useTerminalEvents({ onHostTrustRequired: sshHostTrust.handleHostTrustRequired })
const tabSync = useTabSync()
const {
  dialogState: workspaceRestoreDialogState,
  dialogReason: workspaceRestoreDialogReason,
  restoreWorkspace,
  discardSavedWorkspace
} = useWorkspaceRestore()
const { confirmState } = useConfirm()
const { info, success, error } = useToast()
// 应用级 Agent 全局事件监听：注册一次、常驻应用存活期。
// 不随右侧聊天面板 v-if 卸载而注销，避免后台执行中的任务事件丢失。
setupAgentGlobalEvents()

// ===== View switching =====
type AppView = 'workspace' | 'settings'
const currentView = ref<AppView>('workspace')
const settingsSection = ref('model')

function openSettings(): void {
  settingsSection.value = 'model'
  currentView.value = 'settings'
}

function openAbout(): void {
  settingsSection.value = 'about'
  currentView.value = 'settings'
}

function closeSettings(): void {
  currentView.value = 'workspace'
}

// ===== Dialogs =====
const showHostDialog = ref(false)
const showKeyManager = ref(false)
const leftPanelVisible = ref(true)
const rightPanelVisible = ref(true)

// ===== OpenSSH config 导入 / 导出 =====
const sshConfigImport = ref<{
  hosts: ParsedSshConfigHost[]
  duplicates: boolean[]
  skippedBlocks: number
} | null>(null)

async function onImportHosts(): Promise<void> {
  const result = await window.electronAPI.hosts.importSshConfig()
  if (result.canceled) return
  if ('error' in result && result.error) {
    error(`导入失败: ${result.error}`)
    return
  }
  if (!('hosts' in result)) return
  if (!result.hosts.length) {
    info('配置文件中没有找到可导入的主机（通配符块和 Match 块不会导入）')
    return
  }
  sshConfigImport.value = {
    hosts: result.hosts,
    duplicates: result.duplicates,
    skippedBlocks: result.skippedBlocks
  }
}

async function onImportConfirmed(): Promise<void> {
  sshConfigImport.value = null
  await hostsStore.fetchHosts()
  await hostsStore.applyStoredOrder()
}

async function onExportHosts(): Promise<void> {
  const result = await window.electronAPI.hosts.exportSshConfig()
  if (result.success && result.filePath) {
    success(`已导出到: ${result.filePath}\n注意：密码和密钥内容不会包含在导出文件中`)
  } else if (!result.success) {
    error(`导出失败: ${result.error || '未知错误'}`)
  }
}

function toggleLeftPanel(): void {
  if (hostsStore.activeMode === 'local') return
  leftPanelVisible.value = !leftPanelVisible.value
}

function toggleRightPanel(): void {
  rightPanelVisible.value = !rightPanelVisible.value
}
</script>

<style>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

/* ===== 自定义标题栏 ===== */
.title-bar {
  display: flex;
  align-items: center;
  height: 32px;
  flex-shrink: 0;
  background: var(--chrome-bar-bg);
  border-bottom: 1px solid var(--workbench-border-soft, var(--divider-soft));
}

.title-bar-side {
  width: 96px;
  flex-shrink: 0;
  -webkit-app-region: drag;
  user-select: none;
}

.title-bar-side.mac {
  width: 96px;
}

.title-bar-center {
  flex: 1;
  display: flex;
  justify-content: center;
  -webkit-app-region: drag;
  user-select: none;
}

.title-bar-text {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 500;
  letter-spacing: 0.3px;
}

.title-bar-controls {
  display: flex;
  -webkit-app-region: no-drag;
}

.win-btn {
  width: 40px;
  height: 34px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.win-btn:hover {
  background: var(--workbench-tab-hover-bg, var(--divider));
  color: var(--text-secondary);
}

.win-btn-close:hover {
  background: var(--danger);
  color: #fff;
}

/* ===== 三栏工作台布局 ===== */
.app-container {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.panel {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--workbench-border, var(--divider));
  background: var(--workbench-panel-bg, var(--surface));
}

.panel-left {
  flex-shrink: 0;
}

.panel-center {
  flex: 1;
  min-width: 300px;
  min-height: 0;
  background: var(--workbench-terminal-bg, var(--bg));
}

/* ===== Resize Handles ===== */
.left-resize-handle {
  width: 3px;
  cursor: col-resize;
  background: transparent;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
  transition: background 0.15s;
}

.left-resize-handle:hover,
.left-resize-handle.active {
  background: var(--workbench-resize-hover, var(--accent));
}

.resize-handle {
  width: 3px;
  cursor: col-resize;
  background: transparent;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
  transition: background 0.15s;
}

.resize-handle:hover,
.resize-handle.active {
  background: var(--workbench-resize-hover, var(--accent));
}

.panel-right {
  min-width: 280px;
  flex-shrink: 0;
  border-right: none;
  border-left: none;
  background: var(--workbench-panel-muted-bg, var(--surface-muted));
}

/* ===== 左侧双层顶区 ===== */
.left-panel-top {
  display: flex;
  flex-direction: column;
  background: var(--workbench-panel-muted-bg, var(--surface-muted));
  border-bottom: 1px solid var(--workbench-border, var(--divider));
  flex-shrink: 0;
}

.left-panel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px;
  min-height: 34px;
  flex-shrink: 0;
}

.left-panel-context-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.3px;
}

.panel-actions {
  display: flex;
  gap: 4px;
}

/* ===== 标签条 ===== */
.tab-bar {
  display: flex;
  align-items: center;
  height: 32px;
  background: var(--workbench-tabbar-bg, var(--surface-muted));
  border-bottom: 1px solid var(--workbench-border-soft, var(--divider-soft));
  flex-shrink: 0;
  padding: 0 4px;
  gap: 1px;
}

.tab-list {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.tab-list::-webkit-scrollbar {
  height: 0;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  height: 24px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-tertiary);
  background: transparent;
  transition: all var(--transition-fast);
  flex-shrink: 0;
  max-width: 160px;
  border-bottom: 2px solid transparent;
}

.tab-item:hover {
  background: var(--workbench-tab-hover-bg, var(--hover-overlay));
  color: var(--text-secondary);
}

.tab-item.active {
  background: var(--workbench-tab-active-bg, var(--surface));
  color: var(--text-primary);
  border-bottom-color: var(--accent);
  font-weight: 500;
}

.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.tab-status-dot.connected {
  background: var(--success);
}

.tab-status-dot.connecting {
  background: var(--warning);
}

.tab-status-dot.disconnected {
  background: var(--text-disabled);
}

.tab-close {
  display: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  border-radius: 3px;
  flex-shrink: 0;
  padding: 0;
}

.tab-item:hover .tab-close {
  display: flex;
}

.tab-close:hover {
  background: var(--workbench-close-hover-bg, var(--danger-muted));
  color: var(--danger);
}

.tab-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: 6px;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}

.tab-add:hover {
  background: var(--workbench-tab-hover-bg, var(--surface-alt));
  color: var(--text-primary);
}

.tab-bar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
}

/* ===== 终端容器 ===== */
.terminal-container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--workbench-terminal-bg, var(--bg));
  position: relative;
}

/* ===== 终端空状态 ===== */
.terminal-empty-state {
  position: absolute;
  inset: 0;
  gap: var(--space-sm);
}

.terminal-empty-state .empty-icon {
  opacity: 0.3;
  color: var(--text-secondary);
  margin-bottom: var(--space-xs);
}

.terminal-empty-btn {
  margin-top: var(--space-sm);
  padding: 8px 20px;
  font-size: 13px;
  gap: 6px;
  border-radius: var(--radius-control);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: all var(--transition-fast);
}

.terminal-empty-btn:hover:not(:disabled) {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  transform: translateY(-1px);
}

.terminal-empty-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

/* ===== L2：最左竖向导航栏 ===== */
.nav-rail {
  width: 48px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--chrome-rail-bg);
  border-right: 1px solid var(--chrome-rail-border, var(--divider));
  user-select: none;
}

.nav-rail-top {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 10px 0;
}

.nav-rail-spacer {
  flex: 1;
}

.nav-rail-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 10px 0;
}

.nav-rail-btn {
  width: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 4px 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;
}

.nav-rail-btn:hover {
  color: var(--text-secondary);
  background: var(--workbench-rail-hover-bg, var(--hover-overlay));
}

.nav-rail-btn.active {
  color: #fff;
  background: var(--workbench-rail-active-bg, var(--accent));
}

.nav-rail-label {
  font-size: 9px;
  line-height: 1.2;
  letter-spacing: 0.2px;
  text-align: center;
  word-break: keep-all;
}
</style>
