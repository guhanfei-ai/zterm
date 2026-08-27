<template>
  <div class="agent-timeline-item" :class="itemClass">
    <!-- Agent 收尾结论：专属"总结"卡（带复制/保存按钮） -->
    <div v-if="msg.isAgentConclusion" class="conclusion-chat">
      <div class="conclusion-bubble">
        <div class="conclusion-header">
          <svg class="conclusion-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 0 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          总结
          <div class="conclusion-actions">
            <button class="btn-md-action" @click="emit('copy-conclusion', msg)" title="复制为 Markdown">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              复制为 Markdown
            </button>
            <button class="btn-md-action" @click="emit('save-conclusion', msg)" title="保存为 Markdown 文件">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              保存为 Markdown 文件
            </button>
          </div>
        </div>
        <MarkdownContent class="conclusion-body" :text="msg.text" />
      </div>
    </div>

    <!-- Agent 自然聊天：用户气泡 / 助手气泡（用 markdown 渲染，走正式对话视觉） -->
    <div v-else-if="msg.isAgentUserTurn" class="bubble bubble-user">
      <div class="bubble-role">你</div>
      <div class="bubble-text">{{ msg.text }}</div>
    </div>
    <div v-else-if="msg.isAgentNaturalReply" class="bubble bubble-assistant">
      <div class="bubble-role">AI</div>
      <MarkdownContent class="bubble-text" :text="msg.text" />
    </div>

    <!-- 执行卡片：plan / execution / observation / thinking / error / status -->
    <template v-else-if="msg.isAgentCard">
      <!-- Plan -->
      <div v-if="msg.agentCardType === 'plan'" class="block block-plan">
        <div class="block-header">
          <svg class="block-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          {{ msg.stepNumber ? `第 ${msg.stepNumber} 步 · 计划` : '计划' }}
        </div>
        <div class="block-content">{{ msg.text }}</div>
      </div>

      <!-- Execution -->
      <div v-else-if="msg.agentCardType === 'execution'" class="block block-execution">
        <div class="block-header">
          <svg class="block-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          {{ msg.stepNumber ? `第 ${msg.stepNumber} 步 · 执行` : '执行' }}
          <span v-if="msg.details?.awaitingApproval" class="pending-tag">
            <svg class="tag-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            等待确认
          </span>
          <span v-else-if="msg.details?.running" class="running-tag">
            <svg class="tag-icon" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            执行中
          </span>
        </div>
        <div class="block-content cmd-content"><code>{{ msg.text }}</code></div>
        <div v-if="msg.details?.reason && !msg.details?.awaitingApproval" class="block-meta">
          <svg class="meta-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          {{ msg.details.reason }}（{{ msg.details.category }}）
        </div>
      </div>

      <!-- Observation -->
      <div v-else-if="msg.agentCardType === 'observation'" class="block block-observation">
        <div class="block-header">
          <svg class="block-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          {{ msg.stepNumber ? `第 ${msg.stepNumber} 步 · 结果` : '观察' }}
          <span v-if="msg.details?.duration" class="duration-tag">{{ msg.details.duration }}ms</span>
        </div>
        <div class="block-content">
          <pre class="output-pre">{{ isExpanded ? msg.text : truncateOutput(msg.text) }}</pre>
          <button
            v-if="msg.text.length > OUTPUT_TRUNCATE_LIMIT && !isExpanded"
            class="expand-btn"
            @click="isExpanded = true"
          >展开全部</button>
        </div>
      </div>

      <!-- Thinking -->
      <div v-else-if="msg.agentCardType === 'thinking'" class="block block-thinking">
        <div class="block-header" @click="toggleThinking" style="cursor: pointer">
          <svg class="block-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span v-if="msg.streaming" class="thinking-label thinking-active">思考中...</span>
          <span v-else class="thinking-label">思考过程</span>
          <span class="thinking-toggle">{{ isThinkingExpanded ? '收起' : '展开' }}</span>
        </div>
        <div v-if="isThinkingExpanded && msg.text" class="block-content thinking-content">
          <pre class="thinking-pre">{{ msg.text }}</pre>
        </div>
        <div v-else-if="isThinkingExpanded && !msg.text" class="block-content thinking-content thinking-empty">
          等待思考...
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="msg.agentCardType === 'error'" class="block block-error">
        <div class="block-header">
          <svg class="block-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          {{ msg.stepNumber ? `第 ${msg.stepNumber} 步错误` : '错误' }}
        </div>
        <div class="block-content">{{ msg.text }}</div>
      </div>

      <!-- Status -->
      <div v-else class="block block-status">
        <div class="block-content status-text">{{ msg.text }}</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ChatMessage } from '@/types/chat'
