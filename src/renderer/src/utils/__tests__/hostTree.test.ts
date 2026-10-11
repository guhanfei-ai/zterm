import { describe, expect, it } from 'vitest'
import { moveHostTreeItem, normalizeHostTree, removeHostFolder, resolveHostTreeDropTarget, type HostTreeFolder, type HostTreeItem } from '../hostTree'

const host = (id: string): HostTreeItem => ({ kind: 'host', id })
const folder = (id: string, hostIds: string[] = []): HostTreeFolder => ({ kind: 'folder', id, name: id, hostIds })

describe('主机树迁移与清理', () => {
  it('沿用旧排序，忽略重复与删除项，新主机追加到末尾', () => {
    expect(normalizeHostTree(undefined, ['a', 'b', 'c'], ['b', 'missing', 'b', 'a'])).toEqual([host('b'), host('a'), host('c')])
  })

  it('保留分组和空文件夹，每台主机只出现一次', () => {
    const saved = { version: 1, items: [folder('f', ['b', 'deleted', 'b']), host('b'), folder('empty'), folder('f', ['a']), host('a'), null] }
    expect(normalizeHostTree(saved, ['a', 'b', 'c'], ['c', 'b', 'a'])).toEqual([folder('f', ['b']), folder('empty'), host('a'), host('c')])
  })

  it('清理无效文件夹、名称与未知版本', () => {
    expect(normalizeHostTree({ version: 1, items: [
      { ...folder('f', ['a']), name: '  生产  ' },
      { ...folder('bad'), name: ' ' },
      { ...folder('long'), name: 'x'.repeat(81) },
      { ...folder('invalid'), hostIds: null }
    ] }, ['a', 'b'])).toEqual([{ ...folder('f', ['a']), name: '生产' }, host('b')])
    expect(normalizeHostTree({ version: 2, items: [folder('f')] }, ['a'])).toEqual([host('a')])
  })
})

describe('主机与文件夹移动', () => {
  it('向下与向上移动根条目，文件夹携带原有主机', () => {
    const items = [host('a'), folder('f', ['b', 'c']), host('d')]
    expect(moveHostTreeItem(items, host('a'), { folderId: null, index: 3 })).toEqual([folder('f', ['b', 'c']), host('d'), host('a')])
    expect(moveHostTreeItem(items, folder('f'), { folderId: null, index: 0 })).toEqual([folder('f', ['b', 'c']), host('a'), host('d')])
    expect(items).toEqual([host('a'), folder('f', ['b', 'c']), host('d')])
  })

  it('相邻插入位置是无操作', () => {
    const items = [host('a'), host('b')]
    expect(moveHostTreeItem(items, host('a'), { folderId: null, index: 1 })).toEqual(items)
  })

  it('将根主机移入文件夹，并从文件夹移回根列表', () => {
    const items = [host('a'), folder('f', ['b']), host('c')]
    const inside = moveHostTreeItem(items, host('a'), { folderId: 'f', index: 0 })
    expect(inside).toEqual([folder('f', ['a', 'b']), host('c')])
    expect(moveHostTreeItem(inside, host('b'), { folderId: null, index: 1 })).toEqual([folder('f', ['a']), host('b'), host('c')])
    expect(items).toEqual([host('a'), folder('f', ['b']), host('c')])
  })

  it('文件夹内双向排序，以及跨文件夹移动', () => {
    const items = [folder('f', ['a', 'b', 'c']), folder('g', ['d'])]
    expect(moveHostTreeItem(items, host('a'), { folderId: 'f', index: 3 })).toEqual([folder('f', ['b', 'c', 'a']), folder('g', ['d'])])
    expect(moveHostTreeItem(items, host('c'), { folderId: 'f', index: 0 })).toEqual([folder('f', ['c', 'a', 'b']), folder('g', ['d'])])
    expect(moveHostTreeItem(items, host('b'), { folderId: 'g', index: 1 })).toEqual([folder('f', ['a', 'c']), folder('g', ['d', 'b'])])
    expect(items).toEqual([folder('f', ['a', 'b', 'c']), folder('g', ['d'])])
  })

  it('拒绝失效位置与文件夹嵌套，不修改输入', () => {
    const items = [host('a'), folder('f')]
    for (const destination of [{ folderId: null, index: -1 }, { folderId: null, index: .5 }, { folderId: null, index: 3 }, { folderId: 'missing', index: 0 }]) {
      expect(() => moveHostTreeItem(items, host('a'), destination)).toThrow()
    }
    expect(() => moveHostTreeItem(items, folder('f'), { folderId: 'f', index: 0 })).toThrow('根列表')
    expect(() => moveHostTreeItem(items, host('missing'), { folderId: null, index: 0 })).toThrow('已不存在')
    expect(items).toEqual([host('a'), folder('f')])
  })

  it('删除文件夹时原位展开主机，保留顺序', () => {
    expect(removeHostFolder([host('a'), folder('f', ['b', 'c']), folder('empty'), host('d')], 'f'))
      .toEqual([host('a'), host('b'), host('c'), folder('empty'), host('d')])
  })
})

describe('拖动插入位置', () => {
  it('主机上下半行分别定位到前、后横线', () => {
    const row = { item: host('a'), folderId: 'f', index: 1 }
    expect(resolveHostTreeDropTarget(row, 'host', .1)).toEqual({ folderId: 'f', index: 1, inside: false })
    expect(resolveHostTreeDropTarget(row, 'host', .9)).toEqual({ folderId: 'f', index: 2, inside: false })
  })

  it('文件夹边缘显示根排序横线，中央接受主机移入', () => {
    const row = { item: folder('f', ['a']), folderId: null, index: 2 }
    expect(resolveHostTreeDropTarget(row, 'host', .1)).toEqual({ folderId: null, index: 2, inside: false })
    expect(resolveHostTreeDropTarget(row, 'host', .5)).toEqual({ folderId: 'f', index: 1, inside: true })
    expect(resolveHostTreeDropTarget(row, 'host', .9)).toEqual({ folderId: null, index: 3, inside: false })
    expect(resolveHostTreeDropTarget(row, 'folder', .5)).toEqual({ folderId: null, index: 3, inside: false })
  })

  it('文件夹不能插入另一文件夹的主机行', () => {
    expect(resolveHostTreeDropTarget({ item: host('a'), folderId: 'f', index: 0 }, 'folder', .1)).toBeNull()
  })
})
