<template>
  <div class="appearance-settings">
    <h2 class="section-title">外观</h2>
    <p class="section-desc">选择主题库与主题应用方式</p>

    <div class="block">
      <div class="block-label">应用方式</div>
      <div class="strategy-row">
        <button
          v-for="opt in strategyOptions"
          :key="opt.id"
          class="strategy-card"
          :class="{ active: themeStore.applyStrategy === opt.id }"
          @click="themeStore.setStrategy(opt.id)"
        >
          <div class="strategy-card-icon" v-html="opt.icon"></div>
          <div class="strategy-card-body">
            <div class="strategy-card-label">{{ opt.label }}</div>
            <div class="strategy-card-desc">{{ opt.desc }}</div>
          </div>
          <div v-if="themeStore.applyStrategy === opt.id" class="strategy-card-check" aria-label="已选中">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
        </button>
      </div>
    </div>

    <div class="block">
      <div class="block-label">
        <span>主题库</span>
        <span class="block-label-meta">{{ availableThemes.length }} 套主题</span>
      </div>
      <div class="theme-grid-scroll">
        <div
          v-for="group in groupedThemes"
          :key="group.key"
          class="theme-group"
        >
          <div class="theme-group-title">{{ group.label }}</div>
          <div class="theme-grid">
            <button
              v-for="theme in group.items"
              :key="theme.id"
              class="theme-card"
              :class="{
                active: !theme.isPlaceholder && themeStore.themeId === theme.id && themeStore.applyStrategy === 'manual',
                placeholder: theme.isPlaceholder,
                'system-applied': themeStore.applyStrategy === 'system' && isSystemAppliedTheme(theme)
              }"
              :disabled="theme.isPlaceholder"
              @click="onPick(theme.id)"
            >
              <div class="theme-preview" :style="previewStyle(theme)">
                <div class="preview-strip">
                  <span class="preview-dot" :style="{ background: theme.preview.accent }"></span>
                  <span class="preview-dot" :style="{ background: theme.preview.surface }"></span>
                  <span class="preview-dot" :style="{ background: theme.preview.surfaceAlt }"></span>
                </div>
                <div class="preview-body">
                  <div class="preview-line" :style="{ background: withAlpha(theme.preview.text, 0.55) }"></div>
                  <div class="preview-line short" :style="{ background: withAlpha(theme.preview.text, 0.35) }"></div>
                  <div class="preview-line" :style="{ background: withAlpha(theme.preview.text, 0.45) }"></div>
                </div>
              </div>
              <div class="theme-card-footer">
                <div class="theme-card-titles">
                  <div class="theme-card-label-row">
                    <span class="theme-card-label">{{ theme.name }}</span>
                    <span class="theme-card-kind" :class="`kind-${theme.kind}`">{{ theme.kind === 'dark' ? '暗' : '亮' }}</span>
                  </div>
                  <div class="theme-card-desc">{{ theme.desc }}</div>
                </div>
                <div class="theme-card-status">
                  <span v-if="theme.isPlaceholder" class="status-tag status-coming">敬请期待</span>
                  <span v-else-if="isCurrentlyApplied(theme)" class="status-tag status-active">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    应用中
                  </span>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>

    <p class="hint">
      当前应用：<span class="resolved-label">{{ themeStore.currentTheme.name }}</span>
      <span v-if="themeStore.applyStrategy === 'system'" class="hint-tag">跟随系统 · 系统当前{{ themeStore.systemPrefersDark ? '暗' : '亮' }}</span>
    </p>
    <p class="hint hint-secondary">
      左侧导航栏的「主题」按钮只做
      <span class="resolved-label">暗色 / 亮色</span>
      快速切换；「跟随系统」与具体主题请在本页手动选择。
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useThemeStore, type ApplyStrategy } from '@/stores/theme'
import {
  listThemesByGroup,
  GROUP_LABELS,
  type ThemeDefinition
} from '@/assets/themes'

const themeStore = useThemeStore()

const strategyOptions: { id: ApplyStrategy; label: string; desc: string; icon: string }[] = [
  {
    id: 'manual',
    label: '手动',
    desc: '锁定当前选择的主题，不跟随系统亮暗变化',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2"/><path d="M12 22v-2"/><path d="m17 20.66-1-1.73"/><path d="M11 10.27 7 3.34"/><path d="m20.66 17-1.73-1"/><path d="m3.34 7 1.73 1"/><path d="M14 12h8"/><path d="M2 12h2"/><path d="m20.66 7-1.73 1"/><path d="m3.34 17 1.73-1"/><path d="m17 3.34-1 1.73"/><path d="m11 13.73-4 6.93"/></svg>'
  },
  {
    id: 'system',
    label: '跟随系统',
    desc: '随操作系统亮暗设置自动切换默认主题',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>'
  }
]

