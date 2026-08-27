<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="dialog about-dialog">
      <div class="dialog-header">
        <span>关于 zTerm</span>
        <button class="btn-icon" @click="$emit('close')">&#x2715;</button>
      </div>

      <div class="dialog-body">
        <div class="about-hero">
          <div class="about-mark">Ai</div>
          <div class="about-copy">
            <div class="about-title">zTerm</div>
            <div class="about-subtitle">终端 AI 协作桌面工作台</div>
          </div>
        </div>

        <div class="about-meta">
          <div class="meta-row">
            <span class="meta-label">当前版本</span>
            <span class="meta-value">{{ version ? `v${version}` : '未知版本' }}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">能力范围</span>
            <span class="meta-value">终端连接、对话协助、智能代理、结论导出</span>
          </div>
        </div>

        <AppUpdatePanel title="手动更新" />
      </div>

      <div class="dialog-footer">
        <button class="btn btn-secondary" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppUpdatePanel from './AppUpdatePanel.vue'

defineProps<{
  version: string
}>()

defineEmits<{
  close: []
}>()
</script>

<style scoped>
.about-dialog {
  width: 480px;
  max-width: calc(100vw - 40px);
}

.about-hero {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 4px 0 10px;
}

.about-mark {
  width: 42px;
  height: 42px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-soft) 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.4px;
  box-shadow: var(--shadow-card);
}

.about-copy {
  min-width: 0;
}

.about-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.about-subtitle {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.about-meta {
  margin-top: 6px;
  padding: 12px 14px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-card);
  background: var(--surface-muted);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}

.meta-label {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.meta-value {
  color: var(--text-primary);
  text-align: right;
  line-height: 1.6;
}

.dialog-footer {
  justify-content: flex-end;
}
</style>
