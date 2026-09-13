<template>
  <div class="panel panel-left" :style="{ width: width + 'px' }">
    <div class="left-panel-top">
      <div class="left-panel-row left-panel-context-row">
        <span class="left-panel-context-title">
          {{ hostsStore.activeMode === 'direct' ? '远程主机' : hostsStore.activeMode === 'jumpserver' ? 'JumpServer 资产' : '本地终端' }}
        </span>
        <button v-if="hostsStore.activeMode === 'direct'" class="panel-add-btn" title="添加主机" @click="$emit('add-host')">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
      <div v-if="hostsStore.activeMode === 'direct'" class="panel-actions">
        <button class="panel-action" title="从 OpenSSH 配置导入主机" @click="$emit('import-hosts')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg><span>导入</span>
        </button>
        <button class="panel-action" title="导出主机为 OpenSSH 配置" @click="$emit('export-hosts')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg><span>导出</span>
        </button>
        <button class="panel-action" title="密钥管理" @click="$emit('show-key-manager')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 6 2 2"/><path d="m14 9 2 2"/></svg><span>密钥</span>
        </button>
      </div>
    </div>
    <HostList @add-host="$emit('add-host')" @import-hosts="$emit('import-hosts')" />
  </div>
</template>

<script setup lang="ts">
import { useHostsStore } from '@/stores/hosts'
import HostList from '@/components/hosts/HostList.vue'

defineProps<{
  width: number
}>()

defineEmits<{
  'add-host': []
  'import-hosts': []
  'export-hosts': []
  'show-key-manager': []
}>()

const hostsStore = useHostsStore()
</script>

<style scoped>
/* 侧栏标题与工作区对齐，第二行操作与标签栏等高。 */
.panel-left.panel-left {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex-shrink: 0;
  background: var(--workbench-panel-bg, var(--surface));
  border-right-color: var(--workbench-border, var(--divider));
}

.panel-left .left-panel-top {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: var(--workbench-panel-bg, var(--surface));
  border-bottom-color: var(--workbench-border, var(--divider));
}

.panel-left .left-panel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: var(--panel-header-height);
  padding: 0 14px;
}

.left-panel-context-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0;
}

.panel-add-btn {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  box-shadow: var(--shadow-subtle);
  border-radius: var(--radius-control, 9px);
  background: var(--surface-alt, transparent);
  color: var(--text-secondary);
  cursor: pointer;
  transition: color var(--transition-fast), background-color var(--transition-fast), border-color var(--transition-fast);
}

.panel-add-btn:hover {
  color: var(--accent, #86d4bd);
  box-shadow: 0 2px 10px color-mix(in srgb, var(--accent, #86d4bd) 14%, transparent);
  background: color-mix(in srgb, var(--accent, #86d4bd) 10%, transparent);
}

.panel-left .panel-actions {
  min-height: var(--tabbar-height);
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 14px;
  border-top: 1px solid var(--divider-soft, var(--divider));
}

.panel-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: color var(--transition-fast);
}

.panel-action:hover {
  color: var(--accent, #86d4bd);
}

.panel-action svg {
  flex: 0 0 auto;
}
</style>
