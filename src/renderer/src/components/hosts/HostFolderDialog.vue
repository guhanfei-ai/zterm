<template>
  <Teleport to="body">
    <div class="folder-overlay" @click.self="close" @keydown.esc.stop.prevent="close">
      <form class="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title" @submit.prevent="save">
        <h2 id="folder-dialog-title">{{ folder ? '重命名文件夹' : '创建文件夹' }}</h2>
        <label for="host-folder-name">文件夹名称</label>
        <input id="host-folder-name" ref="input" v-model="name" maxlength="80" required :disabled="saving" autocomplete="off" />
        <p class="hint">用于整理远程主机，可将主机拖入文件夹。</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="folder-actions">
          <button type="button" :disabled="saving" @click="close">取消</button>
          <button type="submit" class="primary" :disabled="!name.trim() || saving">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useHostsStore } from '@/stores/hosts'
import type { HostTreeFolder } from '@/utils/hostTree'

const props = defineProps<{ folder?: HostTreeFolder | null }>()
const emit = defineEmits<{ close: [] }>()
const store = useHostsStore()
const name = ref(props.folder?.name ?? '')
const saving = ref(false)
const error = ref('')
const input = ref<HTMLInputElement | null>(null)
onMounted(() => { input.value?.focus(); input.value?.select() })
function close(): void { if (!saving.value) emit('close') }
async function save(): Promise<void> {
  if (saving.value || !name.value.trim()) return
  saving.value = true
  error.value = ''
  try {
    await store.saveFolder(name.value, props.folder?.id)
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存文件夹失败，请重试。'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.folder-overlay { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, .6); }
.folder-dialog { width: min(360px, calc(100vw - 32px)); padding: 20px; border: 1px solid var(--divider); border-radius: var(--radius-container); background: var(--surface); box-shadow: var(--shadow-dialog); }
.folder-dialog h2 { margin: 0 0 18px; font-size: 16px; color: var(--text-primary); }
.folder-dialog label { display: block; margin-bottom: 8px; font-size: 13px; color: var(--text-secondary); }
.folder-dialog input { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid var(--divider); border-radius: var(--radius-control); background: var(--bg); color: var(--text-primary); font: inherit; font-size: 13px; }
.folder-dialog input:focus { outline: 1px solid var(--accent); }
.hint, .error { font-size: 12px; line-height: 1.6; color: var(--text-tertiary); }
.error { color: var(--danger); }
.folder-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.folder-actions button { padding: 7px 18px; border: 1px solid var(--divider); border-radius: var(--radius-control); background: var(--surface-alt); color: var(--text-secondary); font: inherit; font-size: 13px; cursor: pointer; }
.folder-actions button.primary { border-color: var(--accent); background: var(--accent); color: var(--bg); }
.folder-actions button:disabled { opacity: .5; cursor: default; }
</style>
