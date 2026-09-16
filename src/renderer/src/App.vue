<template>
  <div class="app-shell" :style="{ '--nav-rail-width': NAV_RAIL_WIDTH + 'px' }">
    <!-- Custom Title Bar -->
    <TitleBar
      :show-left-panel-toggle="hostsStore.activeMode !== 'local'"
      :left-panel-visible="leftPanelVisible"
      :right-panel-visible="rightPanelVisible"
      @toggle-left-panel="toggleLeftPanel"
      @toggle-right-panel="toggleRightPanel"
    />

    <!-- Workspace View -->
    <div v-if="currentView === 'workspace'" class="app-container" :class="{ 'is-compact': compactWorkspace }">
      <!-- Nav Rail -->
      <NavRail
        :active-mode="hostsStore.activeMode"
        @set-mode="hostsStore.setActiveMode"
        @open-settings="openSettings"
        @open-about="openAbout"
      />

      <button
        v-if="compactWorkspace && (leftPanelShown || rightPanelVisible)"
        class="panel-scrim"
        aria-label="收起辅助面板"
        @click="closeAuxiliaryPanels"
      />

      <!-- Left Panel (hidden in local mode) -->
      <PanelLeft
        v-if="leftPanelShown"
        :width="leftPanelWidth"
        @add-host="showHostDialog = true"
        @export-hosts="onExportHosts"
        @show-key-manager="showKeyManager = true"
      />

      <!-- Left Resize Handle -->
      <div
        v-if="leftPanelShown && !compactWorkspace"
        class="left-resize-handle"
        :class="{ active: isLeftDragging }"
        @mousedown="onLeftDragStart"
        role="separator"
        aria-label="调整主机面板宽度"
        aria-orientation="vertical"
        :aria-valuenow="leftPanelWidth"
        tabindex="0"
        @keydown.left.prevent="resizeLeftBy(-16)"
        @keydown.right.prevent="resizeLeftBy(16)"
      ></div>

      <!-- Center Panel: Terminal -->
      <PanelCenter
        :active-mode="hostsStore.activeMode"
        @add-tab="tabSync.onAddTab"
        @add-local-tab="tabSync.onAddLocalTab"
        @close-terminal-tab="tabSync.onCloseTerminalTab"
        @disconnect="tabSync.handleDisconnect"
        @reconnect-terminal-tab="tabSync.reconnectTerminalTab"
        @show-hosts="showHostPanel"
      />

      <!-- Right Resize Handle -->
      <div
        v-if="rightPanelVisible && !compactWorkspace"
        class="resize-handle"
        :class="{ active: isDragging }"
        @mousedown="onDragStart"
        role="separator"
        aria-label="调整 AI 面板宽度"
        aria-orientation="vertical"
        :aria-valuenow="rightPanelWidth"
        tabindex="0"
        @keydown.left.prevent="resizeRightBy(16)"
        @keydown.right.prevent="resizeRightBy(-16)"
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { COMPACT_WORKSPACE_WIDTH, NAV_RAIL_WIDTH } from '@/constants/layout'
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
import AppUpdateToast from '@/components/common/AppUpdateToast.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ToastHost from '@/components/common/ToastHost.vue'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import WorkspaceRestoreDialog from '@/components/workspace/WorkspaceRestoreDialog.vue'
import SshHostTrustDialog from '@/components/hosts/SshHostTrustDialog.vue'

// ===== Stores =====
const hostsStore = useHostsStore()
const compactWorkspace = ref(window.innerWidth < COMPACT_WORKSPACE_WIDTH)
const leftPanelVisible = ref(!compactWorkspace.value)
const rightPanelVisible = ref(!compactWorkspace.value)
const leftPanelShown = computed(() => hostsStore.activeMode !== 'local' && leftPanelVisible.value)

function updateWorkspaceSize(): void {
  compactWorkspace.value = window.innerWidth < COMPACT_WORKSPACE_WIDTH
}

function closeAuxiliaryPanels(): void {
  leftPanelVisible.value = false
  rightPanelVisible.value = false
}

watch(compactWorkspace, (compact) => {
  if (compact) closeAuxiliaryPanels()
})
onMounted(() => window.addEventListener('resize', updateWorkspaceSize))
onUnmounted(() => window.removeEventListener('resize', updateWorkspaceSize))

// ===== Composables =====
const { leftPanelWidth, rightPanelWidth, isLeftDragging, isDragging, onLeftDragStart, onDragStart, resizeLeftBy, resizeRightBy } = useDragResize({ left: leftPanelShown, right: rightPanelVisible })
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

// ===== OpenSSH config 导出 =====

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
  if (compactWorkspace.value && leftPanelVisible.value) rightPanelVisible.value = false
}

