<template>
  <div class="confirm-overlay" @click.self="$emit('cancel')">
    <div class="confirm-dialog">
      <div class="confirm-header">{{ title }}</div>
      <div class="confirm-body">{{ message }}</div>
      <div class="confirm-footer">
        <button class="btn btn-cancel" @click="$emit('cancel')">取消</button>
        <button class="btn btn-confirm" @click="$emit('confirm')">确定</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  message: string
}>()

defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  backdrop-filter: blur(2px);
}

.confirm-dialog {
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-container);
  width: 380px;
  box-shadow: var(--shadow-dialog);
}

.confirm-header {
  padding: 16px 20px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--divider);
}

.confirm-body {
  padding: 20px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  padding: var(--space-md) 20px;
  border-top: 1px solid var(--divider);
}

.btn {
  padding: 7px 22px;
  border-radius: var(--radius-control);
  border: none;
  cursor: pointer;
  font-size: 13px;
  transition: all var(--transition-fast);
}

.btn-cancel {
  background: var(--surface-alt);
  color: var(--text-secondary);
  border: 1px solid var(--divider);
}

.btn-cancel:hover {
  background: var(--divider);
  color: var(--text-primary);
}

.btn-confirm {
  background: var(--danger);
  color: #fff;
}

.btn-confirm:hover {
  background: var(--danger-hover);
}
</style>
