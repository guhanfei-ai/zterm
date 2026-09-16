<template>
  <nav class="nav-rail" aria-label="工作区模式">
    <!-- 上部：模式切换 -->
    <div class="nav-rail-top">
      <button
        class="nav-rail-btn"
        :class="{ active: activeMode === 'local' }"
        title="本地终端"
        aria-label="本地终端"
        :aria-pressed="activeMode === 'local'"
        @click="$emit('set-mode', 'local')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
      </button>
      <button
        class="nav-rail-btn"
        :class="{ active: activeMode === 'direct' }"
        title="SSH 直连模式"
        aria-label="SSH 直连模式"
        :aria-pressed="activeMode === 'direct'"
        @click="$emit('set-mode', 'direct')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      </button>
      <button
        class="nav-rail-btn"
        :class="{ active: activeMode === 'jumpserver' }"
        title="堡垒机（Jumpserver）"
        aria-label="堡垒机（Jumpserver）"
        :aria-pressed="activeMode === 'jumpserver'"
        @click="$emit('set-mode', 'jumpserver')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
      </button>
    </div>

    <!-- 中部留白 -->
    <div class="nav-rail-spacer" />

    <!-- 下部：全局系统入口 -->
    <div class="nav-rail-bottom">
      <button class="nav-rail-btn" :title="themeToggleTitle" :aria-label="themeToggleTitle" @click="themeStore.quickToggle()">
        <svg v-if="themeStore.resolved === 'light'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      <button class="nav-rail-btn" title="设置" aria-label="设置" @click="$emit('open-settings')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button class="nav-rail-btn" title="关于" aria-label="关于" @click="$emit('open-about')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useThemeStore } from '@/stores/theme'
import type { ActiveMode } from '@/stores/hosts'

const props = defineProps<{
  activeMode: ActiveMode
}>()

defineEmits<{
  'set-mode': [mode: ActiveMode]
  'open-settings': []
  'open-about': []
}>()

const themeStore = useThemeStore()

const themeToggleTitle = computed(() => {
  if (themeStore.mode === 'system') return '主题：跟随系统（点击切换为暗色）'
  if (themeStore.resolved === 'dark') return '主题：暗色（点击切换为亮色）'
  return '主题：亮色（点击切换为暗色）'
})
</script>

<style scoped>
/* 视觉重构：窄而明确的模式栏，保留原有事件和入口。 */
.nav-rail.nav-rail {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  user-select: none;
  width: var(--nav-rail-width);
  background: var(--chrome-rail-bg, var(--surface-muted));
  border-right: 1px solid var(--chrome-rail-border, var(--divider));
  padding: 10px 0;
}

.nav-rail-top,
.nav-rail-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0;
}

.nav-rail-spacer { flex: 1; }

.nav-rail-btn {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  cursor: pointer;
  width: 44px;
  height: 36px;
  padding: 0;
  border-radius: var(--radius-control, 9px);
  color: var(--text-tertiary);
  transition: color var(--transition-fast), background-color var(--transition-fast);
}

.nav-rail-btn:hover {
  color: var(--text-primary);
  background: var(--workbench-rail-hover-bg, var(--hover-overlay));
}

.nav-rail-btn:active {
  background: var(--surface-alt);
}

.nav-rail-btn.active {
  color: var(--accent);
  background: var(--workbench-rail-active-bg, var(--accent-muted));
}

.nav-rail-btn svg { flex: 0 0 auto; width: 17px; height: 17px; }
</style>
