<template>
  <div class="workspace-restore-backdrop" role="dialog" aria-modal="true" aria-labelledby="workspace-restore-title">
    <section class="workspace-restore-dialog">
      <h2 id="workspace-restore-title">{{ title }}</h2>
      <p>{{ message }}</p>
      <div class="workspace-restore-actions">
        <button v-if="mode === 'restore'" class="btn btn-primary" @click="emit('restore')">恢复上次工作区</button>
        <button class="btn" @click="emit('discard')">
          {{ mode === 'restore' ? '新建空白工作区并清除保存内容' : '丢弃保存内容' }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  mode: 'restore' | 'invalid'
  reason?: string
}>()

const emit = defineEmits<{
  restore: []
  discard: []
}>()

const title = computed(() => props.mode === 'restore' ? '恢复上次工作区？' : '无法恢复已保存工作区')
const message = computed(() => props.mode === 'restore'
  ? '终端将保持断开状态，不会自动连接或恢复终端输出、聊天消息。'
  : props.reason || '已保存内容无法验证，必须由你明确丢弃。'
)
</script>

<style scoped>
.workspace-restore-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}

.workspace-restore-dialog {
  width: min(440px, 100%);
  padding: 24px;
  border: 1px solid var(--border, var(--divider));
  border-radius: var(--radius-container, 10px);
  background: var(--surface);
  color: var(--text-primary);
  box-shadow: var(--shadow-dialog, 0 18px 48px rgba(0, 0, 0, 0.3));
}

h2 {
  margin: 0 0 10px;
  font-size: 17px;
}

p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.65;
}

.workspace-restore-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 22px;
}
</style>
