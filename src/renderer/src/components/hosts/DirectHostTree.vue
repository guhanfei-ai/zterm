<template>
  <div class="direct-host-tree" @dragleave="onDragLeave" @dragend="clearDrag">
    <label v-if="treeItems.length" class="host-search">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 4 4"/></svg>
      <input v-model="filter" type="search" aria-label="搜索文件夹、主机、地址或用户" placeholder="搜索文件夹或主机" />
    </label>
    <div v-if="store.loading" class="placeholder">加载中...</div>
    <div v-else-if="!treeItems.length && !store.hosts.length" class="placeholder empty-state">
      <p>暂无主机或文件夹</p>
      <button @click="emit('add-host')">创建主机</button>
      <button :disabled="!editable" @click="editFolder = null; folderDialogOpen = true">创建文件夹</button>
    </div>
    <template v-else>
      <div v-for="row in rows" :key="rowKey(row)" class="tree-row-wrap"
        :class="{ 'insert-before': lineBefore(row), 'insert-after': lineAfter(row) }" :style="{ '--indent': `${10 + row.depth * 18}px` }">
        <div class="tree-row" :class="{ folder: row.item.kind === 'folder', active: row.host && store.activeHostId === row.host.id,
            dragging: dragSource?.kind === row.item.kind && dragSource.id === row.item.id,
            'folder-drop': dropTarget?.inside && dropTarget.folderId === row.item.id }"
          :style="{ paddingLeft: `${10 + row.depth * 18}px` }" :draggable="canDrag" role="button" tabindex="0"
          :aria-label="row.item.kind === 'folder' ? `${collapsed.has(row.item.id) ? '展开' : '折叠'}文件夹 ${row.item.name}` : `连接 ${row.host?.name}`"
          :aria-expanded="row.item.kind === 'folder' ? !collapsed.has(row.item.id) || !!keyword : undefined"
          @click="activate(row)" @keydown.enter.self.prevent="activate(row)" @keydown.space.self.prevent="activate(row)"
          @contextmenu="onContextMenu($event, row)" @dragstart="onDragStart($event, row)" @dragover="onDragOver($event, row)" @drop="drop">
          <span class="drag-handle" :title="keyword ? '清空搜索后可拖动排序' : '拖动排序'"><svg width="10" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="4" cy="4" r="1"/><circle cx="8" cy="4" r="1"/><circle cx="4" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="8" cy="12" r="1"/></svg></span>
          <template v-if="row.item.kind === 'folder'">
            <svg class="folder-chevron" :class="{ expanded: !collapsed.has(row.item.id) || keyword }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 5 7 7-7 7"/></svg>
            <svg class="folder-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>
            <span class="folder-name">{{ row.item.name }}</span>
            <span class="folder-count">{{ dropTarget?.inside && dropTarget.folderId === row.item.id ? '移入' : row.item.hostIds.length }}</span>
          </template>
          <template v-else-if="row.host">
            <span class="connection-dot" :class="{ connected: connectedHostIds.has(row.host.id) }" :title="connectedHostIds.has(row.host.id) ? '已有连接' : '未连接'" />
            <div class="host-info"><div class="host-name">{{ row.host.name }}</div><div class="host-detail">{{ row.host.username }}@{{ row.host.host }}:{{ row.host.port }}</div></div>
          </template>
          <div class="row-actions" @dragstart.stop.prevent>
            <template v-if="row.item.kind === 'folder'">
              <button class="row-action" title="重命名文件夹" :disabled="!editable" @click.stop="editFolder = row.item; folderDialogOpen = true"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m16 4 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg></button>
              <button class="row-action danger" title="删除文件夹，保留主机" :disabled="!editable" @click.stop="deleteFolder(row.item)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 3h6l1 4H8zm-3 4 1 14h12l1-14M10 11v6m4-6v6"/></svg></button>
            </template>
            <template v-else-if="row.host">
              <button class="row-action" title="编辑主机" :disabled="!editable" @click.stop="emit('edit', row.host)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m16 4 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg></button>
              <button class="row-action danger" title="删除主机" :disabled="!editable" @click.stop="emit('delete', row.host)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 3h6l1 4H8zm-3 4 1 14h12l1-14M10 11v6m4-6v6"/></svg></button>
            </template>
          </div>
        </div>
        <div v-if="row.item.kind === 'folder' && !row.item.hostIds.length && (!collapsed.has(row.item.id) || keyword)" class="folder-empty"
          @dragover="onEmptyFolderOver($event, row.item)" @drop="drop">拖入主机以添加到文件夹</div>
      </div>
      <div v-if="!keyword" class="tree-root-end" :class="{ 'insert-before': dropTarget?.folderId === null && dropTarget.index === treeItems.length }"
        @dragover="onRootEndOver" @drop="drop">{{ dragSource ? '拖到这里移至列表末尾' : '' }}</div>
      <div v-if="keyword && !rows.length" class="placeholder">未找到匹配文件夹或主机</div>
      <div class="host-count">{{ keyword ? `${visibleHostCount} / ${store.hosts.length}` : store.hosts.length }} 台主机</div>
    </template>
    <div v-if="store.treeError || error" class="tree-error" role="alert">{{ error || store.treeError }} <button @click="retry">重试</button></div>
    <HostFolderDialog v-if="folderDialogOpen" :folder="editFolder" @close="folderDialogOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useHostsStore } from '@/stores/hosts'
