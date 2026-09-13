<template>
  <Transition name="toast">
    <div v-if="visible" class="update-toast">
      <button class="update-toast-close" title="关闭" @click="onDismiss">&times;</button>

      <div class="update-toast-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>发现新版本 v{{ updateStore.latestVersion }}</span>
      </div>

      <div v-if="updateStore.state === 'available'" class="update-toast-body">
        <p>有新版本可用，建议更新以获得更好体验。</p>
        <div class="update-toast-actions">
          <button class="btn btn-primary" @click="onUpdate">立即更新</button>
          <button class="btn btn-ghost" @click="onDismiss">稍后</button>
        </div>
      </div>

      <div v-else-if="updateStore.state === 'downloading'" class="update-toast-body">
        <div class="update-toast-progress">
          <div class="update-toast-progress-bar">
            <div class="update-toast-progress-fill" :style="{ width: updateStore.downloadPercent + '%' }"></div>
          </div>
          <span class="update-toast-progress-text">{{ updateStore.downloadPercent }}%</span>
        </div>
      </div>

      <div v-else-if="updateStore.state === 'downloaded'" class="update-toast-body">
        <p>下载完成，校验通过</p>
        <div class="update-toast-actions">
          <button class="btn btn-primary" @click="onInstall">安装并重启</button>
          <button class="btn btn-ghost" @click="onDismiss">稍后</button>
        </div>
      </div>

      <div v-else-if="updateStore.state === 'installing'" class="update-toast-body">
        <p>应用即将重启以完成更新...</p>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUpdateStore } from '@/stores/update'
import { useConfirm } from '@/composables/useConfirm'

const updateStore = useUpdateStore()
const { confirm } = useConfirm()

const visible = computed(() => {
  const s = updateStore.state
  // 所有状态都检查 toastVisible，实现真正的显示/隐藏控制
  if (s === 'downloading' || s === 'downloaded' || s === 'installing') {
    return updateStore.toastVisible
  }
  // 仅 available 状态受"本版本已关闭"去重限制
  if (s === 'available') {
    if (updateStore.latestVersion && updateStore.dismissedVersion === updateStore.latestVersion) {
      return false
    }
    return true
  }
  return false
})

function onDismiss(): void {
  if (updateStore.latestVersion) {
    // dismiss 内部按状态隐藏浮窗（downloading/downloaded/installing）
    updateStore.dismiss(updateStore.latestVersion)
  }
}

async function onUpdate(): Promise<void> {
  await updateStore.startDownload()
}

async function onInstall(): Promise<void> {
  const confirmed = await confirm(
    '安装更新',
    '安装完成后当前窗口会关闭并拉起新版本，未保存内容会丢失。确认现在安装并重启吗？'
  )
  if (!confirmed) return
  await updateStore.startInstall()
}
</script>

<style scoped>
.update-toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 1000;
  width: 300px;
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.update-toast-close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.update-toast-close:hover {
  background: var(--surface-alt);
  color: var(--text-primary);
}

.update-toast-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  padding-right: 20px;
}

.update-toast-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.update-toast-body p {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.update-toast-actions {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 6px 14px;
  border-radius: var(--radius-control);
  border: none;
  cursor: pointer;
  font-size: 12px;
  transition: all var(--transition-fast);
  flex: 1;
}

.btn-primary {
  background: var(--accent);
  color: var(--accent-contrast, #fff);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--divider);
}

.btn-ghost:hover {
  background: var(--surface-alt);
  color: var(--text-primary);
}

.update-toast-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.update-toast-progress-bar {
  flex: 1;
  height: 6px;
  background: var(--divider);
  border-radius: 3px;
  overflow: hidden;
}

.update-toast-progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.2s ease;
}

.update-toast-progress-text {
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
  min-width: 32px;
  text-align: right;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
