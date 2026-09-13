<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="dialog dialog-wide">
      <div class="dialog-header">
        <span>SSH 秘钥管理</span>
        <button class="btn-icon" @click="$emit('close')">✕</button>
      </div>
      <div class="dialog-body">
        <div class="key-list">
          <div v-if="!keysStore.keys.length" class="empty">暂无 SSH 秘钥</div>
          <div v-for="key in keysStore.keys" :key="key.id" class="key-item">
            <div class="key-info">
              <div class="key-name">{{ key.name }}</div>
              <div class="key-meta">添加于 {{ formatDate(key.createdAt) }}</div>
            </div>
            <div class="key-actions">
              <button class="btn-icon tiny" @click="onEdit(key)">✎</button>
              <button class="btn-icon tiny btn-danger" @click="onDelete(key)">✕</button>
            </div>
          </div>
        </div>

        <div class="key-form" :class="{ editing: isEditing }">
          <div class="form-title">{{ isEditing ? '编辑秘钥' : '添加秘钥' }}</div>
          <label>秘钥名称</label>
          <input v-model="form.name" placeholder="我的秘钥" />
          <label>私钥内容</label>
          <textarea
            v-model="form.privateKey"
            placeholder="请粘贴私钥内容（如 -----BEGIN OPENSSH PRIVATE KEY-----）"
            rows="6"
          ></textarea>
          <label>密钥密码（可选）</label>
          <div class="password-field">
            <input v-model="form.passphrase" :type="showPassphrase ? 'text' : 'password'" placeholder="密钥密码" />
            <button type="button" class="btn-toggle-secret" :title="showPassphrase ? '隐藏' : '显示'" @click="togglePassphraseVisibility">
              <svg v-if="showPassphrase" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <div class="form-actions">
            <button v-if="isEditing" class="btn btn-cancel" @click="resetForm">取消</button>
            <button class="btn btn-save" :disabled="!formValid" @click="onSave">
              {{ isEditing ? '更新' : '添加秘钥' }}
            </button>
          </div>
          <div v-if="formError" class="form-error">{{ formError }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useKeysStore } from '@/stores/keys'
import { useConfirm } from '@/composables/useConfirm'
import type { KeyRecord } from '@/types/key'

defineEmits<{ close: [] }>()

const keysStore = useKeysStore()
const { confirm } = useConfirm()
const isEditing = ref(false)
const editingId = ref<string | null>(null)
const showPassphrase = ref(false)
const formError = ref('')

/**
 * 切换密钥密码显示/隐藏
 */
async function togglePassphraseVisibility(): Promise<void> {
  if (showPassphrase.value) {
    // 当前是显示状态，点击后隐藏 → 只改变类型，不清空值
    showPassphrase.value = false
  } else {
    // 当前是隐藏状态，点击后显示
    // 如果用户已经输入了新值，直接显示
    if (form.passphrase) {
      showPassphrase.value = true
    }
    // 如果是编辑模式且有已有口令，需要从后端获取
    else if (isEditing.value && editingId.value) {
      try {
        const key = await window.electronAPI.keys.get(editingId.value)
        if (key?.passphrase) {
          form.passphrase = key.passphrase
          showPassphrase.value = true
        }
      } catch (err) {
        formError.value = err instanceof Error ? err.message : '读取秘钥密码失败'
      }
    }
  }
}

const form = reactive({
  name: '',
  privateKey: '',
  passphrase: ''
})

const formValid = computed(() => form.name.trim() && form.privateKey.trim())

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN')
}

function resetForm(): void {
  form.name = ''
  form.privateKey = ''
  form.passphrase = ''
  isEditing.value = false
  editingId.value = null
  formError.value = ''
}

async function onEdit(key: KeyRecord): Promise<void> {
  formError.value = ''
  isEditing.value = true
  editingId.value = key.id
  form.name = key.name
  try {
    const realKey = await window.electronAPI.keys.get(key.id)
    form.privateKey = realKey?.privateKey || ''
    form.passphrase = realKey?.passphrase || ''
  } catch (err) {
    formError.value = err instanceof Error ? err.message : '读取秘钥失败'
  }
}

async function onDelete(key: KeyRecord): Promise<void> {
  const ok = await confirm('删除秘钥', `确定要删除秘钥「${key.name}」吗？删除后使用该秘钥的主机将无法连接。`)
  if (ok) {
    await keysStore.deleteKey(key.id)
    if (editingId.value === key.id) {
      resetForm()
    }
  }
}

async function onSave(): Promise<void> {
  if (!formValid.value) return
  formError.value = ''

  try {
    if (isEditing.value && editingId.value) {
      await keysStore.updateKey(editingId.value, {
        name: form.name.trim(),
        privateKey: form.privateKey.trim(),
        passphrase: form.passphrase || undefined
      })
    } else {
      await keysStore.createKey({
        name: form.name.trim(),
        privateKey: form.privateKey.trim(),
        passphrase: form.passphrase || undefined
      })
    }
    resetForm()
  } catch (err) {
    formError.value = err instanceof Error ? err.message : '秘钥保存失败'
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
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-dialog);
  max-height: 85vh;
}

.dialog-wide {
  width: 540px;
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
  flex: 1;
}

.empty {
  text-align: center;
  color: var(--text-tertiary);
  padding: 20px;
  font-size: 13px;
}

.key-list {
  margin-bottom: 18px;
  max-height: 200px;
  overflow-y: auto;
}

.key-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  margin-bottom: 6px;
  transition: background var(--transition-fast);
}

.key-item:hover {
  background: var(--surface-alt);
}

.key-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.key-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 3px;
}

.key-actions {
  display: flex;
  gap: 4px;
}

.key-form {
  border-top: 1px solid var(--divider);
  padding-top: 14px;
}

.key-form:not(.editing) .form-title {
  color: var(--accent);
}

.form-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
  color: var(--text-primary);
}

.key-form label {
  font-size: 12px;
  color: var(--text-secondary);
  display: block;
  margin-top: 10px;
  margin-bottom: 4px;
}

.key-form input,
.key-form textarea {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  color: var(--text-primary);
  padding: 8px 12px;
  font-size: 12px;
  font-family: var(--font-mono);
  outline: none;
  resize: vertical;
  transition: border-color var(--transition-fast);
}

.key-form input:focus,
.key-form textarea:focus {
  border-color: var(--accent);
}

.key-form input::placeholder,
.key-form textarea::placeholder {
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

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  margin-top: 14px;
}

.form-error {
  margin-top: 10px;
  font-size: 12px;
  color: var(--danger);
  line-height: 1.5;
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
</style>
