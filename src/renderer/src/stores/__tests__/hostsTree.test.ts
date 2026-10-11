import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useHostsStore } from '../hosts'
import type { HostRecord } from '../../types/host'
import type { HostTreeFolder } from '../../utils/hostTree'

const host = (id: string): HostRecord => ({ id, name: id, host: `${id}.example`, port: 22, username: 'user', authType: 'password', createdAt: '', updatedAt: '' })

describe('主机分组持久化', () => {
  let records: HostRecord[]
  let preferences: Map<string, unknown>
  let get: ReturnType<typeof vi.fn>
  let set: ReturnType<typeof vi.fn>
  beforeEach(() => {
    setActivePinia(createPinia())
    records = ['a', 'b', 'c'].map(host)
    preferences = new Map()
    get = vi.fn(async (key: string) => structuredClone(preferences.get(key)))
    // structuredClone 同时检查交给 IPC 的数据不包含 Vue Proxy。
    set = vi.fn(async (key: string, value: unknown) => { preferences.set(key, structuredClone(value)) })
    vi.stubGlobal('window', { electronAPI: { preferences: { get, set }, hosts: { list: vi.fn(async () => structuredClone(records)) } } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('迁移旧排序，不因旧重复项重复显示主机', async () => {
    preferences.set('hostOrder', ['c', 'a', 'c'])
    const store = useHostsStore()
    await store.fetchHosts()
    expect(store.hosts.map(record => record.id)).toEqual(['c', 'a', 'b'])
    expect(store.treeItems.map(item => item.id)).toEqual(['c', 'a', 'b'])
    expect(store.treeLoaded).toBe(true)
  })

  it('创建、重命名、移入、混合排序后在新工作区恢复', async () => {
    const store = useHostsStore()
    await store.fetchHosts()
    await store.saveFolder('  生产  ')
    const folder = store.treeItems[3] as HostTreeFolder
    await store.moveTreeItem({ kind: 'host', id: 'b' }, { folderId: folder.id, index: 0 })
    await store.moveTreeItem({ kind: 'folder', id: folder.id }, { folderId: null, index: 0 })
    await store.saveFolder('服务器', folder.id)
    const expected = [{ ...folder, name: '服务器', hostIds: ['b'] }, { kind: 'host', id: 'a' }, { kind: 'host', id: 'c' }]
    expect(store.treeItems).toEqual(expected)
    setActivePinia(createPinia())
    const restored = useHostsStore()
    await restored.fetchHosts()
    expect(restored.treeItems).toEqual(expected)
    expect(restored.hosts).toEqual(records)
  })

  it('保存失败保持原列表，重试成功才发布顺序', async () => {
    const store = useHostsStore()
    await store.fetchHosts()
    set.mockRejectedValueOnce(new Error('disk full'))
    await expect(store.moveTreeItem({ kind: 'host', id: 'a' }, { folderId: null, index: 3 })).rejects.toThrow('disk full')
    expect(store.treeItems.map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(store.treeError).toContain('保存')
    expect(store.treeSaving).toBe(false)
    await store.moveTreeItem({ kind: 'host', id: 'a' }, { folderId: null, index: 3 })
    expect(store.treeItems.map(item => item.id)).toEqual(['b', 'c', 'a'])
    expect(store.treeError).toBe('')
  })

  it('分组读取失败时仍可查看主机，但阻止覆盖未知分组', async () => {
    get.mockImplementation(async (key: string) => {
      if (key === 'hostTree') throw new Error('read failed')
      return undefined
    })
    const store = useHostsStore()
    await store.fetchHosts()
    expect(store.hosts).toHaveLength(3)
    expect(store.treeLoaded).toBe(false)
    await expect(store.saveFolder('生产')).rejects.toThrow('尚未就绪')
    expect(set).not.toHaveBeenCalled()
    get.mockImplementation(async (key: string) => structuredClone(preferences.get(key)))
    await store.fetchHosts()
    await store.saveFolder('生产')
    expect(store.treeLoaded).toBe(true)
    expect(store.treeItems).toHaveLength(4)
  })

  it('删除与新增主机后清理引用，删除分组保留主机配置', async () => {
    preferences.set('hostTree', { version: 1, items: [{ kind: 'folder', id: 'f', name: '生产', hostIds: ['b', 'a'] }, { kind: 'host', id: 'c' }] })
    const store = useHostsStore()
    await store.fetchHosts()
    records = [host('a'), host('c'), host('d')]
    await store.fetchHosts()
    expect(store.treeItems).toEqual([{ kind: 'folder', id: 'f', name: '生产', hostIds: ['a'] }, { kind: 'host', id: 'c' }, { kind: 'host', id: 'd' }])
    await store.deleteFolder('f')
    expect(store.treeItems.map(item => item.id)).toEqual(['a', 'c', 'd'])
    expect(store.hosts).toEqual(records)
  })

  it('等待保存期间拒绝并发修改，避免旧列表覆盖新结果', async () => {
    const store = useHostsStore()
    await store.fetchHosts()
    let finish: () => void = () => {}
    set.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const pending = store.moveTreeItem({ kind: 'host', id: 'a' }, { folderId: null, index: 3 })
    expect(store.treeSaving).toBe(true)
    await expect(store.saveFolder('生产')).rejects.toThrow('尚未就绪')
    expect(store.treeItems.map(item => item.id)).toEqual(['a', 'b', 'c'])
    finish()
    await pending
    expect(store.treeItems.map(item => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('无操作不写入，名称无效或失效重命名不写入', async () => {
    const store = useHostsStore()
    await store.fetchHosts()
    await store.moveTreeItem({ kind: 'host', id: 'a' }, { folderId: null, index: 1 })
    await expect(store.saveFolder(' ')).rejects.toThrow('名称')
    await expect(store.saveFolder('x'.repeat(81))).rejects.toThrow('名称')
    await expect(store.saveFolder('生产', 'missing')).rejects.toThrow('已不存在')
    expect(set).not.toHaveBeenCalled()
  })

  it('保存与主机刷新交错时保留新顺序和新增主机', async () => {
    const store = useHostsStore()
    await store.fetchHosts()
    let finishSave: () => void = () => {}
    let finishRead: (() => void) | undefined
    set.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve }))
    const saving = store.moveTreeItem({ kind: 'host', id: 'a' }, { folderId: null, index: 3 })
    records.push(host('d'))
    get.mockImplementation(async (key: string) => {
      if (key === 'hostTree') return new Promise(resolve => {
        finishRead = () => resolve({ version: 1, items: ['a', 'b', 'c'].map(id => ({ kind: 'host', id })) })
      })
      return undefined
    })
    const refreshing = store.fetchHosts()
    await vi.waitFor(() => expect(finishRead).toBeDefined())
    finishSave()
    await saving
    finishRead!()
    await refreshing
    expect(store.treeItems.map(item => item.id)).toEqual(['b', 'c', 'a', 'd'])
  })
})
