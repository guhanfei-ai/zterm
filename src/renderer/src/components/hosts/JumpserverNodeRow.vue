<template>
  <div class="node-row-container">
    <div
      class="node-row"
      :class="{ 'node-row--child': depth > 0 }"
      :style="{ paddingLeft: depth * 16 + 10 + 'px' }"
    >
      <!-- 展开/折叠箭头 -->
      <span
        class="node-expand"
        :class="{
          'node-expand--hidden': !showExpandArrow,
          'node-expand--loading': isThisLoading
        }"
        @click.stop="onToggle"
      >
        <template v-if="isThisLoading">⟳</template>
        <template v-else-if="isThisExpanded">▼</template>
        <template v-else>▶</template>
      </span>

      <!-- 节点主体 -->
      <div class="node-body" @click="onToggle">
        <div class="node-name">{{ node.name }}</div>
        <div class="node-meta">
          <span v-if="node.assetCount > 0" class="node-count">{{ node.assetCount }} 台</span>
        </div>
      </div>
    </div>

    <!-- 递归渲染子节点 + 内联资产叶子 -->
    <template v-if="isThisExpanded">
      <!-- L1验收：子节点加载中占位 -->
      <div
        v-if="isThisLoading && !myChildren.length"
        class="inline-status"
        :style="{ paddingLeft: (depth + 1) * 16 + 10 + 20 + 'px' }"
      >
        <span class="inline-spinner" /> 加载子节点...
      </div>

      <!-- L1验收：子节点加载局部失败 -->
      <div
        v-else-if="childrenError"
        class="inline-status inline-error"
        :style="{ paddingLeft: (depth + 1) * 16 + 10 + 20 + 'px' }"
      >
        <span>⚠ {{ childrenError }}</span>
        <button class="inline-retry" @click.stop="jumpserverStore.retryNodeChildren(node.nodeId)">重试</button>
      </div>

      <!-- 子节点优先 -->
      <JumpserverNodeRow
        v-for="child in myChildren"
        :key="'node-' + child.nodeId"
        :node="child"
        :depth="depth + 1"
        @asset-click="(a) => $emit('asset-click', a)"
        @toggle-favorite="(a) => $emit('toggle-favorite', a)"
      />

      <!-- 内联资产状态区 -->
      <!-- loading -->
      <div
        v-if="assetState.loading"
        class="inline-status"
        :style="{ paddingLeft: (depth + 1) * 16 + 10 + 20 + 'px' }"
      >
        <span class="inline-spinner" /> 加载中...
      </div>

      <!-- error -->
      <div
        v-else-if="assetState.error"
        class="inline-status inline-error"
        :style="{ paddingLeft: (depth + 1) * 16 + 10 + 20 + 'px' }"
      >
        <span>⚠ {{ assetState.error }}</span>
        <button class="inline-retry" @click.stop="jumpserverStore.retryNodeAssetsInline(node.nodeId)">重试</button>
      </div>

      <!-- empty (no children + no assets + loaded) -->
      <div
        v-else-if="assetState.loaded && !assetState.assets.length && !myChildren.length"
        class="inline-status inline-empty"
        :style="{ paddingLeft: (depth + 1) * 16 + 10 + 20 + 'px' }"
      >
        暂无内容
      </div>

      <!-- asset leaves -->
      <template v-else>
        <JumpserverTreeAssetLeaf
          v-for="asset in assetState.assets"
          :key="'asset-' + asset.assetId"
          :asset="asset"
          :depth="depth + 1"
          :is-favorite="jumpserverStore.isJumpserverFavorite(asset.assetId)"
          :connect-state="jumpserverStore.getJumpserverAssetConnectState(asset.assetId).status"
          @click="(a) => $emit('asset-click', a)"
          @toggle-favorite="(a) => $emit('toggle-favorite', a)"
        />

        <!-- load more -->
        <div
          v-if="assetState.hasMore"
          class="inline-status inline-load-more"
          :style="{ paddingLeft: (depth + 1) * 16 + 10 + 20 + 'px' }"
        >
          <button
            class="inline-load-more-btn"
            :disabled="assetState.loadingMore"
            @click.stop="jumpserverStore.loadMoreNodeAssetsInline(node.nodeId)"
          >
            {{ assetState.loadingMore ? '加载中...' : '加载更多' }}
          </button>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useJumpserverStore } from '@/stores/jumpserver'
import type { JumpserverNode, JumpserverAsset } from '@/types/jumpserver'
import JumpserverTreeAssetLeaf from './JumpserverTreeAssetLeaf.vue'

defineOptions({ name: 'JumpserverNodeRow' })

const props = defineProps<{
  node: JumpserverNode
  depth: number
}>()

defineEmits<{
  'asset-click': [asset: JumpserverAsset]
  'toggle-favorite': [asset: JumpserverAsset]
}>()

const jumpserverStore = useJumpserverStore()

const isThisExpanded = computed(() => !!jumpserverStore.jumpserverExpandedNodeIds[props.node.nodeId])

const isThisLoading = computed(() => !!jumpserverStore.jumpserverNodeChildrenLoading[props.node.nodeId])

const myChildren = computed(() => jumpserverStore.jumpserverChildNodes[props.node.nodeId] || [])

const childrenError = computed(() => jumpserverStore.getNodeChildrenError(props.node.nodeId))

const assetState = computed(() => jumpserverStore.getNodeAssetState(props.node.nodeId))

/** L1验收：显示箭头的条件：有子节点标记 或 hasChildren 或 assetCount > 0 或 已加载过内联资产 */
const showExpandArrow = computed(() => {
  return jumpserverStore.jumpserverChildNodes[props.node.nodeId] !== undefined
    || props.node.hasChildren
    || props.node.assetCount > 0
    || assetState.value.loaded
})

function onToggle(): void {
  if (isThisLoading.value) return
  jumpserverStore.toggleJumpserverNode(props.node.nodeId)
}
</script>

<style scoped>
.node-row {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  cursor: pointer;
  transition: background var(--transition-fast);
  border-left: 3px solid transparent;
}

.node-row:hover {
  background: var(--hover-overlay);
}

.node-expand {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: var(--text-tertiary);
  flex-shrink: 0;
  margin-right: 4px;
  cursor: pointer;
  transition: color 0.15s;
  user-select: none;
}

.node-expand:hover {
  color: var(--text-primary);
}

.node-expand--hidden {
  visibility: hidden;
}

.node-expand--loading {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.node-body {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.node-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-meta {
  flex-shrink: 0;
}

.node-count {
  font-size: 10px;
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  padding: 1px 6px;
  border-radius: 8px;
}

/* 内联状态行 */
.inline-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 11px;
  color: var(--text-tertiary);
}

.inline-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--divider);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

.inline-error {
  color: var(--danger, #e55);
}

.inline-retry {
  padding: 1px 8px;
  border: 1px solid var(--divider);
  border-radius: 3px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 10px;
  transition: color 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.inline-retry:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.inline-empty {
  opacity: 0.5;
  font-style: italic;
}

.inline-load-more {
  padding: 2px 0 4px;
}

.inline-load-more-btn {
  padding: 2px 12px;
  border: 1px solid var(--divider);
  border-radius: 3px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 10px;
  transition: color 0.15s, border-color 0.15s;
}

.inline-load-more-btn:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
}

.inline-load-more-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
