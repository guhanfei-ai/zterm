<template>
  <Teleport to="body">
    <JumpserverConfigDialog
      v-if="visible"
      :config="target"
      @close="close"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import JumpserverConfigDialog from './JumpserverConfigDialog.vue'
import type { JumpserverConfig } from '@/types/jumpserver'

const visible = ref(false)
/** null = 新建实例；非 null = 编辑指定实例（含切换器中点编辑的任意实例） */
const target = ref<(JumpserverConfig & { hasCredential: boolean }) | null>(null)

/**
 * 打开对话框：默认创建模式；传入 config 时进入编辑该实例。
 * 编辑 ≠ 切换活跃实例，调用方应自行确保不会因编辑而改动 activeConfigId。
 */
function open(t: (JumpserverConfig & { hasCredential: boolean }) | null = null): void {
  target.value = t
  visible.value = true
}

function close(): void {
  visible.value = false
  target.value = null
}

defineExpose({ open, close })
</script>