import { useConfirm } from '@/composables/useConfirm'
import type { HostRecord } from '@/types/host'
import { normalizeHostTree, resolveHostTreeDropTarget, type HostTreeItem, type HostTreeFolder, type HostTreeSource, type HostTreeDropTarget } from '@/utils/hostTree'
import HostFolderDialog from './HostFolderDialog.vue'

const props = defineProps<{ connectedHostIds: Set<string> }>()
const emit = defineEmits<{ 'add-host': []; connect: [host: HostRecord]; edit: [host: HostRecord]; delete: [host: HostRecord]; context: [event: MouseEvent, host: HostRecord] }>()
const store = useHostsStore()
const { confirm } = useConfirm()
const filter = ref('')
const keyword = computed(() => filter.value.trim().toLocaleLowerCase())
const collapsed = ref(new Set<string>())
const error = ref('')
const editable = computed(() => store.treeLoaded && !store.loading && !store.treeSaving)
const canDrag = computed(() => editable.value && !keyword.value)
const dragSource = ref<HostTreeSource | null>(null)
const dropTarget = ref<HostTreeDropTarget | null>(null)
const folderDialogOpen = ref(false)
const editFolder = ref<HostTreeFolder | null>(null)
const connectedHostIds = computed(() => props.connectedHostIds)
// 分组尚未加载或旧 store 正在热更新时，仍显示已有主机，不能让目录元数据隐藏机器。
const treeItems = computed(() => normalizeHostTree({ version: 1, items: store.treeItems ?? [] }, store.hosts.map(host => host.id)))
watch(() => store.treeLoaded, loaded => {
  if (loaded === false && !store.loading) void store.fetchHosts().catch(() => { /* 错误由 store 展示。 */ })
}, { immediate: true })
interface TreeRow { item: HostTreeItem; host?: HostRecord; folderId: string | null; index: number; depth: number }
const rows = computed(() => {
  const hosts = new Map(store.hosts.map(host => [host.id, host]))
  const matches = (host?: HostRecord): boolean => !!host && `${host.name} ${host.host} ${host.username}`.toLocaleLowerCase().includes(keyword.value)
  const result: TreeRow[] = []
  treeItems.value.forEach((item, index) => {
    if (item.kind === 'host') {
      const host = hosts.get(item.id)
      if (matches(host)) result.push({ item, host, folderId: null, index, depth: 0 })
      return
    }
    const folderMatches = !!keyword.value && item.name.toLocaleLowerCase().includes(keyword.value)
    const children = item.hostIds.map((id, childIndex) => ({ id, childIndex, host: hosts.get(id) }))
      .filter(child => folderMatches || matches(child.host))
    if (keyword.value && !folderMatches && !children.length) return
    result.push({ item, folderId: null, index, depth: 0 })
    if (!collapsed.value.has(item.id) || keyword.value) for (const child of children) {
      result.push({ item: { kind: 'host', id: child.id }, host: child.host, folderId: item.id, index: child.childIndex, depth: 1 })
    }
  })
  return result
})
const visibleHostCount = computed(() => rows.value.filter(row => row.item.kind === 'host').length)
function rowKey(row: TreeRow): string { return `${row.item.kind}:${row.item.id}` }
function activate(row: TreeRow): void {
  if (dragSource.value) return
  if (row.item.kind === 'folder') {
    if (collapsed.value.has(row.item.id)) collapsed.value.delete(row.item.id)
    else collapsed.value.add(row.item.id)
  } else if (row.host) emit('connect', row.host)
}
function onContextMenu(event: MouseEvent, row: TreeRow): void {
  if (row.host) emit('context', event, row.host)
  else event.preventDefault()
}
function lineBefore(row: TreeRow): boolean {
  return !!dropTarget.value && !dropTarget.value.inside && dropTarget.value.folderId === row.folderId && dropTarget.value.index === row.index
}
function lineAfter(row: TreeRow): boolean {
  if (!dropTarget.value || dropTarget.value.inside || row.folderId === null || dropTarget.value.folderId !== row.folderId) return false
  const folder = treeItems.value.find(item => item.kind === 'folder' && item.id === row.folderId) as HostTreeFolder | undefined
  return !!folder && row.index === folder.hostIds.length - 1 && dropTarget.value.index === folder.hostIds.length
}
function onDragStart(event: DragEvent, row: TreeRow): void {
  if (!canDrag.value || (event.target as HTMLElement).closest('.row-actions')) { event.preventDefault(); return }
  dragSource.value = { kind: row.item.kind, id: row.item.id }
  error.value = ''
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', rowKey(row))
  }
}
function acceptDrag(event: DragEvent): boolean {
  if (!dragSource.value || !canDrag.value) return false
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  return true
}
function onDragOver(event: DragEvent, row: TreeRow): void {
  if (!acceptDrag(event) || !dragSource.value) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = (event.clientY - rect.top) / rect.height
  dropTarget.value = resolveHostTreeDropTarget(row, dragSource.value.kind, ratio)
}
function onEmptyFolderOver(event: DragEvent, folder: HostTreeFolder): void {
  if (!acceptDrag(event)) return
  dropTarget.value = dragSource.value?.kind === 'host' ? { folderId: folder.id, index: 0, inside: true } : null
}
function onRootEndOver(event: DragEvent): void {
  if (acceptDrag(event)) dropTarget.value = { folderId: null, index: treeItems.value.length, inside: false }
}
function onDragLeave(event: DragEvent): void {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) dropTarget.value = null
}
function clearDrag(): void { dragSource.value = null; dropTarget.value = null }
async function drop(event: DragEvent): Promise<void> {
  if (!acceptDrag(event)) return
  const source = dragSource.value
  const destination = dropTarget.value
  clearDrag()
  if (!source || !destination) return
  try {
    await store.moveTreeItem(source, destination)
    if (destination.folderId) collapsed.value.delete(destination.folderId)
  } catch (err) { error.value = err instanceof Error ? err.message : '排序失败，请重试。' }
}
async function deleteFolder(folder: HostTreeFolder): Promise<void> {
  if (!await confirm('删除文件夹', `删除「${folder.name}」？其中的主机会移回根列表，连接配置和主机均保留。`)) return
  try { await store.deleteFolder(folder.id) } catch (err) { error.value = err instanceof Error ? err.message : '删除文件夹失败。' }
}
async function retry(): Promise<void> {
  error.value = ''
  try { await store.fetchHosts() } catch { /* 错误由 store 展示。 */ }
}
</script>

