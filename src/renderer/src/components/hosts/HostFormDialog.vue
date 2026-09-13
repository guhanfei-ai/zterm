<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <span>{{ isEdit ? '编辑主机' : '添加主机' }}</span>
        <button class="btn-icon" @click="$emit('close')">✕</button>
      </div>
      <div class="dialog-body">
        <label>名称</label>
        <input v-model="form.name" placeholder="我的服务器" />

        <label>地址 / IP</label>
        <input v-model="form.host" placeholder="192.168.1.1" />

        <label>端口</label>
        <input v-model.number="form.port" type="number" placeholder="22" />

        <label>用户名</label>
        <input v-model="form.username" placeholder="root" />

        <label>认证方式</label>
        <div ref="authTypeDropdownRef" class="custom-select">
          <button
            type="button"
            class="custom-select-trigger"
            :class="{ open: isAuthTypeMenuOpen }"
            @click="toggleAuthTypeMenu"
          >
            <span>{{ currentAuthTypeLabel }}</span>
            <span class="custom-select-arrow" :class="{ open: isAuthTypeMenuOpen }"></span>
          </button>
          <div v-if="isAuthTypeMenuOpen" class="custom-select-menu">
            <button
              v-for="option in authTypeOptions"
              :key="option.value"
              type="button"
              class="custom-select-option"
              :class="{ active: form.authType === option.value }"
              @click="selectAuthType(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <template v-if="form.authType === 'password'">
          <label>密码</label>
          <div class="password-field">
            <input v-model="form.password" :type="showPassword ? 'text' : 'password'" :placeholder="isEdit && originalAuthType === 'password' ? '留空则保留原密码' : '输入密码'" />
            <button type="button" class="btn-toggle-secret" :title="showPassword ? '隐藏' : '显示'" @click="togglePasswordVisibility">
              <svg v-if="showPassword" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </template>

        <template v-else-if="form.authType === 'key'">
          <label>SSH秘钥</label>
          <select v-model="form.keyId">
            <option value="">-- 请选择秘钥 --</option>
            <option v-for="k in keysStore.keys" :key="k.id" :value="k.id">
              {{ k.name }}
            </option>
          </select>
          <div v-if="!showKeyForm" class="inline-action">
            <button type="button" class="link-btn" @click="showKeyForm = true">+ 创建新秘钥</button>
          </div>
          <div v-else class="inline-key-form">
            <div class="inline-form-title">新建秘钥</div>
            <input v-model="keyForm.name" placeholder="秘钥名称" />
            <textarea
              v-model="keyForm.privateKey"
              placeholder="请粘贴私钥内容（如 -----BEGIN OPENSSH PRIVATE KEY-----）"
              rows="4"
            ></textarea>
            <div class="password-field">
              <input v-model="keyForm.passphrase" :type="showKeyPassphrase ? 'text' : 'password'" placeholder="秘钥密码（可选）" />
              <button type="button" class="btn-toggle-secret" :title="showKeyPassphrase ? '隐藏' : '显示'" @click="toggleKeyPassphraseVisibility">
                <svg v-if="showKeyPassphrase" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
            <div class="inline-form-actions">
              <button type="button" class="btn btn-cancel" @click="cancelKeyForm">取消</button>
              <button type="button" class="btn btn-save" :disabled="!keyFormValid" @click="createKeyInline">添加</button>
            </div>
            <span v-if="keyFormError" class="error-msg">{{ keyFormError }}</span>
          </div>
        </template>

        <template v-else>
          <label>私钥文件</label>
          <div class="file-picker-row">
            <input
              v-model="form.privateKeyFilePath"
              readonly
              placeholder="请选择本地 SSH 私钥文件"
              :title="form.privateKeyFilePath || '请选择本地 SSH 私钥文件'"
            />
            <button type="button" class="btn btn-cancel file-picker-btn" @click="pickPrivateKeyFile">
              选择文件
            </button>
          </div>
          <div v-if="form.privateKeyFilePath" class="helper-text">
            已选择：{{ form.privateKeyFileName || form.privateKeyFilePath }}
          </div>

          <label>私钥文件口令（可选）</label>
          <div class="password-field">
            <input
              v-model="form.privateKeyFilePassphrase"
              :type="showPrivateKeyPassphrase ? 'text' : 'password'"
              :placeholder="isEdit && originalAuthType === 'privateKeyFile' ? '留空则保留原口令' : '输入私钥文件口令（可选）'"
            />
            <button type="button" class="btn-toggle-secret" :title="showPrivateKeyPassphrase ? '隐藏' : '显示'" @click="togglePrivateKeyPassphraseVisibility">
              <svg v-if="showPrivateKeyPassphrase" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </template>

        <label>备注（可选）</label>
        <input v-model="form.description" placeholder="可选备注" />
      </div>
      <div class="dialog-footer">
        <span v-if="saveError" class="error-msg">{{ saveError }}</span>
        <button class="btn btn-cancel" @click="$emit('close')">取消</button>
        <button class="btn btn-save" :disabled="!valid" @click="onSave">
          {{ isEdit ? '更新' : '创建' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useHostsStore } from '@/stores/hosts'
import { useKeysStore } from '@/stores/keys'
import type { HostRecord } from '@/types/host'

const props = defineProps<{
  host?: HostRecord | null
}>()

const emit = defineEmits<{
  close: []
}>()

const hostsStore = useHostsStore()
const keysStore = useKeysStore()

const isEdit = computed(() => !!props.host?.id)
const originalAuthType = props.host?.authType as HostRecord['authType'] | undefined
const saveError = ref('')
const showPassword = ref(false)
const showKeyPassphrase = ref(false)
const showPrivateKeyPassphrase = ref(false)
const isAuthTypeMenuOpen = ref(false)
const authTypeDropdownRef = ref<HTMLElement | null>(null)
const authTypeOptions: Array<{ value: HostRecord['authType']; label: string }> = [
  { value: 'password', label: '密码' },
  { value: 'key', label: 'SSH秘钥' },
  { value: 'privateKeyFile', label: 'SSH私钥文件' }
]

/**
 * 切换密码显示/隐藏 - 密码认证
 */
async function togglePasswordVisibility(): Promise<void> {
  if (showPassword.value) {
    // 当前是显示状态，点击后隐藏 → 只改变类型，不清空值
    showPassword.value = false
  } else {
    // 当前是隐藏状态，点击后显示
    // 如果用户已经输入了新值，直接显示
    if (form.password) {
      showPassword.value = true
    }
    // 如果是编辑模式且有已有密码，需要从后端获取
    else if (isEdit.value && originalAuthType === 'password' && props.host?.id) {
      try {
        const host = await window.electronAPI.hosts.get(props.host.id)
        if (host?.password) {
          form.password = host.password
          showPassword.value = true
        }
      } catch (err) {
        console.error('Failed to load password:', err)
      }
    }
  }
}

/**
 * 切换密钥密码显示/隐藏 - SSH秘钥
 */
async function toggleKeyPassphraseVisibility(): Promise<void> {
  if (showKeyPassphrase.value) {
    // 当前是显示状态，点击后隐藏 → 只改变类型，不清空值
    showKeyPassphrase.value = false
  } else {
    // 当前是隐藏状态，点击后显示
    // 如果用户已经输入了新值，直接显示
    if (keyForm.passphrase) {
      showKeyPassphrase.value = true
    }
  }
}

/**
 * 切换私钥文件口令显示/隐藏
 */
async function togglePrivateKeyPassphraseVisibility(): Promise<void> {
  if (showPrivateKeyPassphrase.value) {
    // 当前是显示状态，点击后隐藏 → 只改变类型，不清空值
    showPrivateKeyPassphrase.value = false
  } else {
    // 当前是隐藏状态，点击后显示
    // 如果用户已经输入了新值，直接显示
    if (form.privateKeyFilePassphrase) {
      showPrivateKeyPassphrase.value = true
    }
    // 如果是编辑模式且有已有口令，需要从后端获取
    else if (isEdit.value && originalAuthType === 'privateKeyFile' && props.host?.id) {
      try {
        const host = await window.electronAPI.hosts.get(props.host.id)
        if (host?.privateKeyFilePassphrase) {
          form.privateKeyFilePassphrase = host.privateKeyFilePassphrase
          showPrivateKeyPassphrase.value = true
        }
      } catch (err) {
        console.error('Failed to load passphrase:', err)
      }
    }
  }
}

const form = reactive({
  name: props.host?.name || '',
  host: props.host?.host || '',
  port: props.host?.port || 22,
  username: props.host?.username || 'root',
  authType: (props.host?.authType as HostRecord['authType']) || 'password',
  password: '',
  keyId: props.host?.keyId || '',
  privateKeyFilePath: props.host?.privateKeyFilePath || '',
  privateKeyFileName: props.host?.privateKeyFileName || '',
  privateKeyFilePassphrase: '',
  description: props.host?.description || ''
})

const showKeyForm = ref(false)
const keyFormError = ref('')
const keyForm = reactive({
  name: '',
  privateKey: '',
  passphrase: ''
})

const keyFormValid = computed(() => keyForm.name.trim() && keyForm.privateKey.trim())
const currentAuthTypeLabel = computed(
  () => authTypeOptions.find((option) => option.value === form.authType)?.label || '密码'
)

watch(
  () => form.authType,
  (authType) => {
    saveError.value = ''
    isAuthTypeMenuOpen.value = false
    if (authType !== 'key') {
      cancelKeyForm()
    }
  }
)

function toggleAuthTypeMenu(): void {
  isAuthTypeMenuOpen.value = !isAuthTypeMenuOpen.value
}

function selectAuthType(value: HostRecord['authType']): void {
  form.authType = value
  isAuthTypeMenuOpen.value = false
}

function handlePointerDown(event: MouseEvent): void {
  if (!authTypeDropdownRef.value) return
  const target = event.target
  if (target instanceof Node && !authTypeDropdownRef.value.contains(target)) {
    isAuthTypeMenuOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handlePointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handlePointerDown)
})

