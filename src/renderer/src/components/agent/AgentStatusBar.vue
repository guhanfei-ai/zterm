<template>
  <div class="agent-status-bar">
    <!-- 行1 (主操作行)：状态信息 + 核心操作按钮，高优先级，允许窄宽度换行 -->
    <div class="toolbar-actions">
      <span class="toolbar-info">
        <span class="info-bracket" :class="agentState">（{{ bracketLabel }}）</span>
        <span v-if="boundHost" class="info-dot info-dot--bound">已绑定</span>
        <span v-else class="info-dot info-dot--unbound">未绑定</span>
      </span>
      <div class="action-group">
        <button
          class="btn-action"
          @click="$emit('bind')"
        >
          {{ boundHost ? '重新绑定' : '绑定终端' }}
        </button>
        <button
          v-if="agentState !== 'idle' && !isTerminal"
          class="btn-action btn-stop"
          @click="$emit('stop')"
        >
          停止
        </button>
        <button
          v-if="isTerminal"
          class="btn-action"
          @click="$emit('reset')"
        >
          清空
        </button>
        <button
          v-if="agentState === 'stepLimitReached'"
          class="btn-action btn-continue"
          @click="$emit('continue')"
        >
          继续
        </button>
      </div>
    </div>

    <!-- 行2 (次控制行)：模式开关 + 说明文案 -->
    <div class="toolbar-secondary">
      <button
        type="button"
        class="mode-switch"
        :class="{ 'mode-switch--on': allowWrite }"
        role="switch"
        :aria-checked="allowWrite"
        :aria-label="allowWrite ? '当前为读写模式，点击切回只读模式' : '当前为只读模式，点击切换到读写模式'"
        @click="$emit('toggle-write', !allowWrite)"
      >
        <span class="mode-switch-label" :class="{ 'is-active': !allowWrite }">只读模式</span>
        <span class="mode-switch-track">
          <span class="mode-switch-thumb"></span>
        </span>
        <span class="mode-switch-label" :class="{ 'is-active': allowWrite }">读写模式</span>
      </button>
      <span v-if="!allowWrite" class="toolbar-hint">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        仅读取信息，不修改文件或系统配置
      </span>
      <span v-else class="toolbar-hint">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        自动执行已关闭 · 每条写命令需人工确认
      </span>
    </div>

    <!-- 行3：自动执行，单独放到下一行，避免和模式开关挤在一起 -->
    <div v-if="!allowWrite" class="toolbar-tertiary">
      <button
        type="button"
        class="mode-switch auto-execute-switch"
        :class="{ 'mode-switch--on': autoExecute }"
        role="switch"
        :aria-checked="autoExecute"
        :aria-label="autoExecute ? '当前为自动执行，点击切换为手动确认' : '当前为手动确认，点击切换为自动执行'"
        @click="$emit('toggle-auto', !autoExecute)"
      >
        <span class="mode-switch-label" :class="{ 'is-active': !autoExecute }">手动确认</span>
        <span class="mode-switch-track">
          <span class="mode-switch-thumb"></span>
        </span>
        <span class="mode-switch-label" :class="{ 'is-active': autoExecute }">自动执行</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  agentState: string
  boundHost?: string
  elapsedSteps?: number
  maxSteps?: number
  autoExecute?: boolean
  allowWrite?: boolean
}>()

defineEmits<{
  bind: []
  stop: []
  reset: []
  continue: []
  'toggle-auto': [enabled: boolean]
  'toggle-write': [enabled: boolean]
}>()

const isTerminal = computed(() =>
  props.agentState === 'completed' ||
  props.agentState === 'failed' ||
  props.agentState === 'stopped'
)

const bracketLabel = computed(() => {
  const stateMap: Record<string, string> = {
    idle: '',
    planning: '·规划中',
    executing: '·执行中',
    observing: '·观察中',
    summarizing: '·总结中',
    completed: '·已完成',
    failed: '·失败',
    stopped: '·已停止',
    stepLimitReached: '·达上限'
  }
  const statePart = stateMap[props.agentState] || ''
  const steps = `${props.elapsedSteps ?? 0}/${props.maxSteps ?? 25}步`
  return `Agent模式${statePart}：${steps}`
})
</script>

