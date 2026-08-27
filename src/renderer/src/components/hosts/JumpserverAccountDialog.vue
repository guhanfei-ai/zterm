<template>
  <Teleport to="body">
    <div class="dialog-overlay" @click.self="$emit('close')">
      <div class="ja-dialog">
        <!-- 头部：标题行 + 资产名徽章 -->
        <div class="ja-header">
          <div class="ja-header-row">
            <span class="ja-title">选择账号</span>
            <button class="ja-close" title="关闭" @click="$emit('close')">✕</button>
          </div>
          <div class="ja-asset-bar">
            <svg class="ja-asset-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            <span class="ja-asset-name" :title="asset.name">{{ asset.name }}</span>
          </div>
        </div>

        <!-- 加载中 -->
        <div v-if="accountsLoading" class="ja-body ja-center">
          <div class="ja-status">
            <div class="ja-spinner" />
            <div class="ja-status-text">正在加载授权账号…</div>
          </div>
        </div>

        <!-- 加载失败 -->
        <div v-else-if="accountsError" class="ja-body">
          <div class="ja-center">
            <div class="ja-status">
              <div class="ja-status-icon ja-error">⚠</div>
              <div class="ja-status-text ja-error-text">{{ accountsError }}</div>
            </div>
          </div>
          <div class="ja-footer">
            <button class="ja-btn ja-btn-primary" @click="onRetryAccounts">重试</button>
            <button class="ja-btn ja-btn-secondary" @click="$emit('close')">关闭</button>
          </div>
        </div>

        <!-- 空账号 -->
        <div v-else-if="!connectableAccounts.length" class="ja-body ja-center">
          <div class="ja-status">
            <div class="ja-status-icon ja-empty">👤</div>
            <div class="ja-status-title">{{ accounts.length ? '暂无可连接账号' : '暂无授权账号' }}</div>
            <div class="ja-status-text ja-muted">
              {{ accounts.length ? '当前 JumpServer 角色对该资产账号只有查看权限，没有 connect 权限' : '该资产没有可用的登录账号' }}
            </div>
          </div>
        </div>

        <!-- 会话参数加载中 -->
        <div v-else-if="store.jumpserverSessionLoading" class="ja-body ja-center">
          <div class="ja-status">
            <div class="ja-spinner" />
            <div class="ja-status-text">正在申请连接令牌…</div>
          </div>
        </div>

        <!-- 会话参数已就绪 -->
        <div v-else-if="store.jumpserverSessionParams && !connectLoading && !connectError" class="ja-body">
          <div class="ja-center">
            <div v-if="autoPreferred" class="ja-preferred-hint">
              已自动使用偏好账号<span v-if="selectedAccountName"> · {{ selectedAccountName }}</span>
            </div>
            <div class="ja-session-card">
              <div class="ja-session-icon">✅</div>
              <div class="ja-session-title">连接参数已就绪</div>
              <div class="ja-session-params">
                <div class="ja-param-row">
                  <span class="ja-param-label">令牌</span>
                  <span class="ja-param-value">{{ store.jumpserverSessionParams.tokenId }}</span>
                </div>
                <div v-if="store.jumpserverSessionParams.clientUrl" class="ja-param-row">
                  <span class="ja-param-label">地址</span>
                  <span class="ja-param-value">{{ store.jumpserverSessionParams.clientUrl }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="ja-footer">
            <button v-if="autoPreferred && connectableAccounts.length > 1" class="ja-btn ja-btn-secondary" @click="onUseOtherAccount">改用其它账号</button>
            <button class="ja-btn ja-btn-primary" @click="onConnect">连接</button>
            <button class="ja-btn ja-btn-secondary" @click="$emit('close')">关闭</button>
          </div>
        </div>

        <!-- 终端连接中 -->
        <div v-else-if="connectLoading" class="ja-body ja-center">
          <div class="ja-status">
            <div class="ja-spinner" />
            <div class="ja-status-text">正在建立终端连接…</div>
          </div>
        </div>

        <!-- 终端连接失败 -->
        <div v-else-if="connectError" class="ja-body">
          <div class="ja-center">
            <div class="ja-status">
              <div class="ja-status-icon ja-error">⚠</div>
              <div class="ja-status-text ja-error-text">{{ connectError }}</div>
            </div>
          </div>
          <div class="ja-footer">
            <button class="ja-btn ja-btn-primary" @click="onConnect">重试</button>
            <button v-if="autoPreferred && connectableAccounts.length > 1" class="ja-btn ja-btn-secondary" @click="onUseOtherAccount">改用其它账号</button>
            <button class="ja-btn ja-btn-secondary" @click="$emit('close')">关闭</button>
          </div>
        </div>

        <!-- 会话参数失败 -->
        <div v-else-if="store.jumpserverSessionError" class="ja-body">
          <div class="ja-center">
            <div class="ja-status">
              <div class="ja-status-icon ja-error">⚠</div>
              <div v-if="sessionErrorStageLabel" class="ja-stage-label">{{ sessionErrorStageLabel }}</div>
              <div class="ja-status-text ja-error-text">{{ store.jumpserverSessionError }}</div>
            </div>
          </div>
          <div class="ja-footer">
            <button class="ja-btn ja-btn-primary" :disabled="!lastTriedAccountId" @click="onRetry">重试</button>
            <button v-if="connectableAccounts.length > 1" class="ja-btn ja-btn-secondary" @click="onUseOtherAccount">改用其它账号</button>
            <button class="ja-btn ja-btn-secondary" @click="$emit('close')">取消</button>
          </div>
        </div>

        <!-- 单账号：卡片展示 + 确认 -->
        <div v-else-if="connectableAccounts.length === 1" class="ja-body">
          <div class="ja-account-card">
            <div class="ja-account-card-label">唯一可用账号</div>
            <div class="ja-account-card-name">{{ connectableAccounts[0].name }}</div>
            <div v-if="connectableAccounts[0].username" class="ja-account-card-user">{{ connectableAccounts[0].username }}</div>
          </div>
          <div class="ja-footer">
            <button class="ja-btn ja-btn-primary" @click="onConfirm(connectableAccounts[0].accountId)">继续</button>
            <button class="ja-btn ja-btn-secondary" @click="$emit('close')">取消</button>
          </div>
        </div>

        <!-- 多账号：列表选择 + 确认 -->
        <div v-else class="ja-body">
          <div class="ja-list-label">请选择一个账号</div>
          <div v-if="connectableAccounts.length < accounts.length" class="ja-list-note">
            仅展示当前角色有 connect 权限的账号
          </div>
          <div class="ja-account-list">
            <div
              v-for="account in connectableAccounts"
              :key="account.accountId"
              class="ja-account-item"
              :class="{ selected: selectedId === account.accountId }"
              @click="selectedId = account.accountId"
            >
              <div class="ja-account-item-check">
                <span v-if="selectedId === account.accountId" class="ja-check-dot" />
              </div>
              <div class="ja-account-item-info">
                <div class="ja-account-item-name">{{ account.name }}</div>
                <div v-if="account.username" class="ja-account-item-user">{{ account.username }}</div>
              </div>
            </div>
          </div>
          <div class="ja-footer">
            <button class="ja-btn ja-btn-primary" :disabled="!selectedId" @click="onConfirm(selectedId!)">确认</button>
            <button class="ja-btn ja-btn-secondary" @click="$emit('close')">取消</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useJumpserverStore } from '@/stores/jumpserver'
