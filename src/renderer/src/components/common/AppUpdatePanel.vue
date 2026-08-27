<template>
  <div class="update-section">
    <div class="update-header">{{ title }}</div>
    <div class="update-current">当前版本：{{ updateStore.currentVersion ? `v${updateStore.currentVersion}` : '未知版本' }}</div>

    <div v-if="updateStore.state === 'idle'" class="update-row">
      <button class="btn btn-update-check" @click="onCheckUpdate">检查更新</button>
    </div>

    <div v-else-if="updateStore.state === 'checking'" class="update-row">
      <span class="update-status">正在检查...</span>
    </div>

    <div v-else-if="updateStore.state === 'no-update'" class="update-row">
      <span class="update-status success">已是最新版本</span>
      <button class="btn btn-update-check ghost" @click="onCheckUpdate">重新检查</button>
    </div>

    <div v-else-if="updateStore.state === 'available'" class="update-info">
      <div class="update-available">发现新版本：v{{ updateStore.latestVersion }}</div>
      <div v-if="updateStore.notes" class="update-notes">{{ updateStore.notes }}</div>
      <button class="btn btn-update-download" @click="onDownloadUpdate">下载更新</button>
    </div>

    <div v-else-if="updateStore.state === 'downloading'" class="update-info">
      <div class="update-progress-label">下载中...</div>
      <div class="update-progress-bar">
        <div class="update-progress-fill" :style="{ width: updateStore.downloadPercent + '%' }"></div>
      </div>
      <div class="update-progress-text">{{ updateStore.downloadPercent }}%</div>
    </div>

    <div v-else-if="updateStore.state === 'downloaded'" class="update-info">
      <span class="update-status success">下载完成，校验通过</span>
      <button class="btn btn-update-install" @click="onInstallUpdate">安装并重启</button>
    </div>

    <div v-else-if="updateStore.state === 'installing'" class="update-info">
      <span class="update-status">应用即将重启...</span>
    </div>

    <div v-if="updateStore.error" class="update-error">{{ updateStore.error }}</div>
  </div>
</template>

<script setup lang="ts">
import { useUpdateStore } from '@/stores/update'
import { useConfirm } from '@/composables/useConfirm'

withDefaults(defineProps<{
  title?: string
}>(), {
  title: '软件更新'
})

const updateStore = useUpdateStore()
const { confirm } = useConfirm()

async function onCheckUpdate(): Promise<void> {
  await updateStore.manualCheck()
}

async function onDownloadUpdate(): Promise<void> {
  await updateStore.startDownload()
}

async function onInstallUpdate(): Promise<void> {
  const confirmed = await confirm(
    '安装更新',
    '安装完成后当前窗口会关闭并拉起新版本，未保存内容会丢失。确认现在安装并重启吗？'
  )
  if (!confirmed) return
  await updateStore.startInstall()
}
</script>

<style scoped>
.update-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--divider);
}

.update-header {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.update-current {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.update-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.update-status {
  font-size: 12px;
  color: var(--text-secondary);
}

.update-status.success {
  color: var(--success);
}

.update-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.update-available {
  font-size: 13px;
  font-weight: 500;
  color: var(--accent);
}

.update-notes {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 6px 10px;
  background: var(--bg);
  border-radius: var(--radius-control);
  border: 1px solid var(--divider);
  white-space: pre-wrap;
  max-height: 80px;
  overflow-y: auto;
}

.update-progress-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.update-progress-bar {
  height: 6px;
  background: var(--divider);
  border-radius: 3px;
  overflow: hidden;
}

.update-progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.2s ease;
}

.update-progress-text {
  font-size: 11px;
  color: var(--text-tertiary);
}

.update-error {
  font-size: 12px;
  color: var(--danger);
  margin-top: 4px;
}

.btn {
  padding: 7px 18px;
  border-radius: var(--radius-control);
  border: none;
  cursor: pointer;
  font-size: 13px;
  transition: all var(--transition-fast);
}

.btn-update-check,
.btn-update-download,
.btn-update-install {
  background: var(--accent);
  color: #fff;
}

.btn-update-check:hover,
.btn-update-download:hover,
.btn-update-install:hover {
  background: var(--accent-hover);
}

.btn-update-check.ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--divider);
}

.btn-update-check.ghost:hover {
  background: var(--surface-alt);
  color: var(--text-primary);
}
</style>
