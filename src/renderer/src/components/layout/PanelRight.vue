<template>
  <div class="panel panel-right" :style="{ width: width + 'px' }">
    <div class="assistant-header">
      <div class="assistant-title">
        <span class="assistant-mark" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z"/>
            <path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>
          </svg>
        </span>
        <span>AI 助手</span>
      </div>
      <button class="assistant-new" type="button" title="新建对话" @click="chatStore.addTab()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>新建</span>
      </button>
    </div>
    <!-- Chat Tab Bar -->
    <div class="tab-bar chat-tab-bar" role="tablist" aria-label="对话标签">
      <div class="tab-list">
        <div
          v-for="tab in chatStore.tabs"
          :key="tab.id"
          class="tab-item"
          :class="{ active: tab.id === chatStore.activeTabId }"
          role="tab"
          :aria-selected="tab.id === chatStore.activeTabId"
          tabindex="0"
          @click="chatStore.switchTab(tab.id)"
          @keydown="onChatTabKeydown($event, tab.id)"
        >
          <span class="tab-title">{{ tab.title }}</span>
          <button
            v-if="chatStore.tabs.length > 1"
            class="tab-close"
            title="关闭标签"
            @click.stop="onCloseChatTab(tab.id)"
            @keydown.stop
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </div>
      </div>
    </div>
    <ChatPanel />
  </div>
</template>

<script setup lang="ts">
import { useChatStore } from '@/stores/chat'
import ChatPanel from '@/components/chat/ChatPanel.vue'

defineProps<{
  width: number
}>()

const emit = defineEmits<{
  'close-chat-tab': [id: string]
}>()

const chatStore = useChatStore()

function onCloseChatTab(id: string): void {
  emit('close-chat-tab', id)
}

function onChatTabKeydown(event: KeyboardEvent, id: string): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    chatStore.switchTab(id)
  }
}
</script>

<style scoped>
.assistant-header {
  height: var(--panel-header-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 16px;
  background: var(--workbench-panel-bg, var(--surface));
  border-bottom: 1px solid var(--workbench-border, var(--divider));
  flex-shrink: 0;
}

.assistant-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.1px;
}

.assistant-mark { color: var(--accent); display: flex; }

.assistant-new {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-soft, var(--divider));
  border-radius: var(--radius-control, 7px);
  background: var(--surface-alt);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}

.assistant-new:hover { background: var(--surface-high); color: var(--text-primary); border-color: var(--accent); }

</style>
