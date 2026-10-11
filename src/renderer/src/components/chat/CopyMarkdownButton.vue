<template>
  <button class="copy-markdown" :class="state" type="button" :disabled="disabled || copying || !text"
    title="复制 Markdown 原文" :aria-label="state === 'copied' ? '已复制 Markdown 原文' : '复制 Markdown 原文'" @click="copy">
    <svg v-if="state === 'copied'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
    <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
    <span aria-live="polite">{{ copying ? '复制中…' : state === 'copied' ? '已复制' : state === 'failed' ? '复制失败，重试' : '复制 Markdown' }}</span>
  </button>
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { copyTextToClipboard } from '@/utils/clipboard'

const props = defineProps<{ text: string; disabled?: boolean }>()
const state = ref<'idle' | 'copied' | 'failed'>('idle')
const copying = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | undefined
function reset(): void {
  clearTimeout(resetTimer)
  state.value = 'idle'
}
async function copy(): Promise<void> {
  if (props.disabled || copying.value || !props.text) return
  reset()
  copying.value = true
  const text = props.text
  try {
    await copyTextToClipboard(text)
    if (props.text === text) {
      state.value = 'copied'
      resetTimer = setTimeout(reset, 2000)
    }
  } catch {
    state.value = 'failed'
  } finally {
    copying.value = false
  }
}
watch(() => props.text, reset)
onUnmounted(() => clearTimeout(resetTimer))
</script>

<style scoped>
.copy-markdown { display: inline-flex; align-items: center; justify-content: center; gap: 4px; flex-shrink: 0; min-height: 24px; padding: 3px 6px; border: 1px solid var(--divider-soft, var(--divider)); border-radius: var(--radius-sm, 4px); background: transparent; color: var(--text-secondary); font: inherit; font-size: 10px; line-height: 1.4; cursor: pointer; }
.copy-markdown:hover { border-color: var(--accent); color: var(--accent); background: var(--hover-overlay); }
.copy-markdown:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
.copy-markdown.copied { color: var(--success); }
.copy-markdown.failed { color: var(--danger); }
.copy-markdown:disabled { opacity: .5; cursor: default; }
</style>