<style scoped>
/* ---- 工具条容器：透明、无阴影，视作头部的从属区域 ---- */
.agent-status-bar {
  padding: 4px 0 2px;
  background: transparent;
  flex-shrink: 0;
  border: none;
}

/* ---- 行1：主操作行（状态信息 + 核心按钮），允许窄宽度换行 ---- */
.toolbar-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 28px;
}

/* ---- 左侧：状态信息（短点缀风格）---- */
.toolbar-info {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  font-size: 11px;
}

.info-bracket {
  color: var(--text-secondary);
  white-space: nowrap;
}

.info-bracket.idle { color: var(--text-secondary); }
.info-bracket.planning { color: var(--warning); animation: pulse 1.5s infinite; }
.info-bracket.executing { color: var(--accent); animation: pulse 1s infinite; }
.info-bracket.observing { color: var(--accent-soft); }
.info-bracket.summarizing { color: var(--text-secondary); }
.info-bracket.completed { color: var(--success); }
.info-bracket.failed { color: var(--danger); }
.info-bracket.stopped { color: var(--warning); }
.info-bracket.stepLimitReached { color: var(--warning); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* 绑定状态点缀：轻量 inline 标签 */
.info-dot {
  display: inline-block;
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  line-height: 16px;
  font-family: inherit;
  white-space: nowrap;
}

.info-dot--bound {
  color: var(--success);
  background: var(--success-muted);
  border: 1px solid var(--divider);
}

.info-dot--unbound {
  color: var(--warning);
  background: var(--warning-muted);
  border: 1px solid var(--divider);
}

/* ---- 核心按钮组：高优先级，允许窄宽度换行不裁剪 ---- */
.action-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: auto;
}

/* ---- 操作按钮 ---- */
.btn-action {
  padding: 2px 7px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  font-family: inherit;
}

.btn-action:hover:not(:disabled) {
  background: var(--surface-alt);
  color: var(--text-primary);
  border-color: var(--border-soft);
}

.btn-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-stop {
  color: var(--danger);
}

.btn-stop:hover:not(:disabled) {
  background: var(--danger-muted);
  border-color: var(--danger);
}

.btn-continue {
  color: var(--success);
  font-weight: 600;
}

.btn-continue:hover {
  background: var(--success-muted);
  border-color: var(--success);
}

/* ---- 行2：次控制行（模式开关 + 说明提示） ---- */
.toolbar-secondary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

/* ---- 行3：自动执行开关，单独一行更清爽 ---- */
.toolbar-tertiary {
  display: flex;
  align-items: center;
  margin-top: 6px;
}

/* ---- 模式开关（只读/读写切换）---- */
.mode-switch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 2px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
  border-radius: var(--radius-sm);
  transition: background 0.15s;
  flex-shrink: 0;
}

.mode-switch:hover {
  background: var(--hover-overlay);
}

.mode-switch:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.mode-switch-label {
  color: var(--text-disabled);
  font-weight: 500;
  transition: color 0.15s;
  white-space: nowrap;
  user-select: none;
}

.mode-switch-label.is-active {
  color: var(--text-primary);
}

.mode-switch-track {
  position: relative;
  width: 28px;
  height: 14px;
  border-radius: 7px;
  background: var(--surface-alt);
  border: 1px solid var(--divider);
  transition: background 0.2s ease, border-color 0.2s ease;
  flex-shrink: 0;
  box-sizing: border-box;
}

.mode-switch--on .mode-switch-track {
  background: var(--warning-muted);
  border-color: var(--warning);
}

.mode-switch-thumb {
  position: absolute;
  top: 50%;
  left: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--success);
  transform: translateY(-50%);
  transition: transform 0.2s ease, background 0.2s ease;
}

.mode-switch--on .mode-switch-thumb {
  transform: translateY(-50%) translateX(11px);
  background: var(--warning);
}

/* 自动执行沿用同款开关，但用更中性的高亮色 */
.auto-execute-switch.mode-switch--on .mode-switch-track {
  background: var(--success-muted);
  border-color: var(--success);
}

.auto-execute-switch.mode-switch--on .mode-switch-thumb {
  background: var(--success);
}

/* ---- 弱提示文字：行内附属，低对比度 ---- */
.toolbar-hint {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--text-disabled);
  opacity: 0.5;
  white-space: nowrap;
}

.toolbar-hint svg {
  flex-shrink: 0;
  opacity: 0.5;
}
</style>
