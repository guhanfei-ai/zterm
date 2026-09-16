<template>
  <div class="settings-page">
    <SettingsSidebar
      :active-section="activeSection"
      @navigate="activeSection = $event"
      @back="$emit('back')"
    />
    <div class="settings-content">
      <header class="settings-heading">
        <div>
          <h1>设置</h1>
          <p>调整 zTerm 的连接、外观与终端体验</p>
        </div>
      </header>
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
        <p class="section-desc">当前版本可用的键盘快捷方式</p>
        <ShortcutSettings />
      </div>

      <!-- 终端设置 -->
      <div v-else-if="activeSection === 'terminal'" class="settings-section">
        <h2 class="section-title">终端</h2>
        <p class="section-desc">配置终端外观和行为</p>
        <TerminalSettings />
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
import TerminalSettings from './TerminalSettings.vue'
import ShortcutSettings from './ShortcutSettings.vue'
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
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--bg);
}

.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 28px clamp(18px, 4vw, 48px) 40px;
}

.settings-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--divider-soft, var(--divider));
}

.settings-heading h1 {
  margin: 0 0 5px;
  color: var(--text-primary);
  font-size: 20px;
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: -.2px;
}

.settings-heading p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 12px;
}

.settings-section {
  max-width: 680px;
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

.about-card {
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-container);
  padding: 24px;
}

@media (max-width: 640px) {
  .settings-content { padding: 20px 16px 32px; }
  .settings-heading { margin-bottom: 18px; }
  .settings-heading h1 { font-size: 19px; }
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
