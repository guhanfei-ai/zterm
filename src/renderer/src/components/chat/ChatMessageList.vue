<template>
  <div class="message-list" ref="listRef">
    <div v-if="!messages.length" class="empty-chat">
      <div class="empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <div class="empty-text">与 AI 助手开始对话</div>
      <div class="empty-hint">按 Enter 发送，Shift+Enter 换行</div>
    </div>
    <div
      v-for="msg in messages"
      :key="msg.id"
      class="message"
      :class="[msg.role, msg.status]"
    >
      <div class="message-role">
        {{ msg.role === 'user' ? '你' : 'AI' }}
      </div>
      <ThinkingCollapse
        v-if="msg.role === 'assistant' && msg.reasoning"
        :reasoning="msg.reasoning"
        :is-streaming="msg.status === 'streaming'"
      />
      <div class="message-text" v-if="msg.text">
        <div v-if="msg.role === 'user'">{{ msg.text }}</div>
        <MarkdownContent v-else :text="msg.text" />
      </div>
      <div v-if="msg.status === 'streaming' && !msg.text && !msg.reasoning" class="streaming-cursor">
        <svg width="8" height="14" viewBox="0 0 8 14"><rect width="2.5" height="14" rx="1" fill="currentColor"/></svg>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'
import type { ChatMessage } from '@/types/chat'
import { useChatStore } from '@/stores/chat'
import ThinkingCollapse from './ThinkingCollapse.vue'
import MarkdownContent from './MarkdownContent.vue'

const props = defineProps<{
  messages: ChatMessage[]
  tabId: string
}>()

const listRef = ref<HTMLDivElement | null>(null)

// Track whether user has manually scrolled up — per-tab isolation
const userScrolledUpMap = new Map<string, boolean>()
const chatStore = useChatStore()
function getUserScrolledUp(): boolean {
  return userScrolledUpMap.get(props.tabId) ?? false
}
function setUserScrolledUp(value: boolean): void {
  userScrolledUpMap.set(props.tabId, value)
}

function isNearBottom(el: HTMLElement, threshold = 60): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold
}

function scrollToBottom(smooth = false): void {
  const el = listRef.value
  if (!el) return
  el.scrollTo({
    top: el.scrollHeight,
    behavior: smooth ? 'smooth' : 'instant'
  })
}

function handleScroll(): void {
  const el = listRef.value
  if (el) {
    setUserScrolledUp(!isNearBottom(el))
  }
}

// Detect user manual scroll
onMounted(() => {
  const el = listRef.value
  if (el) {
    el.addEventListener('scroll', handleScroll, { passive: true })
  }
})
// scroll 监听器随元素销毁自动回收，无需手动 removeEventListener
// （onUnmounted 时 listRef 已置空，手动移除永远不会生效）

// 标签关闭后清理对应的滚动状态，避免 userScrolledUpMap 无限增长
watch(() => chatStore.tabs.map(t => t.id), (newIds, oldIds) => {
  if (!oldIds) return
  for (const id of oldIds) {
    if (!newIds.includes(id)) userScrolledUpMap.delete(id)
  }
})

// Re-evaluate scroll state when switching tabs
watch(() => props.tabId, (newTabId) => {
  const el = listRef.value
  if (el && newTabId) {
    setUserScrolledUp(!isNearBottom(el))
  }
})

// Auto-scroll: only when user is near bottom (or on first message)
watch(
  () => props.messages.length,
  (newLen, oldLen) => {
    // First message or new message added — scroll to bottom
    if (oldLen === 0 || !getUserScrolledUp()) {
      nextTick(() => scrollToBottom(oldLen === 0 ? false : true))
    }
  }
)

// Streaming: keep bottom visible when content grows
watch(
  () => {
    const last = props.messages[props.messages.length - 1]
    return last?.text?.length ?? 0
  },
  () => {
    if (!getUserScrolledUp()) {
      nextTick(() => scrollToBottom())
    }
  }
)

</script>

<style scoped>
.message-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: transparent;
}

/* ===== 空状态 ===== */
.empty-chat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-tertiary);
  text-align: center;
}

.empty-icon {
  margin-bottom: var(--space-sm);
}

.empty-text {
  font-size: 13px;
  margin-bottom: var(--space-xs);
  color: var(--text-secondary);
}

.empty-hint {
  font-size: 11px;
  color: var(--text-disabled);
}

/* ===== 消息块 ===== */
.message {
  max-width: 100%;
}

.message-role {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  margin-bottom: 6px;
  letter-spacing: 0.3px;
}

.message.user .message-role {
  color: var(--accent);
}

/* ===== 消息文本 ===== */
.message-text {
  font-size: 13px;
  line-height: 1.65;
  word-break: break-word;
  color: var(--text-primary);
}

/* 用户消息 — JetBrains 风格卡片 */
.message.user .message-text {
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-card);
  padding: 8px 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

/* 助手消息 — 阅读块 */
.message.assistant .message-text {
  padding: 2px 0;
}

/* ===== 代码块 ===== */
.message-text :deep(.code-block) {
  background: var(--surface-muted);
  border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  margin: 6px 0;
  overflow-x: auto;
  font-size: 12px;
  font-family: var(--font-mono);
  white-space: pre-wrap;
  line-height: 1.5;
}

.message-text :deep(.inline-code) {
  background: var(--surface-alt);
  color: var(--accent-soft);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: var(--font-mono);
}

/* ===== 流式光标 ===== */
.streaming-cursor {
  color: var(--accent);
  animation: blink 1s infinite;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
</style>
