import { computed, onUnmounted, ref } from 'vue'
import type { SshHostTrustDecision, SshHostTrustRequiredEvent } from '../../../main/model/sshHostTrust'
import { useTerminalStore } from '@/stores/terminal'

const request = ref<SshHostTrustRequiredEvent | null>(null)

export function useSshHostTrust() {
  const terminalStore = useTerminalStore()
  const isVisible = computed(() => request.value !== null)

  function handleHostTrustRequired(event: SshHostTrustRequiredEvent): void {
    const current = request.value
    if (current?.kind === 'unknown') {
      void window.electronAPI.terminal.respondHostTrust({
        tabId: current.tabId,
        generation: current.generation,
        requestId: current.requestId,
        decision: 'reject'
      })
    }
    request.value = event
  }

  async function respond(decision: SshHostTrustDecision): Promise<void> {
    const current = request.value
    if (!current || current.kind !== 'unknown') return
    request.value = null
    await window.electronAPI.terminal.respondHostTrust({
      tabId: current.tabId,
      generation: current.generation,
      requestId: current.requestId,
      decision
    })
  }

  async function resetChangedTrust(): Promise<void> {
    const current = request.value
    if (!current || current.kind !== 'changed') return
    const hostId = terminalStore.getTabById(current.tabId)?.hostId
    if (!hostId) return
    const result = await window.electronAPI.terminal.resetHostTrust(hostId)
    if (result.success) request.value = null
  }

  function dismissChangedTrust(): void {
    if (request.value?.kind === 'changed') request.value = null
  }

  onUnmounted(() => {
    if (request.value?.kind === 'unknown') {
      void respond('reject')
    }
  })

  return {
    request,
    isVisible,
    handleHostTrustRequired,
    respond,
    resetChangedTrust,
    dismissChangedTrust
  }
}
