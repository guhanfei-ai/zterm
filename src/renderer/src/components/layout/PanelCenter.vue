<template>
  <section class="panel panel-center" aria-label="终端工作区">
    <div class="tab-bar terminal-tab-bar">
      <div class="tab-list" role="tablist" aria-label="终端标签">
        <div v-for="tab in terminalTabs" :key="tab.id" class="tab-item"
          :class="{ active: tab.id === activeTerminalTabId }" role="tab"
          :aria-selected="tab.id === activeTerminalTabId" tabindex="0"
          @click="terminalStore.switchTab(tab.id)"
          @keydown.enter.prevent="terminalStore.switchTab(tab.id)"
          @keydown.space.prevent="terminalStore.switchTab(tab.id)">
          <span class="tab-status-dot" :class="tab.status" />
          <span class="tab-title" :title="tab.title">{{ tab.title }}</span>
          <button v-if="terminalTabs.length > 1" class="tab-close" title="关闭标签" @click.stop="onCloseTerminalTab(tab.id)" @keydown.stop>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M6 18 18 6"/></svg>
          </button>
        </div>
        <span v-if="!terminalTabs.length" class="terminal-no-tabs">尚未打开终端</span>
      </div>
      <button v-if="activeMode === 'local'" class="tab-add" title="新建本地终端" @click="onAddTab">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <div class="tab-bar-actions">
        <button class="btn-icon" title="搜索终端 (Cmd/Ctrl+F)" :disabled="!activeTerminalTabId" @click="onSearchActive">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 4 4"/></svg>
        </button>
        <button class="btn-icon" title="导出终端记录" :disabled="!activeTerminalTabId" @click="onExportActive">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15v5h16v-5M12 3v12m-4-4 4 4 4-4"/></svg>
        </button>
        <button v-if="activeTerminalStatus === 'connected'" class="btn-icon btn-danger" title="断开连接" @click="handleDisconnect">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 4H4v16h5m5-13 5 5-5 5M8 12h11"/></svg>
        </button>
      </div>
    </div>
    <div class="terminal-container">
      <div v-if="terminalTabs.length === 0" class="empty-state terminal-empty-state">
        <svg class="empty-icon" width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="38" height="32" rx="7"/><path d="m13 19 6 5-6 5m12 0h9"/></svg>
        <span class="empty-text">{{ activeMode === 'local' ? '从一行命令开始' : '连接你的工作环境' }}</span>
        <span class="empty-hint">{{ activeMode === 'local' ? '打开本地终端，让想法开始运行。' : activeMode === 'direct' ? '从主机列表选择一个环境，终端和 AI 将在这里协作。' : '选择 Jumpserver 资产，安全连接到远程环境。' }}</span>
        <button v-if="activeMode === 'local'" class="btn btn-primary terminal-empty-btn" @click="onAddLocalTab">打开命令行</button>
        <button v-else class="btn btn-secondary terminal-empty-btn" @click="emit('show-hosts')">{{ activeMode === 'direct' ? '浏览主机' : '浏览资产' }}</button>
      </div>
      <XtermPane v-for="tab in allTerminalTabs" :key="tab.id" :ref="(el) => setPaneRef(tab.id, el)"
        :tab-id="tab.id" v-show="tab.mode === activeMode && tab.id === activeTerminalTabId" @reconnect="onReconnectTerminalTab" />
    </div>
    <footer class="terminal-statusbar">
      <div class="terminal-status" :class="activeTerminalStatus"><span class="tab-status-dot" :class="activeTerminalStatus" />{{ statusLabel }}</div>
      <span class="terminal-status-host">{{ activeTerminal?.hostName || '等待连接' }}</span>
      <span class="terminal-status-mode">{{ modeLabel }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTerminalStore } from '@/stores/terminal'
import type { ActiveMode } from '@/stores/hosts'
import XtermPane from '@/components/terminal/XtermPane.vue'

const props = defineProps<{
  activeMode: ActiveMode
}>()

const emit = defineEmits<{
  'add-tab': []
  'show-hosts': []
  'add-local-tab': []
  'close-terminal-tab': [id: string]
  'disconnect': []
  'reconnect-terminal-tab': [id: string]
}>()

const terminalStore = useTerminalStore()
const activeTerminal = computed(() => terminalStore.getActiveTabByMode(props.activeMode))
const modeLabel = computed(() => ({ local: '本地 PTY', direct: 'SSH 直连', jumpserver: 'Jumpserver' })[props.activeMode])
const terminalTabs = computed(() => terminalStore.getTabsByMode(props.activeMode))
// 终端容器渲染全部 mode 的标签（v-show 控制可见性）：切换 mode 不卸载组件，
// 避免销毁窗口期内远端输出丢失、切回后画面空白。tab 栏仍只展示当前 mode。
const allTerminalTabs = computed(() => terminalStore.tabs)
const activeTerminalTabId = computed(() => terminalStore.getActiveTabIdByMode(props.activeMode))
const activeTerminalStatus = computed(() => terminalStore.getActiveTabByMode(props.activeMode)?.status || 'disconnected')

// 每个 tab 对应的 XtermPane 实例（v-show 保持挂载，ref 一直有效）
const paneRefs = new Map<string, InstanceType<typeof XtermPane>>()

function setPaneRef(tabId: string, el: unknown): void {
  if (el) {
    paneRefs.set(tabId, el as InstanceType<typeof XtermPane>)
  } else {
    paneRefs.delete(tabId)
  }
}

function onSearchActive(): void {
  paneRefs.get(activeTerminalTabId.value)?.openSearch()
}

function onExportActive(): void {
  void paneRefs.get(activeTerminalTabId.value)?.exportOutput()
}

const statusLabel = computed(() => {
  switch (activeTerminalStatus.value) {
    case 'connected':
      return '已连接'
    case 'connecting':
      return '连接中...'
    default:
      return '未连接'
  }
})

function onAddTab(): void {
  emit('add-tab')
}

function onAddLocalTab(): void {
  emit('add-local-tab')
}

function onCloseTerminalTab(id: string): void {
  emit('close-terminal-tab', id)
}

function handleDisconnect(): void {
  emit('disconnect')
}

function onReconnectTerminalTab(id: string): void {
  emit('reconnect-terminal-tab', id)
}
</script>

<style scoped>
.terminal-no-tabs  {
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* 标题栏已并入标签栏：操作按钮与 tab-add(28px) 对齐，视觉高度一致 */
.terminal-tab-bar .btn-icon  {
  width: 28px;
  height: 28px;
}

.terminal-tab-bar .tab-bar-actions  {
  align-self: flex-end;
}

.terminal-statusbar  {
  height: 28px;
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 14px;
  border-top: 1px solid var(--workbench-border-soft, var(--divider-soft));
  color: var(--text-tertiary);
  font-size: 11px;
}

.terminal-status  {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}

.terminal-status.connected  {
  color: var(--success);
}

.terminal-status.connecting  {
  color: var(--warning);
}

.terminal-status-host  {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-status-mode  {
  margin-left: auto;
  white-space: nowrap;
}
</style>
