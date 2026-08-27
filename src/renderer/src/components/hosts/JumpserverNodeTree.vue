<template>
  <div class="node-tree">
    <button
      class="node-tree-header"
      type="button"
      :aria-expanded="!collapsed"
      @click="$emit('toggle-collapsed')"
    >
      <span class="node-tree-arrow" :class="{ collapsed }">▾</span>
      <span class="node-tree-title">资产树</span>
    </button>

    <template v-if="!collapsed">
      <!-- 根节点加载中 -->
      <div v-if="jumpserverStore.jumpserverRootNodesLoading" class="list-placeholder">正在加载节点...</div>

      <!-- 根节点加载失败 -->
      <div v-else-if="jumpserverStore.jumpserverNodesError" class="list-placeholder jumpserver-error">
        <div class="jumpserver-empty-icon">⚠️</div>
        <div class="jumpserver-empty-title">加载节点失败</div>
        <div class="jumpserver-empty-desc">{{ jumpserverStore.jumpserverNodesError }}</div>
        <button class="btn-retry" @click="jumpserverStore.fetchJumpserverRootNodes()">重试</button>
      </div>

      <!-- 暂无授权节点 -->
      <div v-else-if="!jumpserverStore.jumpserverRootNodes.length" class="list-placeholder jumpserver-empty">
        <div class="jumpserver-empty-icon">📂</div>
        <div class="jumpserver-empty-title">暂无授权节点</div>
        <div class="jumpserver-empty-desc">当前用户没有可访问的节点</div>
      </div>

      <!-- 单列资源树（L1：不再包含平铺资产区） -->
      <template v-else>
        <JumpserverNodeRow
          v-for="rootNode in jumpserverStore.jumpserverRootNodes"
          :key="rootNode.nodeId"
          :node="rootNode"
          :depth="0"
          @asset-click="(a) => $emit('asset-click', a)"
          @toggle-favorite="(a) => $emit('toggle-favorite', a)"
        />
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useJumpserverStore } from '@/stores/jumpserver'
import type { JumpserverAsset } from '@/types/jumpserver'
import JumpserverNodeRow from './JumpserverNodeRow.vue'

const jumpserverStore = useJumpserverStore()

defineProps<{
  collapsed?: boolean
}>()

defineEmits<{
  'asset-click': [asset: JumpserverAsset]
  'toggle-favorite': [asset: JumpserverAsset]
  'toggle-collapsed': []
}>()

// 若根节点为空且未在加载，触发首次拉取
onMounted(() => {
  if (!jumpserverStore.jumpserverRootNodes.length && !jumpserverStore.jumpserverRootNodesLoading) {
    jumpserverStore.fetchJumpserverRootNodes()
  }
})
</script>

<style scoped>
.node-tree {
  flex: 1;
  overflow-y: auto;
}

.node-tree-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px 6px;
  border-top: none;
  border-left: none;
  border-right: none;
  border-bottom: 1px solid var(--divider);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.node-tree-header:hover {
  background: var(--hover-overlay);
}

.node-tree-arrow {
  width: 12px;
  color: var(--text-tertiary);
  font-size: 10px;
  transition: transform var(--transition-fast);
}

.node-tree-arrow.collapsed {
  transform: rotate(-90deg);
}

.node-tree-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.list-placeholder {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.7;
}

.jumpserver-error {
  padding-top: 40px;
}

.jumpserver-empty {
  padding-top: 40px;
}

.jumpserver-empty-icon {
  font-size: 32px;
  margin-bottom: 12px;
  opacity: 0.6;
}

.jumpserver-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.jumpserver-empty-desc {
  font-size: 12px;
  color: var(--text-tertiary);
}

.btn-retry {
  margin-top: 12px;
  padding: 4px 16px;
  border: 1px solid var(--divider);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: border-color 0.15s, color 0.15s;
}

.btn-retry:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
