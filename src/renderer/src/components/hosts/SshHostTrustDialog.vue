<template>
  <div ref="overlay" class="trust-overlay" tabindex="-1" @click.self="onDismiss" @keydown.esc.prevent="onDismiss">
    <section class="trust-dialog" role="dialog" aria-modal="true" aria-labelledby="ssh-host-trust-title">
      <h2 id="ssh-host-trust-title">{{ request.kind === 'changed' ? 'SSH 主机身份已变更' : '确认 SSH 主机身份' }}</h2>
      <p v-if="request.kind === 'changed'" class="trust-warning">
        此端点的主机密钥与已信任记录不一致，连接已阻断。
      </p>
      <p v-else class="trust-warning">请仅在通过独立渠道核实指纹后信任此主机。</p>

      <dl class="trust-details">
        <div><dt>主机</dt><dd>{{ request.host }}</dd></div>
        <div><dt>端口</dt><dd>{{ request.port }}</dd></div>
        <div><dt>用户名</dt><dd>{{ request.username }}</dd></div>
        <div><dt>算法</dt><dd>{{ request.algorithm }}</dd></div>
        <div><dt>本次指纹</dt><dd class="fingerprint">{{ request.fingerprint }}</dd></div>
        <div v-if="request.kind === 'changed'"><dt>已信任算法</dt><dd>{{ request.trustedAlgorithm }}</dd></div>
        <div v-if="request.kind === 'changed'"><dt>已信任指纹</dt><dd class="fingerprint">{{ request.trustedFingerprint }}</dd></div>
      </dl>

      <div v-if="request.kind === 'unknown'" class="trust-actions">
        <button class="btn btn-cancel" @click="$emit('decision', 'reject')">拒绝</button>
        <button class="btn btn-secondary" @click="$emit('decision', 'trust-once')">仅本次信任</button>
        <button class="btn btn-confirm" @click="$emit('decision', 'trust-always')">长期信任</button>
      </div>
      <div v-else class="trust-actions">
        <template v-if="confirmReset">
          <span class="reset-confirmation">移除后不会自动重连，需重新发起连接并再次确认新指纹。</span>
          <button class="btn btn-cancel" @click="confirmReset = false">返回</button>
          <button class="btn btn-danger" @click="$emit('reset')">确认移除</button>
        </template>
        <template v-else>
          <button class="btn btn-cancel" @click="$emit('dismiss')">取消</button>
          <button class="btn btn-danger" @click="confirmReset = true">移除已信任指纹</button>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { SshHostTrustDecision, SshHostTrustRequiredEvent } from '../../../../main/model/sshHostTrust'

const props = defineProps<{
  request: SshHostTrustRequiredEvent
}>()

const emit = defineEmits<{
  decision: [decision: SshHostTrustDecision]
  dismiss: []
  reset: []
}>()

const confirmReset = ref(false)
const overlay = ref<HTMLElement | null>(null)

onMounted(() => {
  overlay.value?.focus()
})

watch(
  () => props.request.requestId,
  () => {
    confirmReset.value = false
  }
)

function onDismiss(): void {
  if (props.request.kind === 'unknown') {
    emit('decision', 'reject')
    return
  }
  emit('dismiss')
}
</script>

<style scoped>
.trust-overlay {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(2px);
}

.trust-dialog {
  width: min(560px, 100%);
  border: 1px solid var(--divider);
  border-radius: var(--radius-container);
  background: var(--surface);
  box-shadow: var(--shadow-dialog);
  overflow: hidden;
}

h2 {
  margin: 0;
  padding: 16px 20px;
  border-bottom: 1px solid var(--divider);
  color: var(--text-primary);
  font-size: 15px;
}

.trust-warning {
  margin: 0;
  padding: 16px 20px 0;
  color: var(--warning, #d9a441);
  font-size: 13px;
  line-height: 1.6;
}

.trust-details {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 16px 20px 20px;
}

.trust-details div {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 12px;
}

dt {
  color: var(--text-tertiary);
  font-size: 12px;
}

dd {
  min-width: 0;
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.fingerprint {
  user-select: all;
}

.trust-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  padding: var(--space-md) 20px;
  border-top: 1px solid var(--divider);
}

.reset-confirmation {
  flex: 1;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.btn {
  padding: 7px 14px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-control);
  cursor: pointer;
  font-size: 13px;
}

.btn-cancel,
.btn-secondary {
  background: var(--surface-alt);
  color: var(--text-secondary);
}

.btn-confirm {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

.btn-danger {
  border-color: var(--danger);
  background: var(--danger);
  color: #fff;
}
</style>
