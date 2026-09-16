<template>
  <div class="panel panel-right" :style="{ width: width + 'px' }">
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
      <button class="tab-add" type="button" title="新建对话" aria-label="新建对话" @click="chatStore.addTab()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
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
/* 聊天标签：单个时不再拉满整行（回归 88–200px 页签宽度，修复"标签过大"）；
   active 时与下方内容区同色相连，并用 ::after 盖住 tab 栏底边线，
   让标签"坐"在内容区上而不是悬浮（内容区地面色 = --workbench-panel-bg） */
.chat-tab-bar .tab-item.active {
  background: var(--workbench-panel-bg, var(--surface-muted));
}

.chat-tab-bar .tab-item.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: var(--workbench-panel-bg, var(--surface-muted));
}

</style>
