<template>
  <div class="title-bar">
    <div class="title-bar-side title-bar-side--leading" :class="{ mac: !isWindows }">
      <div v-if="showLeftPanelToggle" class="title-bar-action-slot">
        <button
          class="title-toggle-btn"
          :class="{ 'is-collapsed': leftPanelVisible === false }"
          :title="leftPanelVisible ? '隐藏机器列表' : '显示机器列表'"
          :aria-label="leftPanelVisible ? '隐藏机器列表' : '显示机器列表'"
          @click="$emit('toggle-left-panel')"
        >
          <span class="title-layout-icon title-layout-icon--left" aria-hidden="true">
            <span class="title-layout-icon__pane"></span>
          </span>
        </button>
      </div>
      <div class="title-brand title-brand-leading" aria-label="zTerm">
        <span class="title-brand-mark" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <polyline points="7 10 10 12 7 14" />
            <line x1="12.5" y1="15" x2="17" y2="15" />
          </svg>
        </span>
        <span class="title-bar-text">zTerm</span>
      </div>
    </div>
    <div class="title-bar-center">
      <span class="title-workspace-label">工作台</span>
    </div>
    <div v-if="isWindows" class="title-bar-controls">
      <button
        class="win-btn title-toggle-btn title-toggle-btn--win"
        :class="{ 'is-collapsed': rightPanelVisible === false }"
        :title="rightPanelVisible ? '隐藏对话面板' : '显示对话面板'"
        :aria-label="rightPanelVisible ? '隐藏对话面板' : '显示对话面板'"
        @click="$emit('toggle-right-panel')"
      >
        <span class="title-layout-icon title-layout-icon--right" aria-hidden="true">
          <span class="title-layout-icon__pane"></span>
        </span>
      </button>
      <button class="win-btn win-btn-min" title="最小化" @click="onMinimize">
        <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5" width="12" height="1.5" fill="currentColor"/></svg>
      </button>
      <button class="win-btn win-btn-max" title="最大化" @click="onMaximize">
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
      </button>
      <button class="win-btn win-btn-close" title="关闭" @click="onClose">
        <svg width="12" height="12" viewBox="0 0 12 12"><line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" stroke-width="1.5"/><line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" stroke-width="1.5"/></svg>
      </button>
    </div>
    <div v-else class="title-bar-side title-bar-side--trailing">
      <div class="title-bar-action-slot">
        <button
          class="title-toggle-btn"
          :class="{ 'is-collapsed': rightPanelVisible === false }"
          :title="rightPanelVisible ? '隐藏对话面板' : '显示对话面板'"
          :aria-label="rightPanelVisible ? '隐藏对话面板' : '显示对话面板'"
          @click="$emit('toggle-right-panel')"
        >
          <span class="title-layout-icon title-layout-icon--right" aria-hidden="true">
            <span class="title-layout-icon__pane"></span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

defineProps<{
  showLeftPanelToggle?: boolean
  leftPanelVisible?: boolean
  rightPanelVisible?: boolean
}>()

defineEmits<{
  'toggle-left-panel': []
  'toggle-right-panel': []
}>()

const isWindows = computed(() => window.electronAPI.platform === 'win32')

function onMinimize(): void { window.electronAPI.window.minimize() }
function onMaximize(): void { window.electronAPI.window.maximize() }
function onClose(): void { window.electronAPI.window.close() }
</script>

<style scoped>
.title-bar-side--leading,
.title-bar-side--trailing {
  display: flex;
  align-items: center;
}

.title-bar-side--leading {
  justify-content: flex-end;
  padding-right: 12px;
}

.title-bar-side--leading.mac {
  position: relative;
  width: 180px;
  padding-right: 12px;
}

.title-bar-side--leading.mac .title-bar-action-slot {
  position: absolute;
  top: 50%;
  left: 68px;
  transform: translateY(-50%);
}

.title-bar-side--trailing {
  justify-content: flex-end;
  width: 132px;
  padding-right: 18px;
}

.title-bar-action-slot {
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: no-drag;
}

.title-toggle-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast),
    transform var(--transition-fast);
}

.title-toggle-btn:hover {
  background: var(--workbench-tab-hover-bg, var(--hover-overlay));
  color: var(--text-secondary);
}

.title-toggle-btn:active {
  transform: scale(0.96);
}

.title-toggle-btn.is-collapsed {
  background: var(--accent-muted);
  color: var(--accent);
}

.title-toggle-btn--win {
  width: 32px;
  height: 32px;
}

.title-layout-icon {
  position: relative;
  width: 14px;
  height: 11px;
  border: 1.5px solid currentColor;
  border-radius: 2px;
  opacity: 0.92;
}

.title-layout-icon::after {
  content: '';
  position: absolute;
  top: 1px;
  bottom: 1px;
  width: 1px;
  background: currentColor;
  opacity: 0.88;
}

.title-layout-icon__pane {
  position: absolute;
  top: 1px;
  bottom: 1px;
  width: 4px;
  border-radius: 1px;
  background: currentColor;
}

/* 紧凑标题栏：保留原生窗口控制与拖拽区域。 */
.title-bar.title-bar {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  user-select: none;
  -webkit-app-region: drag;
  height: var(--titlebar-height);
  background: var(--chrome-bar-bg, var(--surface-muted));
  border-bottom: 1px solid var(--workbench-border-soft, var(--divider-soft));
}

.title-bar-center {
  display: flex;
  justify-content: center;
  flex: 1;
  min-width: 0;
  height: 100%;
  align-items: center;
}

.title-brand-leading {
  margin-left: 12px;
}

.title-brand {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text-secondary);
}

.title-brand-mark {
  display: inline-flex;
  align-items: center;
  color: var(--accent);
}

.title-bar-text {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.title-workspace-label {
  margin-left: 8px;
  padding-left: 9px;
  border-left: 1px solid var(--divider, rgba(255,255,255,.12));
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 400;
}

.title-bar-center .title-workspace-label {
  margin-left: 0;
  padding-left: 0;
  border-left: 0;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.2px;
  color: var(--text-secondary);
}

.title-bar-side--leading.mac {
  width: 180px;
}

.title-bar-side--leading.mac .title-brand-leading {
  position: absolute;
  left: 108px;
  margin-left: 0;
}

.title-bar-side--leading:not(.mac) {
  width: 190px;
  justify-content: flex-start;
  padding-left: 12px;
  gap: 10px;
}

.title-bar-side--trailing {
  flex-shrink: 0;
  width: 132px;
}

.win-btn {
  height: var(--titlebar-height);
  width: 40px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.title-bar-controls { display: flex; flex-shrink: 0; }
.title-bar button,
.title-bar-controls,
.title-bar-action-slot { -webkit-app-region: no-drag; }
.win-btn:hover { background: var(--hover-overlay); color: var(--text-primary); }
.win-btn-close:hover { background: var(--danger); color: #fff; }

.title-layout-icon--left::after {
  left: 4px;
}

.title-layout-icon--left .title-layout-icon__pane {
  left: 1px;
}

.title-layout-icon--right::after {
  right: 4px;
}

.title-layout-icon--right .title-layout-icon__pane {
  right: 1px;
}
</style>
