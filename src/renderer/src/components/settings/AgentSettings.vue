<template>
  <form class="agent-settings" @submit.prevent="save">
    <h2>工具对话</h2>
    <label for="agent-max-steps">每轮工具步数上限</label>
    <div class="budget-row">
      <input
        id="agent-max-steps"
        v-model.number="maxSteps"
        type="number"
        min="1"
        max="1000"
        step="1"
        required
        :disabled="loading || saving"
        aria-describedby="agent-budget-hint"
      />
      <span>步</span>
      <button type="submit" :disabled="!loaded || !valid || saving">{{ saving ? '保存中…' : '保存' }}</button>
    </div>
    <p id="agent-budget-hint">可设为 1～1000，默认 100。达到上限后暂停，可点击继续；每次发送消息或继续都会重新计数。</p>
    <p>保存后对下一轮对话、继续和恢复任务生效，当前正在执行的一轮保持原上限。步数越大，单轮可能耗时更长、消耗更多模型额度。</p>
    <p v-if="loading || feedback" role="status" :class="{ error: failed }">{{ loading ? '正在读取设置…' : feedback }}</p>
  </form>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

const maxSteps = ref<number | string>(100)
const loading = ref(true)
const loaded = ref(false)
const saving = ref(false)
const feedback = ref('')
const failed = ref(false)
const valid = computed(() => typeof maxSteps.value === 'number' && Number.isSafeInteger(maxSteps.value) && maxSteps.value >= 1 && maxSteps.value <= 1000)

watch(maxSteps, () => { feedback.value = ''; failed.value = false })

onMounted(async () => {
  try {
    maxSteps.value = await window.electronAPI.preferences.get('agentMaxSteps') as number
    loaded.value = true
  } catch {
    failed.value = true
    feedback.value = '读取设置失败，请重新打开设置后重试。'
  } finally {
    loading.value = false
  }
})

async function save(): Promise<void> {
  if (!loaded.value || !valid.value || saving.value) return
  saving.value = true
  feedback.value = ''
  failed.value = false
  try {
    await window.electronAPI.preferences.set('agentMaxSteps', maxSteps.value)
    feedback.value = '已保存，将从下一轮生效。'
  } catch {
    failed.value = true
    feedback.value = '保存失败，请重试。'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.agent-settings {
  margin-top: 24px;
  padding: 20px;
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-container);
}
.agent-settings h2 { margin: 0 0 16px; font-size: 16px; color: var(--text-primary); }
.agent-settings label { font-size: 13px; color: var(--text-primary); }
.budget-row { display: flex; align-items: center; gap: 10px; margin: 8px 0 12px; color: var(--text-secondary); }
.budget-row input, .budget-row button {
  padding: 7px 12px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  color: var(--text-primary);
  background: var(--surface);
  font: inherit;
  font-size: 13px;
}
.budget-row input { width: 100px; }
.budget-row input:focus { outline: 1px solid var(--accent); }
.budget-row button { cursor: pointer; }
.budget-row button:disabled { opacity: .5; cursor: default; }
.agent-settings p { margin: 8px 0 0; font-size: 12px; line-height: 1.6; color: var(--text-tertiary); }
.agent-settings p.error { color: var(--danger); }
</style>
