<template>
  <div class="panel panel-center">
    <!-- Terminal Tab Bar：始终展示，保证不同模式下顶区结构稳定 -->
    <div class="tab-bar terminal-tab-bar">
      <button
        v-if="activeMode === 'local'"
        class="tab-add"
        title="新建本地终端"
        @click="onAddTab"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <div class="tab-list">
        <div
          v-for="tab in terminalTabs"
          :key="tab.id"
          class="tab-item"
          :class="{ active: tab.id === activeTerminalTabId }"
          @click="terminalStore.switchTab(tab.id)"
        >
          <span class="tab-title">{{ tab.title }}</span>
          <span class="tab-status-dot" :class="tab.status"></span>
          <button
            v-if="terminalTabs.length > 1"
            class="tab-close"
            title="关闭标签"
            @click.stop="onCloseTerminalTab(tab.id)"
          >&times;</button>
        </div>
      </div>
      <div class="tab-bar-actions">
        <span class="status-badge" :class="activeTerminalStatus">
          {{ statusLabel }}
        </span>
        <button
          v-if="activeTerminalStatus === 'connected'"
          class="btn-icon btn-danger"
          title="断开连接"
          @click="handleDisconnect"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="terminal-container">
      <!-- 本地模式空状态：无终端标签时显示 -->
      <div
        v-if="activeMode === 'local' && terminalTabs.length === 0"
        class="empty-state terminal-empty-state"
      >
        <svg class="empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 17 10 11 4 5"/>
          <line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
        <span class="empty-text">暂无打开的命令行</span>
        <button class="btn btn-primary terminal-empty-btn" @click="onAddLocalTab">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          打开命令行
        </button>
      </div>
      <XtermPane
        v-for="tab in terminalTabs"
        :key="tab.id"
        :tab-id="tab.id"
        v-show="tab.id === activeTerminalTabId"
        @reconnect="onReconnectTerminalTab"
      />
    </div>
  </div>
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
  'add-local-tab': []
  'close-terminal-tab': [id: string]
  'disconnect': []
  'reconnect-terminal-tab': [id: string]
}>()

const terminalStore = useTerminalStore()
const terminalTabs = computed(() => terminalStore.getTabsByMode(props.activeMode))
const activeTerminalTabId = computed(() => terminalStore.getActiveTabIdByMode(props.activeMode))
const activeTerminalStatus = computed(() => terminalStore.getActiveTabByMode(props.activeMode)?.status || 'disconnected')

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
