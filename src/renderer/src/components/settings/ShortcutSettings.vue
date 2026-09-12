<template>
  <div class="shortcut-settings">
    <div class="shortcut-table">
      <div v-for="item in shortcuts" :key="item.desc + item.keys" class="shortcut-row">
        <div class="shortcut-info">
          <div class="shortcut-scope">{{ item.scope }}</div>
          <div class="shortcut-desc">{{ item.desc }}</div>
        </div>
        <div class="shortcut-keys">
          <kbd v-for="key in splitKeys(item.keys)" :key="key">{{ key }}</kbd>
        </div>
      </div>
    </div>

    <p class="hint">
      当前版本的快捷键为内置固定绑定，暂不支持自定义。
      {{ isMac ? 'macOS 上使用 ⌘ Cmd，Windows / Linux 上使用 Ctrl。' : 'Windows / Linux 上使用 Ctrl，macOS 上使用 ⌘ Cmd。' }}
    </p>
  </div>
</template>

<script setup lang="ts">
// 仅列出当前版本真实存在的绑定（与代码中的 keydown 处理一一对应），
// 不展示尚未实现的「自定义快捷键」承诺。
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

const shortcuts: { scope: string; desc: string; keys: string }[] = [
  { scope: '终端', desc: '打开终端内搜索', keys: isMac ? '⌘ F' : 'Ctrl F' },
  { scope: '终端搜索栏', desc: '查找下一个', keys: 'Enter' },
  { scope: '终端搜索栏', desc: '查找上一个', keys: 'Shift Enter' },
  { scope: '终端搜索栏', desc: '关闭搜索并返回终端', keys: 'Esc' },
  { scope: '聊天输入框', desc: '发送消息', keys: 'Enter' },
  { scope: '聊天输入框', desc: '换行', keys: 'Shift Enter' }
]

function splitKeys(keys: string): string[] {
  return keys.split(' ')
}
</script>

<style scoped>
.shortcut-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.shortcut-table {
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: var(--radius-container);
  overflow: hidden;
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
}

.shortcut-row + .shortcut-row {
  border-top: 1px solid var(--divider-soft);
}

.shortcut-info {
  min-width: 0;
}

.shortcut-scope {
  font-size: 11px;
  color: var(--text-tertiary);
  letter-spacing: 0.3px;
}

.shortcut-desc {
  font-size: 13px;
  color: var(--text-primary);
  margin-top: 2px;
}

.shortcut-keys {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  padding: 2px 7px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  color: var(--text-secondary);
  background: var(--surface-alt);
  border: 1px solid var(--divider);
  border-bottom-width: 2px;
  border-radius: 4px;
}

.hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0;
  line-height: 1.6;
}
</style>
