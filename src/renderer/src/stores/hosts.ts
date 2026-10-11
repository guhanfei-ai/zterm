import { acceptHMRUpdate, defineStore } from 'pinia'
import { ref } from 'vue'
import type { HostRecord } from '../types/host'
import { useJumpserverStore } from './jumpserver'
import { normalizeHostTree, moveHostTreeItem, removeHostFolder, type HostTreeItem, type HostTreeSource, type HostTreeDestination } from '../utils/hostTree'

export type ActiveMode = 'direct' | 'jumpserver' | 'local'

export const useHostsStore = defineStore('hosts', () => {
  const hosts = ref<HostRecord[]>([])
  const loading = ref(false)
  const activeHostId = ref<string | null>(null)
  const activeMode = ref<ActiveMode>('direct')
  const treeItems = ref<HostTreeItem[]>([])
  const treeSaving = ref(false)
  const treeLoaded = ref(false)
  const treeError = ref('')
  let treeRevision = 0

  async function loadHostOrder(): Promise<string[]> {
    try {
      const raw = await window.electronAPI.preferences.get('hostOrder')
      return Array.isArray(raw) ? raw as string[] : []
    } catch {
      return []
    }
  }

  async function applyStoredOrder(): Promise<void> {
    const order = await loadHostOrder()
    if (!order.length) return
    const reordered: HostRecord[] = []
    for (const id of order) {
      const idx = hosts.value.findIndex((h) => h.id === id)
      if (idx !== -1 && !reordered.some(host => host.id === id)) reordered.push(hosts.value[idx])
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
      try {
        const revision = treeRevision
        const savingAtRead = treeSaving.value
        const raw = await window.electronAPI.preferences.get('hostTree')
        // 刷新与排序交错时，旧读取结果不能覆盖刚保存的列表。
        const current = savingAtRead || treeSaving.value || revision !== treeRevision
          ? { version: 1, items: treeItems.value } : raw
        treeItems.value = normalizeHostTree(current, hosts.value.map(host => host.id))
        treeLoaded.value = true
        treeError.value = ''
      } catch {
        treeItems.value = normalizeHostTree({ version: 1, items: treeItems.value }, hosts.value.map(host => host.id))
        treeLoaded.value = false
        treeError.value = '读取主机分组失败，请重试后再编辑或排序。'
      }
    } catch (err) {
      treeError.value = '读取主机列表或分组失败，请重试。'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function saveTree(items: HostTreeItem[]): Promise<void> {
    if (!treeLoaded.value || treeSaving.value || loading.value) throw new Error('主机分组尚未就绪，请稍后重试')
    treeSaving.value = true
    treeRevision++
    treeError.value = ''
    try {
      // 生成可经 IPC 克隆的普通对象，不把 Vue 响应式代理写入偏好。
      const snapshot = normalizeHostTree({ version: 1, items }, hosts.value.map(host => host.id))
      await window.electronAPI.preferences.set('hostTree', { version: 1, items: snapshot })
      treeItems.value = normalizeHostTree({ version: 1, items: snapshot }, hosts.value.map(host => host.id))
    } catch (err) {
      treeError.value = '保存主机分组或排序失败，请重试。'
      throw err
    } finally {
      treeSaving.value = false
    }
  }

  async function saveFolder(name: string, id?: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 80) throw new Error('文件夹名称须为 1～80 个字符')
    if (id && !treeItems.value.some(item => item.kind === 'folder' && item.id === id)) throw new Error('文件夹已不存在')
    const next = id ? treeItems.value.map(item => item.kind === 'folder' && item.id === id ? { ...item, name: trimmed } : item)
      : [...treeItems.value, { kind: 'folder' as const, id: crypto.randomUUID(), name: trimmed, hostIds: [] }]
    await saveTree(next)
  }

  async function moveTreeItem(source: HostTreeSource, destination: HostTreeDestination): Promise<void> {
    const next = moveHostTreeItem(treeItems.value, source, destination)
    if (JSON.stringify(next) !== JSON.stringify(treeItems.value)) await saveTree(next)
  }

  async function deleteFolder(id: string): Promise<void> {
    await saveTree(removeHostFolder(treeItems.value, id))
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
    treeItems,
    treeSaving,
    treeLoaded,
    treeError,
    saveFolder,
    moveTreeItem,
    deleteFolder,
    fetchHosts,
    createHost,
    updateHost,
    deleteHost,
    setActiveHost,
    setActiveMode
  }
})

// 新增状态与 action 时同步到已运行的 store，避免组件热更新后继续读取旧实例。
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useHostsStore, import.meta.hot))
}