import { useTerminalStore } from '@/stores/terminal'
import type { JumpserverAccount, JumpserverAsset } from '@/types/jumpserver'
import { estimateTerminalSize } from '@/utils/terminalSize'

const props = defineProps<{
  asset: JumpserverAsset
  accounts: JumpserverAccount[]
  accountsLoading: boolean
  accountsError: string | null
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const store = useJumpserverStore()
const terminalStore = useTerminalStore()
const selectedId = ref<string | null>(null)
const selectedAccountName = ref<string | null>(null)
const connectLoading = ref(false)
const connectError = ref<string | null>(null)
/** 最近一次提交创建连接令牌的账号 ID，供「重试」按钮直接复用，避免让用户重新走选账号流程 */
const lastTriedAccountId = ref<string | null>(null)

/**
 * 把服务端返回的错误归类到具体阶段标签，
 * 仅在弹窗的失败态顶部显示，让用户一眼看清是哪一步失败。
 * 与 jumpserverClient.ts 中 `createJumpserverConnectionToken` 的阶段前缀保持同源。
 */
const sessionErrorStageLabel = computed<string | null>(() => {
  const err = store.jumpserverSessionError
  if (!err) return null
  if (err.includes('创建连接令牌失败')) return '创建连接令牌阶段失败'
  if (err.includes('获取客户端地址失败')) return '获取客户端连接地址阶段失败'
  if (err.includes('获取用户信息')) return '读取用户信息阶段失败'
  return null
})

const connectableAccounts = computed(() => props.accounts.filter((account) => account.canConnect))

// ===== 账号偏好 / 有条件一键连接（P12）=====
/** 本资产的偏好账号 ID（来自本地账号偏好，按当前配置隔离） */
const preferredAccountId = computed(() => store.getPreferredAccountId(props.asset.assetId))
/** 是否已因命中有效偏好而自动跳过手选 */
const autoPreferred = ref(false)
/** 用户是否主动「改用其它账号」，置位后禁用本轮自动跳过 */
const userOverride = ref(false)

/**
 * 账号列表就绪后尝试有条件一键连接：
 * 仅当「多账号 + 本地存在有效偏好账号 + 用户未主动改选 + 当前无进行中的会话」时，
 * 自动走偏好账号申请令牌，跳过手选；否则维持原弹窗手选行为。
 */
function maybeAutoSelectPreferred(): void {
  if (props.accountsLoading || props.accountsError) return
  if (userOverride.value || autoPreferred.value) return
  if (store.jumpserverSessionParams || store.jumpserverSessionLoading) return
  if (connectableAccounts.value.length <= 1) return

  const preferred = preferredAccountId.value
  if (!preferred) return
  const match = connectableAccounts.value.find((a) => a.accountId === preferred)
  if (!match) return

  // 多账号列表预选偏好账号（即便用户后续手动改选也有合理默认）
  selectedId.value = preferred
  autoPreferred.value = true
  onConfirm(preferred)
}

watch(
  () => [props.accountsLoading, props.accounts] as const,
  () => maybeAutoSelectPreferred(),
  { immediate: true, deep: true }
)

async function onConfirm(accountId: string): Promise<void> {
  // 记住选中账号名，供 onConnect 写入终端身份与账号偏好
  const account = connectableAccounts.value.find(a => a.accountId === accountId)
  if (!account) return
  selectedAccountName.value = account?.name || account?.username || null
  // 记录本次尝试的账号 ID，供 onRetry 在不重置无关状态的情况下直接重试
  lastTriedAccountId.value = accountId
  await store.createJumpserverToken(props.asset.assetId, accountId)
}

/** 用户主动改用其它账号：退回手选列表，并禁用本轮自动跳过 */
function onUseOtherAccount(): void {
  userOverride.value = true
  autoPreferred.value = false
  store.clearJumpserverSession()
  connectError.value = null
  selectedAccountName.value = null
  // 清掉上一次尝试记录，下次 onConfirm 写入新的
  lastTriedAccountId.value = null
  selectedId.value =
    connectableAccounts.value.find((account) => account.accountId === preferredAccountId.value)?.accountId ??
    connectableAccounts.value[0]?.accountId ??
    null
}

/**
 * 重试当前失败动作：
 * 不重置账号列表、不重置选中状态，只用上次尝试的账号 ID 重新申请连接令牌。
 * 这样会话层失败不会污染「读取账号」这一上游阶段的成功状态。
 */
function onRetry(): void {
  if (!lastTriedAccountId.value) return
  // 清掉旧错误/参数但保留账号列表与选中项
  store.clearJumpserverSession()
  connectError.value = null
  // 直接重试创建令牌，不再要求用户重新点「确认」
  store.createJumpserverToken(props.asset.assetId, lastTriedAccountId.value)
}

function onRetryAccounts(): void {
  store.clearJumpserverAccounts()
  store.fetchJumpserverAccounts(props.asset.assetId)
}

async function onConnect(): Promise<void> {
  const sessionParams = store.jumpserverSessionParams
  if (!sessionParams) return

  connectError.value = null
  connectLoading.value = true

  // tabId 提到 try 外声明，catch 分支同样需要把异常落到对应终端标签上
  let tabId: string | null = null
  try {
    // 创建新的终端标签，标题使用资产名
    tabId = terminalStore.addTab('jumpserver')
    terminalStore.setCurrentHostByTabId(tabId, null, props.asset.name)
    terminalStore.setStatusByTabId(tabId, 'connecting')
    terminalStore.switchTab(tabId)

    const container = document.querySelector('.terminal-container')
    const { cols, rows } = estimateTerminalSize(container as HTMLElement | null)

    const result = await window.electronAPI.terminal.connectJumpserver(
      tabId,
      cols,
      rows,
      sessionParams.tokenId,
      sessionParams.clientUrl,
      props.asset.name,
      selectedAccountName.value ?? undefined
    )

    if (typeof result.generation === 'number') {
      terminalStore.setGenerationByTabId(tabId, result.generation)
    }

    if (result.success) {
      // 只有终端真正连接成功后，才写入最近使用与账号偏好
      await store.recordJumpserverRecent(props.asset)
      if (sessionParams.accountId) {
        await store.saveJumpserverAccountPreference(
          props.asset.assetId,
          sessionParams.accountId,
          selectedAccountName.value ?? ''
        )
      }
      emit('success')
    } else {
      terminalStore.setErrorByTabId(tabId, result.error || '终端连接失败')
      terminalStore.setStatusByTabId(tabId, 'disconnected')
      connectError.value = result.error || '终端连接失败'
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '终端连接异常'
    // IPC 抛异常时同步把终端标签置为失败，避免永远停在 connecting
    if (tabId) {
      terminalStore.setErrorByTabId(tabId, message)
      terminalStore.setStatusByTabId(tabId, 'disconnected')
    }
    connectError.value = message
  } finally {
    connectLoading.value = false
  }
}
</script>

<style scoped>
/* ===== 弹窗容器 ===== */
.ja-dialog {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-container);
  box-shadow: var(--shadow-dialog);
  width: 400px;
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
}

/* ===== 头部：标题行 + 资产名徽章 ===== */
.ja-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--divider-soft);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.ja-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.ja-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.ja-close {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  flex-shrink: 0;
  line-height: 1;
}

