<template>
  <div class="settings-page">
    <SettingsSidebar
      :active-section="activeSection"
      @navigate="activeSection = $event"
      @back="$emit('back')"
    />
    <div class="settings-content">
      <!-- 模型设置 -->
      <div v-if="activeSection === 'model'" class="settings-section">
        <ModelProviderSettingsForm />
      </div>

      <!-- 外观设置 -->
      <div v-else-if="activeSection === 'appearance'" class="settings-section settings-section-wide">
        <AppearanceSettings />
      </div>

      <!-- 快捷键设置 -->
      <div v-else-if="activeSection === 'shortcuts'" class="settings-section">
        <h2 class="section-title">快捷键</h2>
        <p class="section-desc">自定义键盘快捷方式</p>
        <div class="placeholder-card">
          <div class="placeholder-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>
            </svg>
          </div>
          <p class="placeholder-text">快捷键编辑器将在后续版本中提供</p>
          <p class="placeholder-hint">支持自定义所有操作的键盘快捷方式</p>
        </div>
      </div>

      <!-- 终端设置 -->
      <div v-else-if="activeSection === 'terminal'" class="settings-section">
        <h2 class="section-title">终端</h2>
        <p class="section-desc">配置终端外观和行为</p>
        <div class="placeholder-card">
          <div class="placeholder-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 17 10 11 4 5"/>
              <line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
          </div>
          <p class="placeholder-text">终端偏好设置将在后续版本中提供</p>
          <p class="placeholder-hint">包括字体、字号、光标样式等</p>
        </div>
      </div>

      <!-- 关于 -->
      <div v-else-if="activeSection === 'about'" class="settings-section">
        <h2 class="section-title">关于</h2>
        <p class="section-desc">应用信息与更新</p>
        <div class="about-card">
          <div class="about-logo">
            <span class="logo-text">zTerm</span>
          </div>
          <div class="about-version">
            当前版本：{{ updateStore.currentVersion ? `v${updateStore.currentVersion}` : '未知版本' }}
          </div>
          <AppUpdatePanel title="软件更新" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useUpdateStore } from '@/stores/update'
import SettingsSidebar from './SettingsSidebar.vue'
import ModelProviderSettingsForm from './ModelProviderSettingsForm.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import AppUpdatePanel from '@/components/common/AppUpdatePanel.vue'

const props = withDefaults(defineProps<{
  initialSection?: string
}>(), {
  initialSection: 'model'
})

defineEmits<{
  back: []
}>()

const updateStore = useUpdateStore()
const activeSection = ref(props.initialSection || 'model')

watch(() => props.initialSection, (val) => {
  if (val) activeSection.value = val
})
</script>

<style scoped>
.settings-page {
  display: flex;
  height: 100%;
  background: var(--bg);
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}

.settings-section {
  max-width: 640px;
}

.settings-section-wide {
  max-width: 880px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.section-desc {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0 0 20px;
}

.placeholder-card {
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-container);
  padding: 40px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.placeholder-icon {
  color: var(--text-disabled);
  margin-bottom: 4px;
}

.placeholder-text {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}

.placeholder-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0;
}

.about-card {
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-container);
  padding: 24px;
}

.about-logo {
  margin-bottom: 16px;
}

.logo-text {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.5px;
}

.about-version {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}
</style>
