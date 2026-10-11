import { afterEach, describe, expect, it, vi } from 'vitest'
import { acceptHMRUpdate, createPinia, defineStore, setActivePinia } from 'pinia'
import { createSSRApp, ref } from 'vue'
import { renderToString } from '@vue/server-renderer'
import DirectHostTree from '../DirectHostTree.vue'
import { useHostsStore } from '../../../stores/hosts'
import type { HostRecord } from '../../../types/host'

const records: HostRecord[] = Array.from({ length: 8 }, (_, index) => ({
  id: `host-${index}`, name: `机器 ${index + 1}`, host: `host-${index}.example`, port: 22,
  username: 'user', authType: 'password', createdAt: '', updatedAt: ''
}))

function render(pinia: ReturnType<typeof createPinia>): Promise<string> {
  return renderToString(createSSRApp(DirectHostTree, { connectedHostIds: new Set() }).use(pinia))
}

describe('已加载主机在分组组件更新后仍可见', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('旧缓存 store 没有分组字段时，八台主机正常显示', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const useLegacyHosts = defineStore('hosts', () => ({ hosts: ref(records), loading: ref(false), activeHostId: ref(null) }))
    useLegacyHosts()
    const html = await render(pinia)
    expect(html).toContain('8 台主机')
    for (const record of records) expect(html).toContain(`连接 ${record.name}`)
  })

  it('Pinia 热更新补充新增状态与 action，读取分组后可创建文件夹', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const useLegacyHosts = defineStore('hosts', () => ({ hosts: ref(records), loading: ref(false), activeHostId: ref(null) }))
    const legacy = useLegacyHosts()
    const preferences = new Map<string, unknown>()
    vi.stubGlobal('window', { electronAPI: {
      hosts: { list: vi.fn(async () => structuredClone(records)) },
      preferences: {
        get: vi.fn(async (key: string) => structuredClone(preferences.get(key))),
        set: vi.fn(async (key: string, value: unknown) => { preferences.set(key, structuredClone(value)) })
      }
    } })
    const hot = { data: {}, invalidate: vi.fn() }
    acceptHMRUpdate(useLegacyHosts, hot as Parameters<typeof acceptHMRUpdate>[1])({ useHostsStore })
    const store = useHostsStore()
    expect(store).toBe(legacy)
    expect(store.hosts).toEqual(records)
    expect(store.treeItems).toEqual([])
    await store.fetchHosts()
    await store.saveFolder('生产机器')
    const html = await render(pinia)
    expect(html).toContain('8 台主机')
    expect(html).toContain('生产机器')
    expect(hot.invalidate).not.toHaveBeenCalled()
  })
})
