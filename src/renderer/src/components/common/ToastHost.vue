<template>
  <Teleport to="body">
    <transition-group name="toast" tag="div" class="toast-host">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast-item"
        :class="`toast-${toast.kind}`"
        role="status"
        @click="dismiss(toast.id)"
      >
        <span class="toast-icon" aria-hidden="true">
          <svg v-if="toast.kind === 'success'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <svg v-else-if="toast.kind === 'error'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </span>
        <span class="toast-message">{{ toast.message }}</span>
      </div>
    </transition-group>
  </Teleport>
</template>

<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { toasts, dismiss } = useToast()
</script>

<style scoped>
.toast-host {
  position: fixed;
  top: 44px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1500;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  max-width: min(520px, calc(100vw - 48px));
}

.toast-item {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 14px;
  background: var(--surface);
  border: 1px solid var(--border-soft, var(--divider));
  border-left-width: 3px;
  border-radius: var(--radius-control);
  box-shadow: var(--shadow-dialog, 0 6px 24px rgba(0, 0, 0, 0.25));
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  word-break: break-all;
  white-space: pre-line;
}

.toast-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-top: 1px;
}

.toast-success {
  border-left-color: var(--success, #4caf7d);
}

.toast-success .toast-icon {
  color: var(--success, #4caf7d);
}

.toast-error {
  border-left-color: var(--danger, #e05555);
}

.toast-error .toast-icon {
  color: var(--danger, #e05555);
}

.toast-info {
  border-left-color: var(--accent, #4a9eff);
}

.toast-info .toast-icon {
  color: var(--accent, #4a9eff);
}

/* 进出场动画 */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