function showHostPanel(): void {
  leftPanelVisible.value = true
  if (compactWorkspace.value) rightPanelVisible.value = false
}

function toggleRightPanel(): void {
  rightPanelVisible.value = !rightPanelVisible.value
  if (compactWorkspace.value && rightPanelVisible.value) leftPanelVisible.value = false
}
</script>

<style>
.app-shell  {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

.app-container  {
  display: flex;
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.panel  {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--workbench-panel-bg, var(--surface-muted));
}

.panel-left  {
  flex-shrink: 0;
  border-right: 1px solid var(--workbench-border, var(--divider));
}

.panel-center  {
  flex: 1;
  min-width: 360px;
  background: var(--workbench-terminal-bg, var(--bg));
}

.panel-right  {
  flex-shrink: 0;
  min-width: 300px;
  border-left: 1px solid var(--workbench-border, var(--divider));
}

.panel-heading  {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: var(--panel-header-height);
  min-height: var(--panel-header-height);
  padding: 0 12px;
  border-bottom: 1px solid var(--workbench-border-soft, var(--divider-soft));
}

.panel-heading h2  {
  font-size: 13px;
  line-height: 20px;
  font-weight: 600;
}

.left-resize-handle, .resize-handle  {
  width: 3px;
  flex-shrink: 0;
  cursor: col-resize;
  position: relative;
  z-index: 10;
  background: var(--workbench-panel-bg, var(--surface-muted));
}

.left-resize-handle::after, .resize-handle::after  {
  content: '';
  position: absolute;
  inset: 0 -2px;
}

.left-resize-handle:hover, .left-resize-handle.active, .resize-handle:hover, .resize-handle.active  {
  background: var(--accent);
}

.tab-bar  {
  display: flex;
  align-items: flex-end;
  height: var(--tabbar-height);
  min-height: var(--tabbar-height);
  background: var(--workbench-tabbar-bg, var(--surface-muted));
  border-bottom: 1px solid var(--workbench-border-soft, var(--divider-soft));
  padding: 0 10px;
  gap: 6px;
}

.tab-list  {
  display: flex;
  align-items: stretch;
  height: 100%;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.tab-list::-webkit-scrollbar  {
  height: 2px;
}

.tab-item  {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  margin-bottom: 0;
  padding: 0 10px;
  max-width: 200px;
  min-width: 88px;
  flex-shrink: 0;
  border: 0;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  white-space: nowrap;
  font-size: 12px;
  position: relative;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.tab-item:hover  {
  color: var(--text-primary);
}

.tab-item.active  {
  background: var(--workbench-tab-active-bg, var(--bg));
  color: var(--text-primary);
}

.tab-title  {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-status-dot  {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.tab-status-dot.connected  {
  background: var(--success);
}

.tab-status-dot.connecting  {
  background: var(--warning);
}

.tab-close  {
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  margin-left: auto;
}

.tab-item:hover .tab-close, .tab-item:focus-within .tab-close, .tab-item.active .tab-close  {
  opacity: 1;
}

.tab-close:hover  {
  background: var(--danger-muted);
  color: var(--danger);
}

.tab-add  {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.tab-add:hover  {
  background: var(--hover-overlay);
  color: var(--text-primary);
}

.tab-bar-actions  {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.terminal-container  {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
  background: var(--workbench-terminal-bg, var(--bg));
}

.terminal-empty-state  {
  position: absolute;
  inset: 0;
  gap: 10px;
}

.terminal-empty-state .empty-icon  {
  color: var(--accent);
  opacity: 0.8;
  margin-bottom: 14px;
}

.terminal-empty-state .empty-text  {
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.4px;
}

.terminal-empty-state .empty-hint  {
  max-width: 300px;
  font-size: 13px;
  line-height: 1.7;
}

.terminal-empty-btn  {
  margin-top: 16px;
  padding: 10px 18px;
  gap: 8px;
}

.panel-scrim  {
  position: absolute;
  inset: 0 0 0 var(--nav-rail-width);
  background: rgba(0, 0, 0, 0.32);
  border: 0;
  z-index: 20;
  cursor: pointer;
}

.is-compact .panel-left, .is-compact .panel-right  {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 21;
  max-width: calc(100% - var(--nav-rail-width) - 16px);
  box-shadow: var(--shadow-dialog);
}

.is-compact .panel-left  {
  left: var(--nav-rail-width);
}

.is-compact .panel-right  {
  right: 0;
}

.is-compact .panel-center  {
  min-width: 0;
}

@media (max-width: 600px)  {
  .panel-heading  {
    padding: 0 12px;
  }
  .panel-right  {
    min-width: 0;
  }
}
</style>