const availableThemes = computed(() => themeStore.listAvailableThemes())

const groupedThemes = computed(() => {
  const groups = listThemesByGroup()
  const order = ['default', 'aurum', 'graphite', 'amber', 'coming-soon']
  return order
    .filter(k => groups[k] && groups[k].length > 0)
    .map(k => ({
      key: k,
      label: GROUP_LABELS[k] ?? k,
      items: groups[k]
    }))
})

function onPick(id: string): void {
  themeStore.setThemeId(id)
}

function isCurrentlyApplied(theme: ThemeDefinition): boolean {
  return themeStore.currentTheme.id === theme.id
}

function isSystemAppliedTheme(theme: ThemeDefinition): boolean {
  return themeStore.applyStrategy === 'system' && themeStore.currentTheme.id === theme.id
}

function previewStyle(theme: ThemeDefinition): Record<string, string> {
  return {
    background: theme.preview.chrome,
    borderColor: theme.preview.surfaceAlt
  }
}

function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const expanded = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean
  const r = parseInt(expanded.slice(0, 2), 16)
  const g = parseInt(expanded.slice(2, 4), 16)
  const b = parseInt(expanded.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
</script>

<style scoped>
.appearance-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.section-desc {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.block-label-meta {
  font-size: 11px;
  color: var(--text-disabled);
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}

/* ===== 应用方式 ===== */
.strategy-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.strategy-card {
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-container);
  padding: 12px 14px;
  cursor: pointer;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  text-align: left;
  transition: all var(--transition-fast);
  font-family: inherit;
  color: var(--text-primary);
}

.strategy-card:hover {
  border-color: var(--border-soft);
  background: var(--surface-alt);
}

.strategy-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.strategy-card-icon {
  color: var(--text-secondary);
  flex-shrink: 0;
  margin-top: 2px;
}

.strategy-card.active .strategy-card-icon {
  color: var(--accent);
}

.strategy-card-body {
  flex: 1;
  min-width: 0;
}

.strategy-card-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}

.strategy-card-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
  line-height: 1.4;
}

.strategy-card-check {
  color: var(--accent);
  flex-shrink: 0;
}

/* ===== 主题网格 ===== */
.theme-grid-scroll {
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.theme-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.theme-group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  padding-left: 2px;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.theme-card {
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-container);
  padding: 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
  transition: all var(--transition-fast);
  font-family: inherit;
  color: var(--text-primary);
  position: relative;
  overflow: hidden;
}

.theme-card:hover:not(:disabled) {
  border-color: var(--border-soft);
  background: var(--surface-alt);
}

.theme-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.theme-card.system-applied {
  border-style: dashed;
}

.theme-card.placeholder {
  cursor: not-allowed;
  opacity: 0.62;
}

.theme-card.placeholder:hover {
  border-color: var(--divider);
  background: var(--surface);
}

/* ===== 预览 ===== */
.theme-preview {
  border-radius: var(--radius-control);
  overflow: hidden;
  border: 1px solid var(--divider-soft);
  height: 64px;
  display: flex;
  flex-direction: column;
  position: relative;
}

.preview-strip {
  height: 14px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  background: rgba(0, 0, 0, 0.18);
}

.preview-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.preview-body {
  flex: 1;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: center;
}

.preview-line {
  height: 4px;
  border-radius: 2px;
  width: 90%;
}

.preview-line.short {
  width: 55%;
}

/* ===== 卡片文字 ===== */
.theme-card-footer {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 0 2px;
}

.theme-card-titles {
  flex: 1;
  min-width: 0;
}

.theme-card-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.theme-card-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.theme-card-kind {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 500;
  flex-shrink: 0;
  border: 1px solid transparent;
}

.theme-card-kind.kind-dark {
  color: #b6c7e3;
  background: rgba(70, 127, 240, 0.10);
  border-color: rgba(70, 127, 240, 0.25);
}

.theme-card-kind.kind-light {
  color: #806d4d;
  background: rgba(184, 152, 95, 0.12);
  border-color: rgba(184, 152, 95, 0.28);
}

.theme-card-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 3px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.theme-card-status {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 8px;
  font-weight: 500;
  white-space: nowrap;
}

.status-tag.status-active {
  background: var(--accent-muted);
  color: var(--accent);
}

.status-tag.status-coming {
  background: var(--surface-alt);
  color: var(--text-disabled);
  border: 1px dashed var(--divider);
}

/* ===== 提示 ===== */
.hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0;
}

.hint-secondary {
  margin-top: -4px;
}

.hint-tag {
  margin-left: 8px;
  padding: 1px 8px;
  background: var(--surface-alt);
  border: 1px solid var(--divider);
  border-radius: 8px;
  font-size: 11px;
  color: var(--text-secondary);
}

.resolved-label {
  color: var(--accent);
  font-weight: 500;
}
</style>