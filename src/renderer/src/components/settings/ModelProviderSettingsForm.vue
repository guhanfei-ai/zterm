<template>
  <div class="model-settings-card">
    <div class="card-header">
      <div class="card-header-top">
        <span class="provider-badge">OpenAI 兼容</span>
      </div>
      <h2 class="card-title">模型设置</h2>
      <p class="card-desc">配置 AI 模型提供商连接参数，填写后可点击测试连接验证。</p>
    </div>

    <div class="card-body">
      <!-- 名称 -->
      <div class="field">
        <label class="field-label">名称</label>
        <input
          v-model="form.label"
          class="field-input"
          placeholder="DeepSeek"
        />
        <span class="field-hint">用于标识此配置，可自定义</span>
      </div>

      <!-- 接口地址 -->
      <div class="field">
        <label class="field-label">接口地址</label>
        <input
          v-model="form.baseUrl"
          class="field-input"
          placeholder="https://api.deepseek.com/v1"
        />
      </div>

      <!-- API 密钥 -->
      <div class="field">
        <label class="field-label">API 密钥</label>
        <div class="input-with-suffix">
          <input
            v-model="form.apiKey"
            :type="showKey ? 'text' : 'password'"
            class="field-input"
            :placeholder="hasExistingKey ? '已设置，不修改可留空' : 'sk-...'"
          />
          <button
            class="input-suffix-btn"
            type="button"
            :title="showKey ? '隐藏密钥' : '显示密钥'"
            @click="toggleKeyVisibility"
          >
            <svg v-if="showKey" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <span class="field-hint">{{ hasExistingKey ? '已有密钥，不修改则留空；输入新密钥将覆盖旧值' : '密钥只会存储在本地，不会上传到任何服务器' }}</span>
      </div>

      <!-- 模型名称 -->
      <div class="field">
        <label class="field-label">模型名称</label>
        <input
          v-model="form.model"
          class="field-input"
          placeholder="deepseek-v4-pro"
        />
      </div>

      <!-- 流式响应 -->
      <div class="field field-inline">
        <div class="field-inline-left">
          <label class="field-label">流式响应</label>
          <span class="field-hint-inline">启用后回复将逐字输出</span>
        </div>
        <label class="toggle-switch">
          <input
            type="checkbox"
            v-model="form.enableStreaming"
          />
          <span class="toggle-track">
            <span class="toggle-thumb"></span>
          </span>
        </label>
      </div>
    </div>

    <div class="card-footer">
      <div class="footer-actions">
        <button
          class="btn btn-secondary"
          :disabled="testing"
          @click="onTest"
        >
          <svg v-if="testing" class="btn-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"><animate attributeName="stroke-dashoffset" values="32;0" dur="1s" repeatCount="indefinite"/></circle></svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          {{ testing ? '测试中...' : '测试连接' }}
        </button>
        <button
          class="btn btn-primary"
          :disabled="!valid || saving"
          @click="onSave"
        >
          <svg v-if="saving" class="btn-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"><animate attributeName="stroke-dashoffset" values="32;0" dur="1s" repeatCount="indefinite"/></circle></svg>
          {{ saving ? '保存中...' : '保存配置' }}
        </button>
      </div>
      <div v-if="testResult || saveResult" class="footer-feedback">
        <span v-if="testResult" class="feedback" :class="testResultClass">
          <svg v-if="testResultClass === 'success'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          {{ testResult }}
        </span>
        <span v-if="saveResult" class="feedback" :class="saveResultClass">
          <svg v-if="saveResultClass === 'success'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          {{ saveResult }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'

const showKey = ref(false)
const hasExistingKey = ref(false)
const testing = ref(false)
const testResult = ref('')
const testResultClass = ref('')
const saving = ref(false)
const saveResult = ref('')
const saveResultClass = ref('')

const form = reactive({
  label: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-v4-pro',
  enableStreaming: true
})

const valid = computed(
  () => form.label.trim() && form.baseUrl.trim() && form.model.trim() && (hasExistingKey.value || form.apiKey.trim())
)

onMounted(async () => {
  const config = await window.electronAPI.ai.getProviderConfig()
  if (config) {
    form.label = config.label
    form.baseUrl = config.baseUrl
    form.model = config.model
    form.enableStreaming = config.enableStreaming
    // 已保存密钥默认不回填，避免打开设置页时直接明文暴露。
    if (config.apiKey && config.apiKey.length > 0) {
      hasExistingKey.value = true
    }
  }
})

