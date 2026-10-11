<template>
  <div class="panel panel-left" :style="{ width: width + 'px' }">
    <div class="left-panel-top">
      <div class="left-panel-row left-panel-context-row">
        <span class="left-panel-context-title">
          {{ hostsStore.activeMode === 'direct' ? '远程主机' : hostsStore.activeMode === 'jumpserver' ? 'JumpServer 资产' : '本地终端' }}
        </span>
        <div v-if="hostsStore.activeMode === 'direct'" ref="addMenu" class="panel-add-menu-wrap" @keydown.esc.stop.prevent="addMenuOpen = false">
          <button class="panel-add-btn" title="创建主机或文件夹" aria-label="创建主机或文件夹" aria-haspopup="menu" :aria-expanded="addMenuOpen" @click="addMenuOpen = !addMenuOpen">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <div v-if="addMenuOpen" class="panel-add-menu" role="menu">
            <button role="menuitem" @click="addMenuOpen = false; $emit('add-host')">创建主机</button>
            <button role="menuitem" :disabled="!hostsStore.treeLoaded || hostsStore.loading || hostsStore.treeSaving" @click="addMenuOpen = false; showFolderDialog = true">创建文件夹</button>
          </div>
        </div>
      </div>
      <div v-if="hostsStore.activeMode === 'direct'" class="panel-actions">
        <button class="panel-action" title="导出主机为 OpenSSH 配置" @click="$emit('export-hosts')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg><span>导出</span>
        </button>
        <button class="panel-action" title="密钥管理" @click="$emit('show-key-manager')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 6 2 2"/><path d="m14 9 2 2"/></svg><span>密钥</span>
        </button>
      </div>
    </div>
    <HostList @add-host="$emit('add-host')" />
    <HostFolderDialog v-if="showFolderDialog" @close="showFolderDialog = false" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useHostsStore } from '@/stores/hosts'
import HostList from '@/components/hosts/HostList.vue'
import HostFolderDialog from '@/components/hosts/HostFolderDialog.vue'

defineProps<{
  width: number
}>()

defineEmits<{
  'add-host': []
  'export-hosts': []
  'show-key-manager': []
}>()

const hostsStore = useHostsStore()
const addMenuOpen = ref(false)
const showFolderDialog = ref(false)
const addMenu = ref<HTMLElement | null>(null)
function closeAddMenu(event: PointerEvent): void {
  if (!addMenu.value?.contains(event.target as Node)) addMenuOpen.value = false
}
onMounted(() => document.addEventListener('pointerdown', closeAddMenu))
onUnmounted(() => document.removeEventListener('pointerdown', closeAddMenu))
</script>

<style scoped>
/* 侧栏标题行与中/右栏标签栏等高（--tabbar-height），顶行底边对齐。 */
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
  min-height: var(--tabbar-height);
  padding: 0 12px;
}

.left-panel-context-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
}

.panel-add-btn {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color var(--transition-fast), background-color var(--transition-fast);
}

.panel-add-btn:hover {
  color: var(--text-primary);
  background: var(--surface-alt, transparent);
}

.panel-add-menu-wrap { position: relative; flex-shrink: 0; }
.panel-add-menu { position: absolute; right: 0; top: 30px; z-index: 50; width: 140px; padding: 5px; border: 1px solid var(--divider); border-radius: var(--radius-control); background: var(--surface); box-shadow: var(--shadow-dialog); }
.panel-add-menu button { display: block; width: 100%; padding: 9px 10px; border: 0; border-radius: var(--radius-sm); text-align: left; background: transparent; color: var(--text-primary); font: inherit; font-size: 12px; cursor: pointer; }
.panel-add-menu button:hover { background: var(--surface-alt); }
.panel-add-menu button:disabled { opacity: .5; cursor: default; }

.panel-left .panel-actions {
  min-height: var(--tabbar-height);
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 12px;
  border-top: 1px solid var(--workbench-border-soft, var(--divider-soft));
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
  color: var(--accent);
}

.panel-action svg {
  flex: 0 0 auto;
}
</style>
