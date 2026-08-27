<template>
  <div class="markdown-body" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useMarkdownRenderer } from '@/composables/useMarkdownRenderer'

const props = defineProps<{
  text: string
}>()

const { renderMarkdown } = useMarkdownRenderer()

const renderedHtml = computed(() => renderMarkdown(props.text))
</script>

<style scoped>
/* Base markdown-body styles — shared across chat & agent views */
.markdown-body {
  font-size: 12px;
  line-height: 1.65;
  word-break: break-word;
  color: var(--text-primary);
}

.markdown-body :deep(.code-block) {
  background: var(--surface-muted);
  border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  margin: 4px 0;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  white-space: pre-wrap;
  overflow-x: auto;
}

.markdown-body :deep(.inline-code) {
  background: var(--surface-alt);
  color: var(--accent-soft);
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-family: var(--font-mono, monospace);
}

.markdown-body :deep(h1) {
  font-size: 15px;
  font-weight: 700;
  margin: 12px 0 6px;
  color: var(--text-primary);
  line-height: 1.3;
}

.markdown-body :deep(h2) {
  font-size: 13px;
  font-weight: 700;
  margin: 12px 0 4px;
  color: var(--text-primary);
  line-height: 1.3;
  padding-bottom: 3px;
  border-bottom: 1px solid var(--divider-soft);
}

.markdown-body :deep(h3) {
  font-size: 12px;
  font-weight: 600;
  margin: 10px 0 3px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  font-size: 12px;
  font-weight: 600;
  margin: 8px 0 2px;
  color: var(--text-secondary);
}

.markdown-body :deep(p) {
  margin: 4px 0;
  line-height: 1.65;
}

.markdown-body :deep(ul) {
  margin: 4px 0;
  padding-left: 18px;
}

.markdown-body :deep(ol) {
  padding-left: 20px;
  margin: 4px 0;
}

.markdown-body :deep(li) {
  margin: 2px 0;
  line-height: 1.65;
}

.markdown-body :deep(blockquote) {
  margin: 6px 0;
  padding: 4px 10px;
  border-left: 3px solid var(--accent-soft);
  background: rgba(255, 255, 255, 0.02);
  color: var(--text-secondary);
}

.markdown-body :deep(blockquote p) {
  margin: 2px 0;
}

.markdown-body :deep(a) {
  color: var(--accent);
  text-decoration: underline;
}

.markdown-body :deep(strong) {
  font-weight: 600;
  color: var(--text-primary);
}

.markdown-body :deep(table) {
  border-collapse: collapse;
  margin: 6px 0;
  width: 100%;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--divider);
  padding: 4px 8px;
  font-size: 11px;
}

.markdown-body :deep(th) {
  background: var(--surface-muted);
  font-weight: 600;
}
</style>