async function toggleKeyVisibility(): Promise<void> {
  if (showKey.value) {
    showKey.value = false
    return
  }

  if (!form.apiKey && hasExistingKey.value) {
    try {
      const config = await window.electronAPI.ai.getProviderConfig()
      if (config?.apiKey) {
        form.apiKey = config.apiKey
      }
    } catch {
      saveResult.value = '读取已保存密钥失败'
      saveResultClass.value = 'error'
      return
    }
  }

  showKey.value = true
}

async function onTest(): Promise<void> {
  if (!valid.value) return
  testing.value = true
  testResult.value = ''
  testResultClass.value = ''

  try {
    const result = await window.electronAPI.ai.validateProviderConfig({
      providerType: 'openai-compatible',
      label: form.label,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      model: form.model,
      enableStreaming: form.enableStreaming,
      reasoningMode: 'auto'
    })
    if (result.valid) {
      testResult.value = '连接成功'
      testResultClass.value = 'success'
    } else {
      testResult.value = result.error || '连接失败'
      testResultClass.value = 'error'
    }
  } catch {
    testResult.value = '测试失败'
    testResultClass.value = 'error'
  } finally {
    testing.value = false
  }
}

async function onSave(): Promise<void> {
  if (!valid.value) return

  saving.value = true
  saveResult.value = ''
  saveResultClass.value = ''

  try {
    const result = await window.electronAPI.ai.saveProviderConfig({
      label: form.label.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      model: form.model.trim(),
      enableStreaming: form.enableStreaming,
      reasoningMode: 'auto'
    })
    if (result.success) {
      saveResult.value = '配置已保存'
      saveResultClass.value = 'success'
      hasExistingKey.value = true
      form.apiKey = ''
      showKey.value = false
    } else {
      saveResult.value = result.error || '保存失败'
      saveResultClass.value = 'error'
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '保存失败'
    saveResult.value = msg
    saveResultClass.value = 'error'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.model-settings-card {
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-container);
  overflow: hidden;
}

/* ---- Card Header ---- */
.card-header {
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--divider-soft);
}

.card-header-top {
  margin-bottom: 10px;
}

.provider-badge {
  display: inline-block;
  background: var(--accent-muted);
  color: var(--accent);
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 20px;
  font-weight: 500;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.card-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0;
  line-height: 1.5;
}

/* ---- Card Body ---- */
.card-body {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ---- Field ---- */
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.field-input {
  background: var(--bg);
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  color: var(--text-primary);
  padding: 9px 12px;
  font-size: 13px;
  font-family: var(--font-family);
  outline: none;
  transition: border-color var(--transition-fast);
  width: 100%;
}

.field-input:focus {
  border-color: var(--accent);
}

.field-input::placeholder {
  color: var(--text-tertiary);
}

.field-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.4;
}

/* ---- Input with suffix button ---- */
.input-with-suffix {
  position: relative;
  display: flex;
}

.input-with-suffix .field-input {
  padding-right: 38px;
}

.input-suffix-btn {
  position: absolute;
  right: 1px;
  top: 1px;
  bottom: 1px;
  width: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-left: 1px solid var(--divider-soft);
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: 0 var(--radius-control) var(--radius-control) 0;
  transition: all var(--transition-fast);
}

.input-suffix-btn:hover {
  background: var(--hover-overlay);
  color: var(--text-primary);
}

/* ---- Inline field (e.g. streaming toggle) ---- */
.field-inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: var(--bg);
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
}

.field-inline-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.field-hint-inline {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* ---- Toggle Switch ---- */
.toggle-switch {
  cursor: pointer;
  flex-shrink: 0;
}

.toggle-switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-track {
  display: block;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: var(--surface-alt);
  border: 1px solid var(--divider);
  position: relative;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text-tertiary);
  transition: transform var(--transition-fast), background var(--transition-fast);
}

.toggle-switch input:checked + .toggle-track {
  background: var(--accent-muted);
  border-color: var(--accent);
}

.toggle-switch input:checked + .toggle-track .toggle-thumb {
  transform: translateX(16px);
  background: var(--accent);
}

.toggle-switch input:focus-visible + .toggle-track {
  box-shadow: 0 0 0 2px var(--accent);
}

/* ---- Card Footer ---- */
.card-footer {
  padding: 14px 24px;
  border-top: 1px solid var(--divider-soft);
  background: var(--surface-muted);
}

.footer-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.footer-feedback {
  margin-top: 10px;
}

.feedback {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  line-height: 1;
}

.feedback.success {
  color: var(--success);
}

.feedback.error {
  color: var(--danger);
}

.btn-spinner {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
