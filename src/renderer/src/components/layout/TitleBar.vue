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
    </div>
    <div class="title-bar-center">
      <span class="title-bar-text">zTerm</span>
    </div>
    <div v-if="isWindows" class="title-bar-controls">
      <button
        v-if="showLeftPanelToggle"
        class="win-btn title-toggle-btn title-toggle-btn--win"
        :class="{ 'is-collapsed': leftPanelVisible === false }"
        :title="leftPanelVisible ? '隐藏机器列表' : '显示机器列表'"
        :aria-label="leftPanelVisible ? '隐藏机器列表' : '显示机器列表'"
        @click="$emit('toggle-left-panel')"
      >
        <span class="title-layout-icon title-layout-icon--left" aria-hidden="true">
          <span class="title-layout-icon__pane"></span>
        </span>
      </button>
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
  width: 132px;
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
  width: 26px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: color-mix(in srgb, var(--text-tertiary) 92%, transparent);
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast),
    transform var(--transition-fast);
}

.title-toggle-btn:hover {
  background: color-mix(in srgb, var(--workbench-tab-hover-bg, var(--divider)) 26%, transparent);
  color: var(--text-secondary);
}

.title-toggle-btn:active {
  transform: scale(0.96);
}

.title-toggle-btn.is-collapsed {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: color-mix(in srgb, var(--accent) 58%, var(--text-secondary));
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
