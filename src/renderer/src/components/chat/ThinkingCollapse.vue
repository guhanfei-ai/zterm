<template>
  <div v-if="reasoning" class="thinking-collapse">
    <div class="thinking-header" @click="expanded = !expanded">
      <span class="thinking-arrow">
        <svg v-if="expanded" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        <svg v-else width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
      </span>
      <span class="thinking-title">
        {{ isStreaming ? '思考中...' : reasoningLines > 0 ? `思考过程（${reasoningLines} 行）` : '思考过程' }}
      </span>
      <span v-if="isStreaming" class="thinking-dot">
        <svg width="8" height="8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>
      </span>
    </div>
    <div v-show="expanded" class="thinking-content">
      <pre>{{ reasoning }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  reasoning?: string
  isStreaming?: boolean
}>()

const expanded = ref(false)

const reasoningLines = computed(() => {
  return props.reasoning ? props.reasoning.split('\n').filter((l) => l.trim()).length : 0
})
</script>

<style scoped>
.thinking-collapse {
  margin-bottom: 6px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface-muted);
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-tertiary);
  user-select: none;
  transition: background var(--transition-fast);
}

.thinking-header:hover {
  background: var(--surface-alt);
  color: var(--text-secondary);
}

.thinking-arrow {
  font-size: 10px;
  width: 14px;
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.thinking-title {
  flex: 1;
}

.thinking-dot {
  color: var(--accent);
  font-size: 8px;
  animation: pulse 1.2s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}

.thinking-content {
  padding: 8px 12px;
  border-top: 1px solid var(--divider);
  background: var(--surface-muted);
}

.thinking-content pre {
  font-size: 12px;
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}
</style>
