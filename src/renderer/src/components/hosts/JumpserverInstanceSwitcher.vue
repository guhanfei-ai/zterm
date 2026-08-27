<template>
  <div class="instance-switcher">
    <button
      class="instance-current"
      :class="{ open: dropdownOpen }"
      :title="currentTitle"
      @click="toggleDropdown"
    >
      <span class="instance-current-name">{{ currentName || '选择实例' }}</span>
      <span class="instance-current-caret">▾</span>
    </button>

    <div v-if="dropdownOpen" class="instance-dropdown" @click.stop>
      <div class="instance-dropdown-header">
        <span>切换实例</span>
        <button class="instance-add-btn" title="添加新实例" @click="onAdd">+ 新建</button>
      </div>

      <div v-if="!configs.length" class="instance-dropdown-empty">
        还没有任何实例
      </div>

      <div
        v-for="config in configs"
        :key="config.id"
        class="instance-item"
        :class="{ active: config.id === activeConfigId }"
      >
        <div class="instance-item-main" @click="onSelect(config.id)">
          <div class="instance-item-name">
            {{ config.name }}
            <span v-if="config.id === activeConfigId" class="instance-item-tag">当前</span>
          </div>
          <div class="instance-item-url">{{ config.baseUrl }}</div>
        </div>
        <button
          class="instance-item-edit"
          title="编辑该实例"
          @click.stop="onEdit(config)"
        >
          ✎
        </button>
        <button
          class="instance-item-delete"
          title="删除该实例"
          @click.stop="onDelete(config)"
        >
          ✕
        </button>
      </div>
    </div>

    <div v-if="dropdownOpen" class="instance-dropdown-overlay" @click="closeDropdown" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useJumpserverStore } from '@/stores/jumpserver'
import { useConfirm } from '@/composables/useConfirm'
import type { JumpserverConfig } from '@/types/jumpserver'

const emit = defineEmits<{
  add: []
  edit: [config: JumpserverConfig & { hasCredential: boolean }]
}>()

const jumpserverStore = useJumpserverStore()
const { confirm } = useConfirm()

const dropdownOpen = ref(false)
const configs = computed(() => jumpserverStore.jumpserverConfigs)
const activeConfigId = computed(() => jumpserverStore.jumpserverActiveConfigId)
const currentName = computed(() => jumpserverStore.jumpserverConfig?.name ?? '')
const currentTitle = computed(() => jumpserverStore.jumpserverConfig?.baseUrl ?? '请选择 Jumpserver 实例')

function toggleDropdown(): void {
  dropdownOpen.value = !dropdownOpen.value
}

function closeDropdown(): void {
  dropdownOpen.value = false
}

async function onSelect(configId: string): Promise<void> {
  if (configId === activeConfigId.value) {
    closeDropdown()
    return
  }
  await jumpserverStore.setActiveJumpserverConfig(configId)
  closeDropdown()
}

function onAdd(): void {
  closeDropdown()
  emit('add')
}

function onEdit(config: JumpserverConfig & { hasCredential: boolean }): void {
  // 编辑 ≠ 切换实例：只打开对话框，不动当前活跃实例。
  // 当前实例的搜索 / 节点树 / 选中节点保持不变；取消编辑也不会影响。
  closeDropdown()
  emit('edit', config)
}

async function onDelete(config: JumpserverConfig & { hasCredential: boolean }): Promise<void> {
  const ok = await confirm(
    '删除 Jumpserver 实例',
    `确定要删除实例「${config.name}」吗？该实例的收藏、最近使用、账号偏好将一并清除。`
  )
  if (!ok) return
  await jumpserverStore.deleteJumpserverConfig(config.id)
  // 删除后可能仍是当前实例或已切换，由 store 内部决定
}

// 点击外部关闭
function onWindowClick(e: MouseEvent): void {
  if (!dropdownOpen.value) return
  const target = e.target as HTMLElement | null
  if (!target) return
  // 通过 .instance-switcher 容器判断：内部点击不关
  const switcher = (target as HTMLElement).closest?.('.instance-switcher')
  if (!switcher) closeDropdown()
}

onMounted(() => {
  window.addEventListener('click', onWindowClick)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowClick)
})
</script>

<style scoped>
.instance-switcher {
  position: relative;
}

.instance-current {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 12px;
  transition: border-color 0.15s, background 0.15s;
}

.instance-current:hover {
  border-color: var(--accent);
  background: var(--hover-overlay);
}

.instance-current.open {
  border-color: var(--accent);
}

.instance-current-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  text-align: left;
}

.instance-current-caret {
  margin-left: 6px;
  font-size: 10px;
  color: var(--text-tertiary);
  transition: transform 0.15s;
}

.instance-current.open .instance-current-caret {
  transform: rotate(180deg);
}

.instance-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-control);
  box-shadow: var(--shadow-dialog);
  z-index: 100;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
}

.instance-dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--divider-soft);
  margin-bottom: 4px;
}

.instance-add-btn {
  padding: 1px 6px;
  font-size: 10px;
  color: var(--accent);
  background: transparent;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.instance-add-btn:hover {
  background: var(--accent);
  color: #fff;
}

.instance-dropdown-empty {
  padding: 12px 6px;
  font-size: 11px;
  color: var(--text-tertiary);
  text-align: center;
}

.instance-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 4px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}

.instance-item:hover {
  background: var(--surface-alt);
}

.instance-item.active {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.instance-item-main {
  flex: 1;
  min-width: 0;
}

.instance-item-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.instance-item-tag {
  font-size: 9px;
  padding: 0 4px;
  border-radius: 3px;
  color: #fff;
  background: var(--accent);
  font-weight: 400;
}

.instance-item-url {
  font-size: 10px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.instance-item-delete {
  width: 22px;
  height: 22px;
  font-size: 11px;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}

.instance-item-delete:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.instance-item-edit {
  width: 22px;
  height: 22px;
  font-size: 11px;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}

.instance-item-edit:hover {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.instance-dropdown-overlay {
  position: fixed;
  inset: 0;
  z-index: 99;
}
</style>
