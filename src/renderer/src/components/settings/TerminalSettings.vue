<template>
  <div class="terminal-settings">
    <div class="block">
      <div class="block-label">字体</div>
      <select v-model="fontFamily" class="ts-select">
        <option v-for="opt in fontOptions" :key="opt.id" :value="opt.stack">
          {{ opt.label }}
        </option>
      </select>
    </div>

    <div class="block">
      <div class="block-label">字号</div>
      <div class="inline-row">
        <input
          v-model.number="fontSize"
          class="ts-number"
          type="number"
          min="10"
          max="24"
          step="1"
        />
        <span class="unit">px（10–24）</span>
      </div>
    </div>

    <div class="block">
      <div class="block-label">滚动回溯行数</div>
      <div class="inline-row">
        <select v-model.number="scrollback" class="ts-select">
          <option v-for="n in scrollbackOptions" :key="n" :value="n">
            {{ n.toLocaleString() }} 行
          </option>
        </select>
        <span class="unit">越大占用内存越多</span>
      </div>
    </div>

    <div class="block">
      <div class="block-label">光标样式</div>
      <div class="cursor-row">
        <button
          v-for="opt in cursorOptions"
          :key="opt.value"
          class="cursor-card"
          :class="{ active: store.prefs.cursorStyle === opt.value }"
          @click="store.update({ cursorStyle: opt.value })"
        >
          <span class="cursor-demo" :class="`demo-${opt.value}`"></span>
          <span>{{ opt.label }}</span>
        </button>
      </div>
      <p class="hint">光标样式会被锁定，远程程序（如 vim）无法更改</p>
    </div>

    <div class="block">
      <label class="check-row">
        <input v-model="cursorBlink" type="checkbox" />
        <span>光标闪烁</span>
      </label>
    </div>

    <div class="footer-row">
      <button class="btn-reset" @click="store.resetToDefaults()">恢复默认值</button>
      <span class="hint">修改立即生效并自动保存，对所有终端标签生效</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  useTerminalPrefsStore,
  TERMINAL_FONT_OPTIONS,
  TERMINAL_SCROLLBACK_OPTIONS,
  type TerminalCursorStyle
} from '@/stores/terminalPrefs'

const store = useTerminalPrefsStore()
const fontOptions = TERMINAL_FONT_OPTIONS
const scrollbackOptions = TERMINAL_SCROLLBACK_OPTIONS

const cursorOptions: { value: TerminalCursorStyle; label: string }[] = [
  { value: 'block', label: '方块' },
  { value: 'bar', label: '竖线' },
  { value: 'underline', label: '下划线' }
]

const fontFamily = computed({
  get: () => store.prefs.fontFamily,
  set: (v: string) => store.update({ fontFamily: v })
})

const fontSize = computed({
  get: () => store.prefs.fontSize,
  set: (v: number) => store.update({ fontSize: v })
})

const scrollback = computed({
  get: () => store.prefs.scrollback,
  set: (v: number) => store.update({ scrollback: v })
})

const cursorBlink = computed({
  get: () => store.prefs.cursorBlink,
  set: (v: boolean) => store.update({ cursorBlink: v })
})
</script>

<style scoped>
.terminal-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.inline-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.unit {
  font-size: 12px;
  color: var(--text-tertiary);
}

.ts-select {
  width: 100%;
  max-width: 320px;
  padding: 6px 10px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  outline: none;
  cursor: pointer;
}

.ts-select:focus {
  border-color: var(--accent);
}

.ts-number {
  width: 80px;
  padding: 6px 10px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  outline: none;
}

.ts-number:focus {
  border-color: var(--accent);
}

/* ===== 光标样式选择 ===== */
.cursor-row {
  display: flex;
  gap: 10px;
}

.cursor-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}

.cursor-card:hover {
  border-color: var(--border-soft);
  background: var(--surface-alt);
}

.cursor-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
  color: var(--text-primary);
}

.cursor-demo {
  display: inline-block;
  width: 10px;
  height: 16px;
  background: currentColor;
  opacity: 0.8;
}

.demo-bar {
  width: 3px;
}

.demo-underline {
  height: 3px;
  align-self: flex-end;
  margin-bottom: 1px;
}

/* ===== 开关行 ===== */
.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}

.check-row input {
  accent-color: var(--accent);
}

/* ===== 底部 ===== */
.footer-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 4px;
}

.btn-reset {
  padding: 6px 16px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}

.btn-reset:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0;
}
</style>