import MarkdownContent from '../chat/MarkdownContent.vue'

const props = defineProps<{
  msg: ChatMessage
}>()

// 收尾结论操作通过 emit 交给父组件（需要 agentDetails 构造完整报告）
const emit = defineEmits<{
  (e: 'copy-conclusion', msg: ChatMessage): void
  (e: 'save-conclusion', msg: ChatMessage): void
}>()

const itemClass = computed(() => {
  if (props.msg.isAgentUserTurn) return 'kind-user-turn'
  if (props.msg.isAgentNaturalReply) return 'kind-natural-reply'
  if (props.msg.isAgentConclusion) return 'kind-conclusion'
  if (props.msg.isAgentCard) return 'kind-card'
  return ''
})

// Thinking block: default expanded when streaming, collapsed when done
const thinkingUserOverride = ref(false)
const thinkingUserToggled = ref(false)
const isThinkingExpanded = computed(() => {
  if (thinkingUserToggled.value) return thinkingUserOverride.value
  return props.msg.streaming === true || (!props.msg.collapsed && !props.msg.streaming && !props.msg.thinkingId)
})
function toggleThinking(): void {
  thinkingUserToggled.value = true
  thinkingUserOverride.value = !isThinkingExpanded.value
}

const OUTPUT_TRUNCATE_LIMIT = 1500

const isExpanded = ref(false)

function truncateOutput(text: string): string {
  if (text.length <= OUTPUT_TRUNCATE_LIMIT) return text
  return text.slice(0, OUTPUT_TRUNCATE_LIMIT) + '\n... (输出过长，已截断)'
}

</script>

<style scoped>
.agent-timeline-item {
  margin: 3px 8px;
}

