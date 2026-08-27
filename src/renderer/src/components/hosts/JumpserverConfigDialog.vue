<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <span>{{ isEdit ? '编辑 Jumpserver 配置' : '添加 Jumpserver 配置' }}</span>
        <button class="btn-icon" @click="$emit('close')">✕</button>
      </div>
      <div class="dialog-body">
        <label>名称</label>
        <input v-model="form.name" placeholder="我的 Jumpserver" />

        <label>Base URL</label>
        <input v-model="form.baseUrl" placeholder="http://jumpserver.example.com" />
        <span class="field-hint">填写站点根地址即可，程序会自动拼接 `/api/v1/...`，误填末尾 `/api` 也会自动纠正。</span>

        <label>认证方式</label>
        <div class="readonly-field">API Key / Access Key</div>

        <label>Access Key ID</label>
        <input
          v-model="form.accessKeyId"
          :placeholder="accessKeyIdPlaceholder"
        />
        <label>Access Key Secret</label>
        <div class="password-field">
          <input
            v-model="form.accessKeySecret"
            :type="showSecret ? 'text' : 'password'"
            :placeholder="accessKeySecretPlaceholder"
          />
          <button
            v-if="hasExistingSecret || form.accessKeySecret"
            type="button"
            class="btn-toggle-secret"
            :title="showSecret ? '隐藏' : '显示'"
            @click="toggleSecretVisibility"
          >
            <svg
              v-if="showSecret"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
            <svg
              v-else
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>

        <label class="checkbox-label">
          <input v-model="form.verifyTls" type="checkbox" />
          <span>验证 TLS 证书</span>
        </label>
      </div>
      <div class="dialog-footer">
        <span v-if="saveError || testResult" class="error-msg" :class="{ 'success-msg': testResult?.success }">{{ saveError || testResultText }}</span>
        <button
          v-if="isEdit"
          class="btn btn-danger-outline"
          @click="onDelete"
        >
          删除配置
        </button>
        <div class="dialog-footer-right">
          <button class="btn btn-cancel" @click="$emit('close')">取消</button>
          <button
            v-if="isEdit"
            class="btn btn-test"
            :disabled="testing || !valid"
            @click="onTest"
          >
            {{ testing ? '测试中...' : '测试连接' }}
          </button>
          <button class="btn btn-save" :disabled="!valid" @click="onSave">
            {{ isEdit ? '更新' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useJumpserverStore } from '@/stores/jumpserver'
import type { JumpserverConfig } from '@/types/jumpserver'

const props = defineProps<{
  config?: (JumpserverConfig & { hasCredential: boolean }) | null
}>()

const emit = defineEmits<{
  close: []
}>()

const jumpserverStore = useJumpserverStore()

type AuthMode = 'access_key'

const isEdit = computed(() => !!props.config?.id)
const configHasCredential = computed(() => props.config?.hasCredential ?? false)
const hasExistingSecret = computed(() => {
  // 编辑模式下，如果配置有凭据且用户没有输入新值，则显示已有 Secret
  return isEdit.value && configHasCredential.value && !form.accessKeySecret
})
const originalAuthMode = computed(() => props.config?.authMode)
const authModeChanged = computed(() => isEdit.value && originalAuthMode.value !== 'access_key')
const accessKeyIdChanged = computed(() => (
  isEdit.value &&
  originalAuthMode.value === 'access_key' &&
  form.accessKeyId.trim() !== (props.config?.accessKeyId || '')
))

const accessKeyIdPlaceholder = computed(() => {
  return '输入 Access Key ID'
})

const accessKeySecretPlaceholder = computed(() => {
  if (!isEdit.value) return '输入 Access Key Secret'
  if (authModeChanged.value) return '切换认证方式后必须填写新的 Secret'
  if (accessKeyIdChanged.value) return '修改 Access Key ID 时必须同步填写新的 Secret'
  return '输入 Access Key Secret'
})

const showSecret = ref(false)
const saveError = ref('')
const testing = ref(false)
const testResult = ref<{ success: boolean; user?: { id: string; username: string; name: string }; error?: string } | null>(null)

/**
 * 切换 Secret 显示/隐藏
 * - 点击显示：如果有已有 Secret，从后端加载并填充到输入框
 * - 再次点击：隐藏（保留值，浏览器自动显示星点）
 */
async function toggleSecretVisibility(): Promise<void> {
  if (showSecret.value) {
    // 当前是显示状态，点击后隐藏 → 只改变类型，不清空值
    showSecret.value = false
  } else {
    // 当前是隐藏状态，点击后显示
    // 如果用户已经输入了新值，直接显示
    if (form.accessKeySecret) {
      showSecret.value = true
    }
    // 如果是编辑模式且有已有 Secret，需要从后端获取
    else if (isEdit.value && configHasCredential.value && props.config?.id) {
      try {
        const secret = await jumpserverStore.getJumpserverSecret(props.config.id)
        if (secret) {
          form.accessKeySecret = secret
          showSecret.value = true
        }
      } catch (err) {
        console.error('Failed to load secret:', err)
      }
    }
  }
}

const testResultText = computed(() => {
  if (!testResult.value) return ''
  if (testResult.value.success && testResult.value.user) {
    return `✓ 连接成功 — ${testResult.value.user.name} (@${testResult.value.user.username})`
  }
  return `✗ ${testResult.value.error || '测试失败'}`
})

const form = reactive({
  name: props.config?.name || '',
  baseUrl: props.config?.baseUrl || '',
  authMode: 'access_key' as AuthMode,
  accessKeyId: props.config?.accessKeyId || '',
  accessKeySecret: '',
  verifyTls: props.config?.verifyTls ?? true
})

const validationError = computed(() => {
  if (!form.name.trim()) return '请输入名称'
  if (!form.baseUrl.trim()) return '请输入 Base URL'
  if (!form.accessKeyId.trim()) return '请输入 Access Key ID'

  if (!isEdit.value) {
    if (!form.accessKeySecret) return '首次创建必须填写 Access Key Secret'
  }
  if (authModeChanged.value && !form.accessKeySecret) {
    return '切换为 API Key 时必须填写 Access Key Secret'
  }
  if (accessKeyIdChanged.value && !form.accessKeySecret) {
    return '修改 Access Key ID 时必须同步填写新的 Secret'
  }
  if (isEdit.value && !configHasCredential.value && !form.accessKeySecret) {
    return '当前配置缺少 Secret，请补全后再保存'
  }
  return null
})

const valid = computed(() => validationError.value === null)

async function onSave(): Promise<void> {
  if (!valid.value) {
    saveError.value = validationError.value || '请填写所有必填项'
    return
  }
  saveError.value = ''
  testResult.value = null

  try {
    await jumpserverStore.saveJumpserverConfig({
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      authMode: 'access_key',
      accessKeyId: form.accessKeyId.trim() || undefined,
      accessKeySecret: form.accessKeySecret || undefined,
      verifyTls: form.verifyTls
    }, props.config?.id ?? null)
    emit('close')
  } catch (err: unknown) {
    saveError.value = err instanceof Error ? err.message : '保存失败'
  }
}

async function onTest(): Promise<void> {
  saveError.value = ''
  testResult.value = null

  // 必须先通过同一套表单校验，否则不能继续
  if (!valid.value) {
    saveError.value = validationError.value || '请填写所有必填项'
    return
  }

  testing.value = true

  try {
    // 如果表单有修改但未保存，先保存再测试
    const configChanged =
      form.name.trim() !== (props.config?.name || '') ||
      form.baseUrl.trim() !== (props.config?.baseUrl || '') ||
      form.authMode !== 'access_key' ||
      props.config?.authMode !== 'access_key' ||
      form.accessKeyId.trim() !== (props.config?.accessKeyId || '') ||
      form.verifyTls !== (props.config?.verifyTls ?? true) ||
      !!form.accessKeySecret

    if (configChanged) {
      await jumpserverStore.saveJumpserverConfig({
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        authMode: 'access_key',
        accessKeyId: form.accessKeyId.trim() || undefined,
        accessKeySecret: form.accessKeySecret || undefined,
        verifyTls: form.verifyTls
      }, props.config?.id ?? null)
    }

    testResult.value = await jumpserverStore.testJumpserverConfig(props.config?.id ?? undefined)
  } catch (err: unknown) {
    testResult.value = { success: false, error: err instanceof Error ? err.message : '测试失败' }
  } finally {
    testing.value = false
  }
}

async function onDelete(): Promise<void> {
  saveError.value = ''
  testResult.value = null
  try {
    await jumpserverStore.deleteJumpserverConfig(props.config?.id ?? null)
    emit('close')
  } catch (err: unknown) {
    saveError.value = err instanceof Error ? err.message : '删除失败'
  }
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.dialog {
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-container);
  width: 440px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-dialog);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--divider);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.dialog-body {
  padding: 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dialog-body label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  font-weight: 500;
}