.ja-close:hover {
  background: var(--surface-alt);
  color: var(--text-primary);
}

.ja-asset-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--surface-alt);
  border-radius: var(--radius-sm);
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.ja-asset-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
  opacity: 0.7;
}

.ja-asset-name {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

/* ===== 主体区 ===== */
.ja-body {
  padding: 20px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* 居中包装器：只让状态内容垂直居中，页脚保持贴底 */
.ja-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

/* ===== 居中状态容器 ===== */
.ja-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
}

.ja-status-icon {
  font-size: 28px;
  line-height: 1;
  margin-bottom: 4px;
}

.ja-status-icon.ja-error {
  color: var(--danger);
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--danger-muted);
  border-radius: 50%;
  font-size: 18px;
  font-weight: 600;
}

.ja-status-icon.ja-empty {
  opacity: 0.5;
}

.ja-status-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.ja-status-text {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  line-height: 1.5;
  max-width: 300px;
}

.ja-status-text.ja-error-text {
  color: var(--danger);
}

.ja-status-text.ja-muted {
  color: var(--text-tertiary);
}

/* 加载旋转动画 */
.ja-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--divider);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: ja-spin 0.8s linear infinite;
  margin-bottom: 4px;
}

@keyframes ja-spin {
  to { transform: rotate(360deg); }
}