function cancelKeyForm(): void {
  showKeyForm.value = false
  keyForm.name = ''
  keyForm.privateKey = ''
  keyForm.passphrase = ''
  keyFormError.value = ''
}

async function createKeyInline(): Promise<void> {
  if (!keyFormValid.value) return
  keyFormError.value = ''
  try {
    const newKey = await keysStore.createKey({
      name: keyForm.name.trim(),
      privateKey: keyForm.privateKey.trim(),
      passphrase: keyForm.passphrase || undefined
    })
    form.keyId = newKey.id
    cancelKeyForm()
  } catch (err) {
    keyFormError.value = err instanceof Error ? err.message : '创建秘钥失败'
  }
}

async function pickPrivateKeyFile(): Promise<void> {
  const result = await window.electronAPI.hosts.pickPrivateKeyFile()
  if (result.error) {
    saveError.value = result.error
    return
  }
  if (result.canceled || !result.filePath) {
    return
  }

  form.privateKeyFilePath = result.filePath
  form.privateKeyFileName = result.fileName || ''
  saveError.value = ''
}

const validationError = computed(() => {
  if (!form.name.trim()) return '请输入名称'
  if (!form.host.trim()) return '请输入地址/IP'
  if (!form.username.trim()) return '请输入用户名'
  if (!form.port || form.port <= 0) return '端口必须大于 0'
  if (form.authType === 'password') {
    if (!isEdit.value && !form.password) {
      return '密码认证必须填写密码'
    }
    if (isEdit.value && originalAuthType !== 'password' && !form.password) {
      return '从其他认证方式切换到密码认证时必须填写密码'
    }
  }
  if (form.authType === 'key' && !form.keyId) {
    return 'SSH秘钥认证必须选择 SSH秘钥'
  }
  if (form.authType === 'privateKeyFile' && !form.privateKeyFilePath.trim()) {
    return 'SSH私钥文件认证必须选择私钥文件'
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

  const data: {
    name: string
    host: string
    port: number
    username: string
    authType: HostRecord['authType']
    password?: string
    keyId?: string
    privateKeyFilePath?: string
    privateKeyFilePassphrase?: string
    description?: string
  } = {
    name: form.name.trim(),
    host: form.host.trim(),
    port: form.port,
    username: form.username.trim(),
    authType: form.authType,
    description: form.description.trim() || undefined
  }

  if (form.authType === 'password') {
    if (form.password) {
      data.password = form.password
    }
  } else if (form.authType === 'key') {
    data.keyId = form.keyId || undefined
  } else {
    data.privateKeyFilePath = form.privateKeyFilePath.trim()
    if (form.privateKeyFilePassphrase) {
      data.privateKeyFilePassphrase = form.privateKeyFilePassphrase
    }
  }

  try {
    if (isEdit.value && props.host?.id) {
      await hostsStore.updateHost(props.host.id, data)
    } else {
      await hostsStore.createHost(data)
    }
    emit('close')
  } catch (err: unknown) {
    saveError.value = err instanceof Error ? err.message : '保存失败'
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
.dialog-body select {
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

.dialog-body select {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 34px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238b93a7' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 12px;
}

.custom-select {
  position: relative;
}

.custom-select-trigger {
  width: 100%;
  min-height: 35px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--bg);
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  color: var(--text-primary);
  padding: 8px 12px;
  font-size: 13px;
  font-family: var(--font-family);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}

.custom-select-trigger:hover,
.custom-select-trigger.open {
  border-color: var(--accent);
}

.custom-select-arrow {
  width: 8px;
  height: 8px;
  border-right: 1.5px solid var(--text-tertiary);
  border-bottom: 1.5px solid var(--text-tertiary);
  transform: rotate(45deg) translateY(-1px);
  transition: transform var(--transition-fast), border-color var(--transition-fast);
  flex-shrink: 0;
}

.custom-select-arrow.open {
  transform: rotate(-135deg) translateY(-1px);
  border-color: var(--text-secondary);
}

.custom-select-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 20;
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  box-shadow: var(--shadow-dialog);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.custom-select-option {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.custom-select-option:hover {
  background: var(--hover-overlay);
}

.custom-select-option.active {
  background: var(--accent);
  color: var(--accent-contrast, #fff);
}

.file-picker-row {
  display: flex;
  gap: 8px;
}

.file-picker-row input {
  flex: 1;
  font-family: var(--font-mono);
}

.file-picker-btn {
  flex-shrink: 0;
  align-self: stretch;
  min-width: 84px;
  padding: 0 12px;
  white-space: nowrap;
}

.helper-text {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.5;
  word-break: break-all;
  margin-top: -2px;
}

.dialog-body input:focus,
.dialog-body select:focus {
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

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md) 18px;
  border-top: 1px solid var(--divider);
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
  color: var(--accent-contrast, #fff);
}

.btn-save:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.inline-action {
  margin-top: 6px;
}

.link-btn {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.link-btn:hover {
  text-decoration: underline;
}

.inline-key-form {
  margin-top: 8px;
  padding: 12px;
  background: var(--surface-alt);
  border-radius: var(--radius-control);
  border: 1px solid var(--divider);
}

.inline-form-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.inline-key-form input,
.inline-key-form textarea {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  color: var(--text-primary);
  padding: 6px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  outline: none;
  resize: vertical;
  transition: border-color var(--transition-fast);
  margin-bottom: 6px;
}

.inline-key-form input:focus,
.inline-key-form textarea:focus {
  border-color: var(--accent);
}

.inline-key-form input::placeholder,
.inline-key-form textarea::placeholder {
  color: var(--text-tertiary);
}

.inline-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}

.inline-key-form .error-msg {
  display: block;
  margin-top: 6px;
}

.inline-key-form .password-field {
  margin-bottom: 6px;
}

.inline-key-form .password-field input {
  margin-bottom: 0;
  width: 100%;
}
</style>
