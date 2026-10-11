export interface HostTreeHost {
  kind: 'host'
  id: string
}

export interface HostTreeFolder {
  kind: 'folder'
  id: string
  name: string
  hostIds: string[]
}

export type HostTreeItem = HostTreeHost | HostTreeFolder
export type HostTreeSource = Pick<HostTreeItem, 'kind' | 'id'>
export interface HostTreeDestination {
  folderId: string | null
  index: number
}
export interface HostTreeDropTarget extends HostTreeDestination { inside: boolean }

/** 行的上下边缘用于排序；文件夹中央接受主机移入。 */
export function resolveHostTreeDropTarget(
  row: { item: HostTreeItem; folderId: string | null; index: number },
  sourceKind: HostTreeSource['kind'],
  ratio: number
): HostTreeDropTarget | null {
  if (sourceKind === 'folder' && row.folderId !== null) return null
  if (row.item.kind === 'folder' && sourceKind === 'host' && ratio >= .25 && ratio <= .75) {
    return { folderId: row.item.id, index: row.item.hostIds.length, inside: true }
  }
  return { folderId: row.folderId, index: row.index + (ratio >= .5 ? 1 : 0), inside: false }
}

/** 保留旧主机排序，清理失效引用，新增主机追加到根列表。 */
export function normalizeHostTree(raw: unknown, hostIds: string[], legacyOrder: unknown = []): HostTreeItem[] {
  const validHosts = new Set(hostIds)
  const seenHosts = new Set<string>()
  const seenFolders = new Set<string>()
  const items: HostTreeItem[] = []
  const takeHost = (id: unknown): id is string => {
    if (typeof id !== 'string' || !validHosts.has(id) || seenHosts.has(id)) return false
    seenHosts.add(id)
    return true
  }
  const saved = raw as { version?: unknown; items?: unknown } | null
  if (saved?.version === 1 && Array.isArray(saved.items)) {
    for (const candidate of saved.items) {
      if (!candidate || typeof candidate !== 'object') continue
      const item = candidate as Record<string, unknown>
      if (item.kind === 'host' && takeHost(item.id)) {
        items.push({ kind: 'host', id: item.id })
      } else if (item.kind === 'folder' && typeof item.id === 'string' && item.id && !seenFolders.has(item.id) &&
          typeof item.name === 'string' && item.name.trim() && item.name.trim().length <= 80 && Array.isArray(item.hostIds)) {
        seenFolders.add(item.id)
        items.push({ kind: 'folder', id: item.id, name: item.name.trim(), hostIds: item.hostIds.filter(takeHost) })
      }
    }
  } else if (Array.isArray(legacyOrder)) {
    for (const id of legacyOrder) if (takeHost(id)) items.push({ kind: 'host', id })
  }
  for (const id of hostIds) if (takeHost(id)) items.push({ kind: 'host', id })
  return items
}

/** 目标索引取拖动前的位置；同列表向下移动时扣除被移走的源项。 */
export function moveHostTreeItem(items: HostTreeItem[], source: HostTreeSource, destination: HostTreeDestination): HostTreeItem[] {
  const next = items.map(item => item.kind === 'folder' ? { ...item, hostIds: [...item.hostIds] } : { ...item })
  if (!Number.isInteger(destination.index) || destination.index < 0) throw new Error('无效的排序位置')
  if (source.kind === 'folder' && destination.folderId !== null) throw new Error('文件夹只能在根列表排序')
  const targetFolder = destination.folderId === null ? null : next.find((item): item is HostTreeFolder =>
    item.kind === 'folder' && item.id === destination.folderId)
  if (destination.folderId !== null && !targetFolder) throw new Error('目标文件夹已不存在')
  const targetLength = targetFolder ? targetFolder.hostIds.length : next.length
  if (destination.index > targetLength) throw new Error('排序位置已失效，请重试')

  let sourceFolderId: string | null = null
  let sourceIndex = next.findIndex(item => item.kind === source.kind && item.id === source.id)
  let moved: HostTreeItem | undefined
  if (sourceIndex >= 0) {
    ;[moved] = next.splice(sourceIndex, 1)
  } else if (source.kind === 'host') {
    for (const item of next) {
      if (item.kind !== 'folder') continue
      const index = item.hostIds.indexOf(source.id)
      if (index < 0) continue
      sourceFolderId = item.id
      sourceIndex = index
      item.hostIds.splice(index, 1)
      moved = { kind: 'host', id: source.id }
      break
    }
  }
  if (!moved) throw new Error('拖动的条目已不存在')
  const index = sourceFolderId === destination.folderId && sourceIndex < destination.index
    ? destination.index - 1 : destination.index
  if (targetFolder) targetFolder.hostIds.splice(index, 0, moved.id)
  else next.splice(index, 0, moved)
  return next
}

/** 删除分组时原位展开主机，保留主机和它们的顺序。 */
export function removeHostFolder(items: HostTreeItem[], folderId: string): HostTreeItem[] {
  return items.flatMap(item => item.kind === 'folder' && item.id === folderId
    ? item.hostIds.map(id => ({ kind: 'host' as const, id })) : [item])
}