/* 错误阶段标签 */
.ja-stage-label {
  display: inline-block;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-radius: var(--radius-sm);
}

/* ===== 偏好提示 ===== */
.ja-preferred-hint {
  margin-bottom: 12px;
  padding: 3px 10px;
  font-size: 11px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border-radius: var(--radius-sm);
}

/* ===== 会话参数就绪卡片 ===== */
.ja-session-card {
  text-align: center;
  padding: 16px 0 12px;
}

.ja-session-icon {
  font-size: 28px;
  margin-bottom: 8px;
}

.ja-session-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 14px;
}

.ja-session-params {
  text-align: left;
  background: var(--bg);
  border: 1px solid var(--divider-soft);
  border-radius: var(--radius-control);
  padding: 10px 14px;
}

.ja-param-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  padding: 3px 0;
}

.ja-param-label {
  color: var(--text-tertiary);
  min-width: 32px;
  flex-shrink: 0;
}

.ja-param-value {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== 单账号确认卡片 ===== */
.ja-account-card {
  background: var(--surface-alt);
  border: 1px solid var(--divider-soft);
  border-radius: var(--radius-control);
  padding: 20px;
  text-align: center;
  margin-bottom: 4px;
}

.ja-account-card-label {
  font-size: 10px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 14px;
}

.ja-account-card-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.ja-account-card-user {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

/* ===== 多账号列表 ===== */
.ja-list-label {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 10px;
}

.ja-account-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 280px;
  overflow-y: auto;
}

.ja-list-note {
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.ja-account-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}

.ja-account-item:hover {
  border-color: var(--accent);
  background: var(--hover-overlay);
}

.ja-account-item.selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.ja-account-item-check {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1.5px solid var(--divider);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: border-color 0.12s;
}

.ja-account-item.selected .ja-account-item-check {
  border-color: var(--accent);
}

.ja-check-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

.ja-account-item-info {
  flex: 1;
  min-width: 0;
}

.ja-account-item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ja-account-item-user {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== 底部操作区 ===== */
.ja-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-sm);
  padding-top: 16px;
  margin-top: auto;
  flex-shrink: 0;
  border-top: 1px solid var(--divider-soft);
}

/* ===== 按钮 ===== */
.ja-btn {
  padding: 6px 18px;
  border-radius: var(--radius-control);
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.ja-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ja-btn-primary {
  background: var(--accent);
  color: #fff;
}

.ja-btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.ja-btn-primary:active:not(:disabled) {
  background: var(--accent-pressed);
}

.ja-btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--divider);
}

.ja-btn-secondary:hover:not(:disabled) {
  background: var(--surface-alt);
  color: var(--text-primary);
  border-color: var(--border-soft);
}
</style>