/* ===== 自然聊天气泡（用户/助手） ===== */
.bubble {
  padding: 8px 12px;
  border-radius: var(--radius-card);
  border: 1px solid var(--divider);
  font-size: 12px;
  line-height: 1.65;
  word-break: break-word;
  color: var(--text-primary);
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.bubble-user {
  background: var(--surface);
  border-color: var(--divider);
}
.bubble-assistant {
  background: var(--surface-alt);
  border-color: var(--border-soft);
}
.bubble-role {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  margin-bottom: 4px;
  letter-spacing: 0.3px;
}
.bubble-user .bubble-role { color: var(--accent); }
.bubble-text { font-size: 12px; }

.bubble-text :deep(.code-block) {
  background: var(--bg); border: 1px solid var(--divider);
  border-radius: 4px; padding: 6px 10px;
  margin: 4px 0; font-size: 11px;
  font-family: monospace; white-space: pre-wrap;
  overflow-x: auto;
}
.bubble-text :deep(.inline-code) {
  background: var(--surface-muted); padding: 1px 4px;
  border-radius: 3px; font-size: 11px; font-family: monospace;
}
.bubble-text :deep(ol) {
  padding-left: 20px;
  margin: 4px 0;
}
.bubble-text :deep(a) {
  color: var(--accent);
}

/* ===== 收尾结论 ===== */
.conclusion-chat { margin: 0; }
.conclusion-bubble {
  background: var(--surface-alt);
  border: 1px solid var(--border-soft);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.conclusion-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 6px;
}
.conclusion-icon { flex-shrink: 0; }
.conclusion-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
.btn-md-action {
  background: transparent;
  border: 1px solid var(--divider-soft);
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 10px;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.btn-md-action:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.conclusion-body {
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-primary);
  word-break: break-word;
}
.conclusion-body :deep(.code-block) {
  background: var(--bg); border: 1px solid var(--divider);
  border-radius: 4px; padding: 6px 10px;
  margin: 4px 0; font-size: 11px;
  font-family: monospace; white-space: pre-wrap;
  overflow-x: auto;
}
.conclusion-body :deep(.inline-code) {
  background: var(--surface-muted); padding: 1px 4px;
  border-radius: 3px; font-size: 11px; font-family: monospace;
}
.conclusion-body :deep(h1) {
  font-size: 15px; font-weight: 700; margin: 12px 0 6px;
  color: var(--text-primary); line-height: 1.3;
}
.conclusion-body :deep(h2) {
  font-size: 13px; font-weight: 700; margin: 12px 0 4px;
  color: var(--text-primary); line-height: 1.3;
  padding-bottom: 3px; border-bottom: 1px solid var(--divider-soft);
}
.conclusion-body :deep(h3) {
  font-size: 12px; font-weight: 600; margin: 10px 0 3px;
  color: var(--text-secondary); line-height: 1.4;
}
.conclusion-body :deep(h4),
.conclusion-body :deep(h5),
.conclusion-body :deep(h6) {
  font-size: 12px; font-weight: 600; margin: 8px 0 2px;
  color: var(--text-secondary);
}
.conclusion-body :deep(p) {
  margin: 4px 0; line-height: 1.65;
}
.conclusion-body :deep(ul) {
  margin: 4px 0; padding-left: 18px;
}
.conclusion-body :deep(li) {
  margin: 2px 0; line-height: 1.65;
}
.conclusion-body :deep(blockquote) {
  margin: 6px 0; padding: 4px 10px;
  border-left: 3px solid var(--accent-soft);
  background: rgba(255, 255, 255, 0.02);
  color: var(--text-secondary);
}
.conclusion-body :deep(blockquote p) {
  margin: 2px 0;
}
.conclusion-body :deep(ol) {
  padding-left: 20px;
  margin: 4px 0;
}
.conclusion-body :deep(ol li) {
  margin: 2px 0;
  font-size: 12px;
  line-height: 1.65;
}
.conclusion-body :deep(a) {
  color: var(--accent);
  text-decoration: underline;
}
.conclusion-body :deep(strong) {
  font-weight: 600; color: var(--text-primary);
}

/* ===== 执行卡片 ===== */
.block {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--divider-soft);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.block-header {
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.block-icon { flex-shrink: 0; }
.tag-icon { flex-shrink: 0; vertical-align: middle; }
.meta-icon { flex-shrink: 0; vertical-align: middle; }

.block-content {
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
}

.block-plan { background: var(--surface-muted); border-left: 3px solid var(--warning); }
.block-plan .block-header { color: var(--warning); }

.block-execution { background: var(--surface-muted); border-left: 3px solid var(--accent-soft); }
.block-execution .block-header { color: var(--accent-soft); }

.block-observation { background: var(--surface-muted); border-color: var(--divider); }
.block-observation .block-header { color: var(--text-secondary); }

.block-thinking { background: var(--surface-muted); border-color: var(--divider-soft); }
.block-thinking .block-header { color: var(--text-tertiary); }

.block-error { background: var(--surface-muted); border-left: 3px solid var(--danger); }
.block-error .block-header { color: var(--danger); }

.block-status { border: none; padding: 4px 12px; }
.status-text { font-size: 11px; color: var(--text-disabled); font-style: italic; text-align: center; }

.pending-tag { font-size: 10px; color: var(--warning); }
.running-tag { font-size: 10px; color: var(--accent); animation: pulse 1s infinite; }
.duration-tag { font-size: 10px; color: var(--text-tertiary); }

.thinking-label { color: var(--text-secondary); }
.thinking-active { animation: pulse 1.5s infinite; color: var(--accent-soft); }
.thinking-toggle {
  font-size: 10px;
  font-weight: 400;
  color: var(--text-tertiary);
  margin-left: auto;
}
.thinking-content {
  max-height: 300px;
  overflow-y: auto;
}
.thinking-pre {
  font-size: 11px;
  font-family: monospace;
  white-space: pre-wrap;
  color: var(--text-tertiary);
  margin: 0;
  line-height: 1.5;
}
.thinking-empty {
  font-size: 11px;
  color: var(--text-disabled);
  font-style: italic;
}

@keyframes pulse {
  0%, 100% { opacity: 1; } 50% { opacity: 0.5; }
}

.cmd-content code {
  background: var(--bg);
  padding: 4px 8px;
  border-radius: 4px;
  display: block;
  font-family: monospace;
  font-size: 12px;
  color: var(--accent-soft);
  white-space: pre-wrap;
}

.output-pre {
  font-size: 11px;
  font-family: monospace;
  white-space: pre-wrap;
  color: var(--text-tertiary);
  margin: 0;
  max-height: 200px;
  overflow-y: auto;
  line-height: 1.4;
}

.expand-btn {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 8px;
  font-size: 10px;
  color: var(--accent);
  background: transparent;
  border: 1px solid var(--divider-soft);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.expand-btn:hover {
  background: var(--surface-alt);
  border-color: var(--accent);
}

.block-meta {
  font-size: 10px;
  color: var(--warning);
  margin-top: 4px;
}

.block-content :deep(.code-block) {
  background: var(--bg); border: 1px solid var(--divider);
  border-radius: 4px; padding: 6px 10px;
  margin: 4px 0; font-size: 11px;
  font-family: monospace; white-space: pre-wrap;
  overflow-x: auto;
}
.block-content :deep(.inline-code) {
  background: var(--surface-alt); padding: 1px 4px;
  border-radius: 3px; font-size: 11px; font-family: monospace;
}
</style>
