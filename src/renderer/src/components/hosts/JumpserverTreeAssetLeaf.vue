<template>
  <div
    class="tree-asset-leaf"
    :class="{
      'tree-asset-leaf--loading': connectState === 'loading',
      'tree-asset-leaf--blocked': connectState === 'blocked'
    }"
    :style="{ paddingLeft: depth * 16 + 10 + 20 + 'px' }"
    @click="$emit('click', asset)"
  >
    <span class="leaf-icon">🖥</span>
    <div class="leaf-body">
      <div class="leaf-name">{{ asset.name }}</div>
      <div class="leaf-meta">
        <template v-if="asset.address">{{ asset.address }}</template>
        <template v-if="asset.platform">
          <span v-if="asset.address" class="leaf-meta-sep">·</span>
          {{ asset.platform }}
        </template>
      </div>
      <div v-if="connectState !== 'connectable' && connectState !== 'unknown'" class="leaf-state">
        {{ connectState === 'loading' ? '检测中…' : '暂无可连接账号' }}
      </div>
    </div>
    <button
      class="btn-fav"
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
  depth: number
  isFavorite: boolean
  connectState?: 'unknown' | 'loading' | 'connectable' | 'blocked'
}>()

defineEmits<{
  click: [asset: JumpserverAsset]
  'toggle-favorite': [asset: JumpserverAsset]
}>()
</script>

<style scoped>
.tree-asset-leaf {
  display: flex;
  align-items: center;
  padding: 4px 10px;
  cursor: pointer;
  transition: background var(--transition-fast);
  border-left: 3px solid transparent;
  gap: 6px;
}

.tree-asset-leaf:hover {
  background: var(--hover-overlay);
}

.tree-asset-leaf--loading,
.tree-asset-leaf--blocked {
  opacity: 0.72;
}

.tree-asset-leaf--blocked {
  filter: saturate(0.72);
}

.leaf-icon {
  font-size: 11px;
  flex-shrink: 0;
  opacity: 0.6;
}

.leaf-body {
  flex: 1;
  min-width: 0;
}

.leaf-name {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.leaf-meta {
  font-size: 10px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.leaf-state {
  font-size: 10px;
  color: var(--warning, #d6a353);
  margin-top: 1px;
}

.leaf-meta-sep {
  margin: 0 3px;
}

.btn-fav {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}

.tree-asset-leaf:hover .btn-fav {
  opacity: 1;
}

.btn-fav.active {
  color: var(--accent);
  opacity: 1;
}

.btn-fav:hover {
  color: var(--accent);
}
</style>
