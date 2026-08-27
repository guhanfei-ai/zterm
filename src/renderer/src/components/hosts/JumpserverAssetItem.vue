<template>
  <div
    class="js-asset-item"
    :class="{
      'is-favorite': isFavorite,
      'is-loading': connectState === 'loading',
      'is-blocked': connectState === 'blocked'
    }"
    @click="$emit('click', asset)"
  >
    <div class="host-item-info">
      <div class="host-name">{{ asset.name }}</div>
      <div class="host-detail">
        <template v-if="asset.address">{{ asset.address }}</template>
        <template v-if="asset.platform">
          <span v-if="asset.address" class="host-detail-sep">·</span>
          {{ asset.platform }}
        </template>
        <template v-if="asset.comment">
          <span class="host-detail-sep">·</span>
          {{ asset.comment }}
        </template>
      </div>
      <div v-if="connectState !== 'connectable' && connectState !== 'unknown'" class="asset-state">
        {{ connectState === 'loading' ? '检测可连接状态…' : '暂无可连接账号' }}
      </div>
    </div>
    <button
      class="btn-favorite"
      :class="{ active: isFavorite }"
      :title="isFavorite ? '取消收藏' : '加入收藏'"
      @click.stop="$emit('toggle-favorite', asset)"
    >
      {{ isFavorite ? '★' : '☆' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { JumpserverAsset } from '@/types/jumpserver'

defineProps<{
  asset: JumpserverAsset
  isFavorite: boolean
  connectState?: 'unknown' | 'loading' | 'connectable' | 'blocked'
}>()

defineEmits<{
  click: [asset: JumpserverAsset]
  'toggle-favorite': [asset: JumpserverAsset]
}>()
</script>

<style scoped>
.js-asset-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: all var(--transition-fast);
}

.js-asset-item:hover {
  background: var(--hover-overlay);
}

.js-asset-item.is-loading,
.js-asset-item.is-blocked {
  opacity: 0.72;
}

.js-asset-item.is-blocked {
  filter: saturate(0.72);
}

.js-asset-item.is-favorite {
  border-left-color: var(--accent);
}

.host-item-info {
  flex: 1;
  min-width: 0;
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
  color: var(--text-tertiary);
  margin-top: 3px;
  font-family: var(--font-mono);
}

.asset-state {
  margin-top: 4px;
  font-size: 10px;
  color: var(--warning, #d6a353);
}

.host-detail-sep {
  margin: 0 4px;
}

.btn-favorite {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0.6;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
}

.js-asset-item:hover .btn-favorite {
  opacity: 1;
}

.btn-favorite:hover {
  background: var(--bg-tertiary);
}

.btn-favorite.active {
  color: var(--accent);
  opacity: 1;
}
</style>
