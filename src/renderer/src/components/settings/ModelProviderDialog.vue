<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <span>模型提供商设置</span>
        <button class="btn-icon" @click="$emit('close')">&#x2715;</button>
      </div>
      <div class="dialog-body">
        <ModelProviderSettingsForm />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ModelProviderSettingsForm from './ModelProviderSettingsForm.vue'

defineEmits<{ close: [] }>()
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.dialog {
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-container);
  width: 480px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-dialog);
  max-height: 70vh;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--divider);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.dialog-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}
</style>
