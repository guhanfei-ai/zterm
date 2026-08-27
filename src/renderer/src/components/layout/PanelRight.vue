<template>
  <div class="panel panel-right" :style="{ width: width + 'px' }">
    <!-- Chat Tab Bar -->
    <div class="tab-bar chat-tab-bar">
      <div class="tab-list">
        <div
          v-for="tab in chatStore.tabs"
          :key="tab.id"
          class="tab-item"
          :class="{ active: tab.id === chatStore.activeTabId }"
          @click="chatStore.switchTab(tab.id)"
        >
          <span class="tab-title">{{ tab.title }}</span>
          <button
            v-if="chatStore.tabs.length > 1"
            class="tab-close"
            title="关闭标签"
            @click.stop="onCloseChatTab(tab.id)"
          >&times;</button>
        </div>
      </div>
      <button class="tab-add" title="新增对话标签" @click="chatStore.addTab()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
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
</script>
