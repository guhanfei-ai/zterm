<template>
  <div v-if="items.length || showWhenEmpty" class="quick-access-section">
    <button
      class="quick-access-header"
      type="button"
      :aria-expanded="!collapsed"
      @click="$emit('toggle-collapsed')"
    >
      <span class="quick-access-arrow" :class="{ collapsed }">▾</span>
      <span class="quick-access-title">{{ title }}</span>
    </button>
    <template v-if="!collapsed && items.length">
      <JumpserverAssetItem
        v-for="item in items"
        :key="item.assetId"
        :asset="toAsset(item)"
        :is-favorite="isFavorite(item.assetId)"
        :connect-state="jumpserverStore.getJumpserverAssetConnectState(item.assetId).status"
        @click="$emit('asset-click', toAsset(item))"
        @toggle-favorite="$emit('toggle-favorite', toAsset(item))"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useJumpserverStore } from '@/stores/jumpserver'
import type { JumpserverAsset, JumpserverQuickAccessItem } from '@/types/jumpserver'
import JumpserverAssetItem from './JumpserverAssetItem.vue'

const jumpserverStore = useJumpserverStore()

defineProps<{
  title: string
  items: JumpserverQuickAccessItem[]
  isFavorite: (assetId: string) => boolean
  collapsed?: boolean
  showWhenEmpty?: boolean
}>()

defineEmits<{
  'asset-click': [asset: JumpserverAsset]
  'toggle-favorite': [asset: JumpserverAsset]
  'toggle-collapsed': []
}>()

function toAsset(item: JumpserverQuickAccessItem): JumpserverAsset {
  return {
    assetId: item.assetId,
    name: item.name,
    address: item.address,
    platform: item.platform,
    comment: item.comment
  }
}
</script>

<style scoped>
.quick-access-section {
  margin-bottom: 8px;
}

.quick-access-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px 6px;
  border-bottom: 1px solid var(--divider);
  border-top: none;
  border-left: none;
  border-right: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.quick-access-header:hover {
  background: var(--hover-overlay);
}

.quick-access-arrow {
  width: 12px;
  color: var(--text-tertiary);
  font-size: 10px;
  transition: transform var(--transition-fast);
}

.quick-access-arrow.collapsed {
  transform: rotate(-90deg);
}

.quick-access-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
