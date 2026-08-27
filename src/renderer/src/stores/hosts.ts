import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { HostRecord } from '../types/host'
import { useJumpserverStore } from './jumpserver'

export type ActiveMode = 'direct' | 'jumpserver' | 'local'

export const useHostsStore = defineStore('hosts', () => {
  const hosts = ref<HostRecord[]>([])
  const loading = ref(false)
  const activeHostId = ref<string | null>(null)
  const activeMode = ref<ActiveMode>('direct')

  async function loadHostOrder(): Promise<string[]> {
    try {
      const raw = await window.electronAPI.preferences.get('hostOrder')
      return Array.isArray(raw) ? raw as string[] : []
    } catch {
      return []
    }
  }

  async function saveHostOrder(ids: string[]): Promise<void> {
    try {
      await window.electronAPI.preferences.set('hostOrder', ids)
    } catch {
      // 静默兜底
    }
  }

  async function applyStoredOrder(): Promise<void> {
    const order = await loadHostOrder()
    if (!order.length) return
    const reordered: HostRecord[] = []
    for (const id of order) {
      const idx = hosts.value.findIndex((h) => h.id === id)
      if (idx !== -1) reordered.push(hosts.value[idx])
    }
    for (const h of hosts.value) {
      if (!reordered.find((r) => r.id === h.id)) reordered.push(h)
    }
    hosts.value.splice(0, hosts.value.length, ...reordered)
  }

  async function fetchHosts(): Promise<void> {
    loading.value = true
    try {
      hosts.value = await window.electronAPI.hosts.list()
      await applyStoredOrder()
    } finally {
      loading.value = false
    }
  }

  async function createHost(data: {
    name: string
    host: string
    port?: number
    username: string
    authType: 'password' | 'key' | 'privateKeyFile'
    password?: string
    keyId?: string
    privateKeyFilePath?: string
    privateKeyFilePassphrase?: string
    description?: string
  }): Promise<HostRecord> {
    const record = await window.electronAPI.hosts.create(data)
    await fetchHosts()
    return record
  }

  async function updateHost(
    id: string,
    data: {
      name?: string
      host?: string
      port?: number
      username?: string
      authType?: 'password' | 'key' | 'privateKeyFile'
      password?: string
      keyId?: string
      privateKeyFilePath?: string
      privateKeyFilePassphrase?: string
      description?: string
    }
  ): Promise<HostRecord | null> {
    const updated = await window.electronAPI.hosts.update(id, data)
    if (updated) {
      await fetchHosts()
    }
    return updated
  }

  async function deleteHost(id: string): Promise<boolean> {
    const result = await window.electronAPI.hosts.delete(id)
    if (result) {
      if (activeHostId.value === id) {
        activeHostId.value = null
      }
      await fetchHosts()
    }
    return result
  }

  function setActiveHost(id: string | null): void {
    activeHostId.value = id
  }

  function setActiveMode(mode: ActiveMode): void {
    activeMode.value = mode
    // 切到 Jumpserver 模式时触发配置 + 节点树加载
    if (mode === 'jumpserver') {
      const jumpserverStore = useJumpserverStore()
      if (!jumpserverStore.jumpserverConfig && !jumpserverStore.jumpserverLoading) {
        // 首次进入：配置还没加载过，走 fetchJumpserverConfig
        jumpserverStore.fetchJumpserverConfig()
      }
      // 配置已加载 → 不做任何破坏式重拉，保留用户当前的搜索/选中节点/展开状态
      // 数据已陈旧时由用户手动点击「刷新」按钮触发 refreshJumpserverContext
    }
  }

  return {
    hosts,
    loading,
    activeHostId,
    activeMode,
    fetchHosts,
    createHost,
    updateHost,
    deleteHost,
    setActiveHost,
    setActiveMode,
    applyStoredOrder,
    saveHostOrder,
    loadHostOrder
  }
})
