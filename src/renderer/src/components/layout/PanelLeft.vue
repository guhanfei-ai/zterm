<template>
  <div class="panel panel-left" :style="{ width: width + 'px' }">
    <div class="left-panel-top">
      <div class="left-panel-row left-panel-context-row">
        <span class="left-panel-context-title">
          {{ hostsStore.activeMode === 'direct' ? '远程主机' : hostsStore.activeMode === 'jumpserver' ? 'JumpServer 资产' : '本地终端' }}
        </span>
        <div v-if="hostsStore.activeMode === 'direct'" class="panel-actions">
          <button class="btn-icon" title="添加" @click="$emit('add-host')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button class="btn-icon" title="秘钥管理" @click="$emit('show-key-manager')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          </button>
        </div>
      </div>
    </div>
    <HostList />
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
  'show-key-manager': []
}>()

const hostsStore = useHostsStore()
</script>
