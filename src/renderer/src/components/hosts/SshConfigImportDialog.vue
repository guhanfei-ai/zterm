<template>
  <div class="confirm-overlay" @click.self="$emit('cancel')">
    <div class="import-dialog">
      <div class="import-header">
        <span>导入 OpenSSH 配置</span>
        <span class="import-summary">
          共 {{ hosts.length }} 台主机
          <template v-if="duplicates.some(Boolean)">，{{ duplicates.filter(Boolean).length }} 台已存在</template>
          <template v-if="skippedBlocks > 0">，跳过 {{ skippedBlocks }} 个通配符块</template>
        </span>
      </div>
      <div class="import-body">
        <div class="import-hint">
          勾选要导入的主机。带 IdentityFile 的主机将使用私钥文件认证，其余为密码认证（密码需导入后填写）。
        </div>
        <div class="import-list">
          <label
            v-for="(host, index) in hosts"
            :key="`${host.alias}-${host.host}:${host.port}`"
            class="import-row"
            :class="{ dup: duplicates[index] }"
          >
            <input v-model="selected[index]" type="checkbox" />
            <div class="import-row-main">
              <div class="import-row-name">
                {{ host.alias }}
                <span v-if="duplicates[index]" class="dup-badge">已存在</span>
                <span v-if="host.identityFile" class="key-badge" :title="host.identityFile">密钥文件</span>
                <span v-else class="pwd-badge">密码认证</span>
              </div>
              <div class="import-row-detail">
                {{ host.username || '（未指定用户）' }}@{{ host.host }}:{{ host.port }}
              </div>
              <div v-if="host.ignoredKeywords.length" class="import-row-ignored">
                已忽略字段: {{ host.ignoredKeywords.join(', ') }}
              </div>
            </div>
          </label>
        </div>
        <div v-if="error" class="import-error">{{ error }}</div>
      </div>
      <div class="import-footer">
        <button class="btn btn-cancel" @click="$emit('cancel')">取消</button>
        <button class="btn btn-primary" :disabled="!hasSelection || importing" @click="onConfirm">
          {{ importing ? '导入中...' : `导入 ${selectedCount} 台` }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ParsedSshConfigHost } from '../../../../main/services/sshConfigFile'

const props = defineProps<{
  hosts: ParsedSshConfigHost[]
  duplicates: boolean[]
  skippedBlocks: number
}>()

const emit = defineEmits<{
  confirm: [hosts: ParsedSshConfigHost[]]
  cancel: []
}>()

const selected = ref<boolean[]>(props.hosts.map((_, index) => !props.duplicates[index]))
const importing = ref(false)
const error = ref('')

const selectedCount = computed(() => selected.value.filter(Boolean).length)
const hasSelection = computed(() => selectedCount.value > 0)

async function onConfirm(): Promise<void> {
  importing.value = true
  error.value = ''
  const chosen = props.hosts.filter((_, index) => selected.value[index])
  const result = await window.electronAPI.hosts.confirmImportSshConfig(chosen)
  importing.value = false
  if (result.success) {
    emit('confirm', chosen)
  } else {
    error.value = result.error || '导入失败'
  }
}
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  backdrop-filter: blur(2px);
}

.import-dialog {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-container);
  width: 480px;
  max-height: 70vh;
  box-shadow: var(--shadow-dialog);
}

.import-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 16px 20px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--divider);
}

.import-summary {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}

.import-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 14px 20px;
}

.import-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 10px;
  line-height: 1.5;
}

.import-list {
  flex: 1;
  overflow-y: auto;
  border: 1px solid var(--divider);
  border-radius: var(--radius-control, 6px);
}

.import-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--divider);
}

.import-row:last-child {
  border-bottom: none;
}

.import-row:hover {
  background: var(--surface-alt);
}

.import-row.dup {
  opacity: 0.75;
}

.import-row input[type='checkbox'] {
  margin-top: 3px;
}

.import-row-main {
  flex: 1;
  min-width: 0;
}

.import-row-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.dup-badge,
.key-badge,
.pwd-badge {
  padding: 1px 6px;
  font-size: 11px;
  font-weight: 400;
  border-radius: 3px;
}

.dup-badge {
  color: var(--warning, #e6a700);
  background: rgba(230, 167, 0, 0.12);
}

.key-badge {
  color: var(--accent, #4a9eff);
  background: rgba(74, 158, 255, 0.12);
}

.pwd-badge {
  color: var(--text-secondary);
  background: var(--surface-alt);
}

.import-row-detail {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.import-row-ignored {
  font-size: 11px;
  color: var(--text-disabled, #888);
  margin-top: 2px;
}

.import-error {
  margin-top: 10px;
  font-size: 12px;
  color: var(--danger);
}

.import-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  padding: var(--space-md) 20px;
  border-top: 1px solid var(--divider);
}

.btn {
  padding: 7px 22px;
  border-radius: var(--radius-control);
  border: none;
  cursor: pointer;
  font-size: 13px;
  transition: all var(--transition-fast);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.btn-primary {
  background: var(--accent, #4a9eff);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}
</style>