<style scoped>
.direct-host-tree { display: flex; flex-direction: column; min-width: 0; }
.host-search { display: flex; align-items: center; gap: 8px; margin: 0 2px 10px; padding: 7px 10px; min-height: 34px; border: 1px solid var(--divider); border-radius: var(--radius-control); background: var(--surface); color: var(--text-tertiary); }
.host-search:focus-within { border-color: var(--accent); }
.host-search svg { flex-shrink: 0; }
.host-search input { min-width: 0; width: 100%; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 12px; }
.tree-row-wrap, .tree-root-end { position: relative; }
.tree-row-wrap.insert-before::before, .tree-row-wrap.insert-after::after, .tree-root-end.insert-before::before { content: ''; position: absolute; left: var(--indent, 10px); right: 8px; height: 2px; background: var(--accent); border-radius: 2px; z-index: 2; pointer-events: none; box-shadow: 0 0 4px color-mix(in srgb, var(--accent) 45%, transparent); }
.insert-before::before { top: 0; }
.insert-after::after { bottom: 0; }
.tree-row { position: relative; display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 8px 34px 8px 10px; border-radius: var(--radius-control); cursor: pointer; user-select: none; }
.tree-row.folder { min-height: 36px; padding-top: 7px; padding-bottom: 7px; padding-right: 50px; }
.tree-row:hover, .tree-row:focus-visible { background: var(--surface-alt, var(--hover-overlay)); }
.tree-row:focus-visible { outline: 1px solid var(--accent); }
.tree-row.active { background: var(--accent-muted); }
.tree-row.dragging { opacity: .45; }
.tree-row.folder-drop { background: var(--accent-muted); box-shadow: inset 0 0 0 1px var(--accent); }
.drag-handle { position: absolute; left: 0; opacity: 0; color: var(--text-tertiary); cursor: grab; }
.tree-row[draggable=true]:hover .drag-handle { opacity: 1; }
.folder-chevron { flex-shrink: 0; color: var(--text-tertiary); }
.folder-chevron.expanded { transform: rotate(90deg); }
.folder-icon { flex-shrink: 0; color: var(--accent); }
.folder-name, .host-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; color: var(--text-primary); }
.folder-name { flex: 1; min-width: 0; }
.folder-count { flex-shrink: 0; font-size: 11px; color: var(--text-tertiary); }
.connection-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: var(--text-disabled); }
.connection-dot.connected { background: var(--success); }
.host-info { min-width: 0; flex: 1; }
.host-detail { margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 11px var(--font-mono); color: var(--text-tertiary); }
.row-actions { position: absolute; right: 5px; top: 3px; display: flex; flex-direction: column; opacity: 0; pointer-events: none; }
.folder .row-actions { top: 6px; flex-direction: row; }
.tree-row:hover .row-actions, .tree-row:focus-within .row-actions { opacity: 1; pointer-events: auto; }
.row-action { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: 0; background: transparent; color: var(--text-tertiary); cursor: pointer; }
.row-action:hover { color: var(--accent); }
.row-action.danger:hover { color: var(--danger); }
.row-action:disabled { opacity: .5; cursor: default; }
.folder-empty { padding: 8px 10px 12px 46px; font-size: 11px; color: var(--text-tertiary); }
.tree-root-end { min-height: 24px; padding: 5px 10px; font-size: 10px; color: var(--text-tertiary); }
.placeholder { padding: 18px 8px; text-align: center; color: var(--text-tertiary); font-size: 12px; }
.empty-state button, .tree-error button { border: 1px solid var(--divider); border-radius: var(--radius-control); background: var(--surface-alt); color: var(--text-secondary); padding: 7px 10px; font: inherit; cursor: pointer; }
.empty-state button + button { margin-left: 8px; }
.host-count { padding: 8px 10px; font-size: 11px; color: var(--text-tertiary); }
.tree-error { padding: 8px; font-size: 12px; color: var(--danger); line-height: 1.6; }
.tree-error button { padding: 2px 6px; }
</style>
