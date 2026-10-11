<template>
  <button ref="trigger" class="mode-trigger" type="button" :disabled="disabled" aria-haspopup="menu" :aria-expanded="open"
    aria-label="对话模式与模型设置" @click="toggle" @keydown.down.prevent="show" @keydown.up.prevent="show">
    <span>{{ mode === 'agent' ? 'Agent模式' : 'Chat模式' }}</span>
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
  </button>
  <Teleport to="body">
    <div v-if="open" ref="menu" class="mode-menu" role="menu" aria-label="对话模式与模型设置"
      :style="position" @keydown="onMenuKeydown">
      <button v-for="option in modes" :key="option.value" type="button" role="menuitemradio" :aria-checked="mode === option.value"
        :class="{ selected: mode === option.value }" @click="select(option.value)">
        <span>{{ option.label }}</span>
        <svg v-if="mode === option.value" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>
      </button>
      <div class="menu-divider" role="separator"></div>
      <button type="button" role="menuitem" @click="openSettings">
        <span>模型设置</span>
        <svg class="settings-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--surface)"/><circle cx="15" cy="17" r="2" fill="var(--surface)"/></svg>
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { PanelMode } from '@/stores/chat'

const props = defineProps<{ mode: PanelMode; disabled: boolean }>()
const emit = defineEmits<{ change: [mode: PanelMode]; 'open-model-settings': [] }>()
const modes: { value: PanelMode; label: string }[] = [
  { value: 'agent', label: 'Agent模式' },
  { value: 'chat', label: 'Chat模式' }
]
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLDivElement | null>(null)
const open = ref(false)
const position = ref({ left: '0px', bottom: '0px' })
async function show(): Promise<void> {
  if (props.disabled || !trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  // 脱离输入框的 overflow，菜单向上展开并保持在窗口内。
  position.value = { left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 188))}px`, bottom: `${window.innerHeight - rect.top + 8}px` }
  open.value = true
  await nextTick()
  menu.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
}
function close(restoreFocus = false): void {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}
function toggle(): void { if (open.value) close(); else void show() }
function select(mode: PanelMode): void {
  if (props.disabled) return
  close(true)
  emit('change', mode)
}
function openSettings(): void {
  if (props.disabled) return
  close()
  emit('open-model-settings')
}
function onMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); close(true); return }
  if (event.key === 'Tab') { close(); return }
  const buttons = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button') ?? [])
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  let next: number
  if (event.key === 'ArrowDown') next = (index + 1) % buttons.length
  else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = buttons.length - 1
  else return
  event.preventDefault()
  buttons[next]?.focus()
}
function onOutside(event: Event): void {
  const target = event.target as Node | null
  if (open.value && !trigger.value?.contains(target) && !menu.value?.contains(target)) close()
}
function onResize(): void { close() }
watch(() => props.disabled, value => { if (value) close() })
watch(() => props.mode, () => close())
onMounted(() => {
  document.addEventListener('pointerdown', onOutside)
  document.addEventListener('focusin', onOutside)
  window.addEventListener('resize', onResize)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onOutside)
  document.removeEventListener('focusin', onOutside)
  window.removeEventListener('resize', onResize)
})
</script>

<style scoped>
.mode-trigger { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; height: 30px; padding: 0 9px; border: 1px solid var(--divider-soft, var(--divider)); border-radius: var(--radius-control); background: var(--surface-alt); color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.mode-trigger:hover, .mode-trigger[aria-expanded=true] { background: var(--hover-overlay); color: var(--text-primary); border-color: var(--divider); }
.mode-trigger:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
.mode-trigger svg { color: var(--text-tertiary); }
.mode-trigger:disabled { opacity: .5; cursor: default; }
.mode-menu { position: fixed; z-index: 1500; width: 180px; box-sizing: border-box; padding: 5px; border: 1px solid var(--divider); border-radius: var(--radius-control); background: var(--surface); box-shadow: var(--shadow-dialog); }
.mode-menu button { display: flex; align-items: center; justify-content: space-between; width: 100%; height: 34px; padding: 0 10px; border: 0; border-radius: var(--radius-sm, 5px); background: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.mode-menu button:hover, .mode-menu button:focus-visible { outline: none; background: var(--hover-overlay); color: var(--text-primary); }
.mode-menu button.selected { color: var(--accent); }
.mode-menu button.selected:hover, .mode-menu button.selected:focus-visible { background: var(--accent-muted); }
.menu-divider { height: 1px; margin: 5px 6px; background: var(--divider); }
.settings-icon { color: var(--text-tertiary); }
</style>