.dialog-body input,
.readonly-field {
  background: var(--bg);
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  color: var(--text-primary);
  padding: 8px 12px;
  font-size: 13px;
  font-family: var(--font-family);
  outline: none;
  transition: border-color var(--transition-fast);
  width: 100%;
}

.dialog-body input:focus {
  border-color: var(--accent);
}

.dialog-body input::placeholder {
  color: var(--text-tertiary);
}

.password-field {
  position: relative;
  display: flex;
  align-items: center;
}

.password-field input {
  padding-right: 38px;
}

.btn-toggle-secret {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-control);
  transition: color var(--transition-fast), background var(--transition-fast);
}

.btn-toggle-secret:hover {
  color: var(--text-secondary);
  background: var(--surface-alt);
}

.readonly-field {
  display: flex;
  align-items: center;
  min-height: 38px;
}

.field-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.5;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  margin-top: 4px;
}

.checkbox-label input[type="checkbox"] {
  width: auto;
  accent-color: var(--accent);
}

.checkbox-label span {
  font-size: 13px;
  color: var(--text-primary);
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-top: 1px solid var(--divider);
}

.dialog-footer-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.error-msg {
  color: var(--danger);
  font-size: 12px;
  flex: 1;
}

.btn {
  padding: 7px 18px;
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

.btn-save {
  background: var(--accent);
  color: #fff;
}

.btn-save:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-danger-outline {
  background: transparent;
  color: var(--danger);
  border: 1px solid var(--danger-muted);
}

.btn-danger-outline:hover {
  background: var(--danger-muted);
}

.btn-test {
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
}

.btn-test:hover:not(:disabled) {
  background: var(--accent-muted, rgba(64, 150, 255, 0.1));
}

.btn-test:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.success-msg {
  color: var(--success, #4caf50) !important;
}
</style>
