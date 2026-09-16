import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, copyFileSync } from 'fs'
import { getDataPath } from './dataPath'

// 恢复类型 — 明确表达后端真实支持的能力
export type ResumeType = 'continue' | 'replan' | 'none'

// 停止原因标记 — 与 Plan 中 REQ-2/3/4 对应
export type StopReason = 'ROUND_LIMIT' | 'USER_INTERRUPT' | 'ERROR' | 'COMPLETED' | null

// 单步的精简快照（避免持久化整段 thinking 文本，节省存储）
export interface ContextStepSnapshot {
  stepNumber: number
  plan: string
  command?: string
  observation: string
  status: 'pending' | 'executing' | 'done' | 'blocked' | 'skipped'
  startedAt?: string
  duration?: number
}

// 单条自然对话回合（持久化版本，与 graph state 的 ChatTurn 字段语义一致）。
// 2026-09-16 对话优先重构：新增 tool 角色（命令输出 / 拦截反馈），
// conversationHistory 成为 reply 主循环的跨重启上下文。
export interface ContextChatTurn {
  role: 'user' | 'assistant' | 'tool'
  content: string
  // tool 角色的来源命令（用户/助手角色无意义）
  command?: string
  isFromExecution?: boolean
  createdAt: string
}

// 持久化版本的 SystemInfo（与 agentGraphState.SystemInfo 字段一致；单独定义避免主进程渲染层耦合）
export interface ContextSystemInfo {
  kernel: string
  distroName: string
  distroVersion: string
  packageManager: string
  rawOutput: string
}

// 持久化的 Agent 任务上下文 — 按 chatTabId 维度隔离（不跨对话框共享）
export interface AgentContextSnapshot {
  chatTabId: string
  taskId: string | null
  taskDescription: string
  createdAt: string
  updatedAt: string
  // 当前累计轮次
  currentStep: number
  maxSteps: number
  // 停止原因（null 表示任务进行中或无停止）
  stopReason: StopReason
  stoppedAt?: string
  // 已完成 / 阻塞 / 跳过的步骤精简快照
  steps: ContextStepSnapshot[]
  // 最近一次成功的关键命令输出片段（按 step 截断，限制总大小）
  recentKeyOutputs: Array<{ stepNumber: number; command?: string; output: string }>
  // 已探测系统的结构化快照（重启 follow-up 时带回 graph state）
  systemInfo?: ContextSystemInfo
  // 系统探测摘要（人类可读短串）—— 保留为兼容旧持久化文件与 UI 摘要读取
  systemSummary?: string
  // 已落盘的最新结论（如果有）
  lastConclusion?: string
  // 当前配置快照（用于续接时保持环境一致）
  allowWrite: boolean
  boundHost?: string
  // 自然对话历史（轻量持久化），让"重启后继续追问"能找回上文
  conversationHistory?: ContextChatTurn[]
}

const RECENT_OUTPUTS_MAX = 6
const OUTPUT_TRUNCATE_CHARS = 600
const STEPS_MAX = 50
const CHAT_HISTORY_MAX = 40   // 最多保留 40 条对话回合（含工具回合），控制文件大小
/** 工具回合（命令输出）内容的持久化上限 —— 输出可能很长，落盘前截断 */
const TOOL_TURN_TRUNCATE_CHARS = 2000

function nowIso(): string {
  return new Date().toISOString()
}

function truncate(text: string, max: number): string {
  if (!text) return ''
  if (text.length <= max) return text
  return text.slice(0, max) + '…[已截断]'
}

function clampSteps(steps: ContextStepSnapshot[]): ContextStepSnapshot[] {
  if (steps.length <= STEPS_MAX) return steps
  return steps.slice(steps.length - STEPS_MAX)
}

function clampOutputs(outputs: AgentContextSnapshot['recentKeyOutputs']): AgentContextSnapshot['recentKeyOutputs'] {
  if (outputs.length <= RECENT_OUTPUTS_MAX) return outputs
  return outputs.slice(outputs.length - RECENT_OUTPUTS_MAX)
}

function clampChatHistory(turns: ContextChatTurn[] | undefined): ContextChatTurn[] {
  if (!turns || turns.length === 0) return []
  if (turns.length <= CHAT_HISTORY_MAX) return turns
  return turns.slice(turns.length - CHAT_HISTORY_MAX)
}

function getContextFilePath(): string {
  const dir = getDataPath('agent-contexts')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return join(dir, 'contexts.json')
}

function getLastActiveTabFilePath(): string {
  const dir = getDataPath('agent-contexts')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return join(dir, 'last_active_tab')
}

/** 记录用户实际停留的 Agent 对话标签 — 由渲染进程 tab 切换时通过 IPC 调用，确保语义为"最后活跃"而非"最后写盘" */
export function saveLastActiveChatTabId(chatTabId: string): void {
  if (!chatTabId) return
  try {
    writeFileSync(getLastActiveTabFilePath(), chatTabId, 'utf-8')
  } catch {
    /* 写入失败不影响主流程，最多让重启后认领退化为手动 */
  }
}

/** 读取重启前最后活跃的 Agent 对话标签 ID */
function loadLastActiveChatTabId(): string | null {
  try {
    const p = getLastActiveTabFilePath()
    if (!existsSync(p)) return null
    const raw = readFileSync(p, 'utf-8').trim()
    return raw || null
  } catch {
    return null
  }
}

/**
 * 将旧位置的 agent 上下文迁移到 ~/.zterm/agent-contexts/。
 * 仅在 ~/.zterm/agent-contexts/contexts.json 不存在且旧位置存在时执行一次性迁移。
 */
function migrateLegacyContexts(): void {
  const newPath = getContextFilePath()
  if (existsSync(newPath)) return

  const oldPath = join(app.getPath('userData'), 'agent-contexts', 'contexts.json')
  if (!existsSync(oldPath)) return

  try {
    // 确保新目录存在（getContextFilePath 已做，但显式调用更清晰）
    const newDir = getDataPath('agent-contexts')
    if (!existsSync(newDir)) mkdirSync(newDir, { recursive: true })
    copyFileSync(oldPath, newPath)
    const bakPath = `${oldPath}.bak`
    try { renameSync(oldPath, bakPath) } catch { /* 重命名失败不影响功能 */ }
  } catch (err) {
    console.error('[agentContextStore] 迁移旧上下文失败：', err)
  }
}

let contextMigrationDone = false

function safeReadAll(): Record<string, AgentContextSnapshot> {
  // 首次读取前执行一次性迁移
  if (!contextMigrationDone) {
    contextMigrationDone = true
    migrateLegacyContexts()
  }

  const p = getContextFilePath()
  if (!existsSync(p)) {
    // 主文件不存在时尝试恢复遗留的 .tmp（rename 失败时可能残留）
    const tmp = `${p}.tmp`
    if (existsSync(tmp)) {
      try {
        const raw = readFileSync(tmp, 'utf-8')
        if (raw.trim()) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, AgentContextSnapshot>
          }
        }
      } catch {
        // tmp 损坏也不影响主流程
      }
    }
    return {}
  }
  try {
    const raw = readFileSync(p, 'utf-8')
    if (!raw.trim()) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, AgentContextSnapshot>
    }
    return {}
  } catch {
    // 文件损坏时降级为空，不影响主流程
    return {}
  }
}

function safeWriteAll(map: Record<string, AgentContextSnapshot>): void {
  const p = getContextFilePath()
  const tmp = `${p}.tmp`
  const serialized = JSON.stringify(map, null, 2)
  try {
    // 1. 写 tmp
    writeFileSync(tmp, serialized, 'utf-8')
    // 2. 原子 rename 替换主文件（POSIX 语义：崩溃时只可能看到旧文件或新文件，不会有半截文件）
    renameSync(tmp, p)
  } catch (err) {
    // 持久化失败不应该让 Agent 崩溃；只把错误冒到 console
    console.error('[agentContextStore] persist failed:', err)
    // 清理可能残留的 tmp，避免下次启动误读
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* ignore */ }
  }
}

// ---- 公共 API ----

/** 读取某个 chatTabId 的完整上下文；若不存在返回 null */
export function loadContext(chatTabId: string): AgentContextSnapshot | null {
  if (!chatTabId) return null
  const all = safeReadAll()
  return all[chatTabId] || null
}

/**
 * 认领孤儿上下文：应用重启后 renderer chatTabId 已更新，
 * 磁盘上的上下文按旧 UUID 存储。
 *
 * 归属约束：
 * - 必须有重启前持久化的「最后活跃标签 ID」记录
 * - 只认领该特定 ID 对应的未完成任务
 * - 不匹配/不存在/已完成 → 返回 null（不允许猜、不允许串任务）
 *
 * 返回认领后的上下文，归属不明确时返回 null。
 */
export function adoptOrphanedContext(newChatTabId: string): AgentContextSnapshot | null {
  if (!newChatTabId) return null

  // 读取重启前最后活跃的标签 ID，作为归属判断依据
  const lastActiveId = loadLastActiveChatTabId()
  if (!lastActiveId || lastActiveId === newChatTabId) return null

  const all = safeReadAll()
  const ctx = all[lastActiveId]
  if (!ctx || !ctx.taskDescription) return null
  if (ctx.stopReason === 'COMPLETED') return null

  // 归属明确：重新映射到当前新 chatTabId
  delete all[lastActiveId]
  const adopted: AgentContextSnapshot = {
    ...ctx,
    chatTabId: newChatTabId,
    updatedAt: nowIso()
  }
  all[newChatTabId] = adopted
  safeWriteAll(all)
  return adopted
}

/** 读取全部上下文（用于启动时初始化） */
export function loadAllContexts(): Record<string, AgentContextSnapshot> {
  return safeReadAll()
}

/**
 * 获取上下文的恢复类型 — 表达后端真实可恢复能力。
 * - 'continue': 可追加步数继续执行 (ROUND_LIMIT)
 * - 'replan': 可基于历史步骤重新规划 (USER_INTERRUPT, ERROR, null/崩溃)
 * - 'none': 不可恢复 (COMPLETED 或无上下文)
 */
export function getResumeType(chatTabId: string): ResumeType {
  const ctx = loadContext(chatTabId)
  if (!ctx || !ctx.taskDescription) return 'none'
  if (ctx.stopReason === 'COMPLETED') return 'none'
  if (ctx.stopReason === 'ROUND_LIMIT') return 'continue'
  // USER_INTERRUPT, ERROR, null (crashed) → 基于历史重规划
  return 'replan'
}

/** 判断是否存在未完成（可续接）的上下文 — 仅当后端真能恢复时返回 true */
export function hasPendingContext(chatTabId: string): boolean {
  return getResumeType(chatTabId) !== 'none'
}

/** 写入（或覆盖）某个 chatTabId 的上下文 */
export function saveContext(snapshot: AgentContextSnapshot): void {
  if (!snapshot.chatTabId) return
  const all = safeReadAll()
  all[snapshot.chatTabId] = {
    ...snapshot,
    steps: clampSteps(snapshot.steps || []),
    recentKeyOutputs: clampOutputs(snapshot.recentKeyOutputs || []),
    conversationHistory: clampChatHistory(snapshot.conversationHistory),
    updatedAt: nowIso()
  }
  safeWriteAll(all)
}

/** 部分更新：合并新字段到现有上下文 */
export function updateContext(chatTabId: string, patch: Partial<AgentContextSnapshot>): AgentContextSnapshot | null {
  if (!chatTabId) return null
  const all = safeReadAll()
  const existing = all[chatTabId]
  if (!existing) {
    // 没有现成上下文时，必须有最小必填字段
    if (!patch.chatTabId || !patch.taskDescription) return null
    const created: AgentContextSnapshot = {
      chatTabId,
      taskId: patch.taskId || null,
      taskDescription: patch.taskDescription,
      createdAt: patch.createdAt || nowIso(),
      updatedAt: nowIso(),
      currentStep: patch.currentStep || 0,
      maxSteps: patch.maxSteps || 25,
      stopReason: patch.stopReason ?? null,
      stoppedAt: patch.stoppedAt,
      steps: patch.steps || [],
      recentKeyOutputs: patch.recentKeyOutputs || [],
      systemInfo: patch.systemInfo,
      systemSummary: patch.systemSummary,
      lastConclusion: patch.lastConclusion,
      allowWrite: patch.allowWrite ?? false,
      boundHost: patch.boundHost,
      conversationHistory: clampChatHistory(patch.conversationHistory)
    }
    all[chatTabId] = created
    safeWriteAll(all)
    return created
  }
  // patch 中显式 undefined 的键不参与合并，避免覆盖已持久化值（如非 summarize 节点的 lastConclusion）
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  ) as Partial<AgentContextSnapshot>
  const merged: AgentContextSnapshot = {
    ...existing,
    ...definedPatch,
    chatTabId,
    steps: clampSteps(definedPatch.steps || existing.steps || []),
    recentKeyOutputs: clampOutputs(definedPatch.recentKeyOutputs || existing.recentKeyOutputs || []),
    conversationHistory: clampChatHistory(definedPatch.conversationHistory ?? existing.conversationHistory ?? []),
    updatedAt: nowIso()
  }
  all[chatTabId] = merged
  safeWriteAll(all)
  return merged
}

/** 记录一个步骤到上下文（在轮次执行完成后调用） */
export function recordStep(chatTabId: string, step: ContextStepSnapshot, keyOutput?: { command?: string; output: string }): void {
  if (!chatTabId) return
  const all = safeReadAll()
  const existing = all[chatTabId]
  if (!existing) return
  const steps = [...(existing.steps || []), step]
  const recentKeyOutputs = keyOutput
    ? [...(existing.recentKeyOutputs || []), { stepNumber: step.stepNumber, command: keyOutput.command, output: truncate(keyOutput.output, OUTPUT_TRUNCATE_CHARS) }]
    : existing.recentKeyOutputs || []
  all[chatTabId] = {
    ...existing,
    steps: clampSteps(steps),
    recentKeyOutputs: clampOutputs(recentKeyOutputs),
    currentStep: Math.max(existing.currentStep || 0, step.stepNumber),
    updatedAt: nowIso()
  }
  safeWriteAll(all)
}

/** 标记停止原因（同时写入 stoppedAt） */
export function markStop(chatTabId: string, reason: Exclude<StopReason, null>): void {
  if (!chatTabId) return
  const all = safeReadAll()
  const existing = all[chatTabId]
  if (!existing) return
  all[chatTabId] = {
    ...existing,
    stopReason: reason,
    stoppedAt: nowIso(),
    updatedAt: nowIso()
  }
  safeWriteAll(all)
}

/**
 * 追加一条对话回合（用户 / 助手 / 工具）到上下文末尾。
 * 工具回合（命令输出 / 拦截反馈）内容超长时先截断，避免撑爆 contexts.json。
 * 不存在上下文时静默忽略——startTask 会先建好快照。
 */
export function appendChatTurn(chatTabId: string, turn: ContextChatTurn): void {
  if (!chatTabId) return
  const all = safeReadAll()
  const existing = all[chatTabId]
  if (!existing) return
  const clampedTurn: ContextChatTurn = turn.role === 'tool'
    ? { ...turn, content: truncate(turn.content, TOOL_TURN_TRUNCATE_CHARS) }
    : turn
  const next = [...(existing.conversationHistory || []), clampedTurn]
  all[chatTabId] = {
    ...existing,
    conversationHistory: clampChatHistory(next),
    updatedAt: nowIso()
  }
  safeWriteAll(all)
}

/** 清除某个 chatTabId 的上下文（主人明确开启新任务时调用） */
export function clearContext(chatTabId: string): void {
  if (!chatTabId) return
  const all = safeReadAll()
  if (chatTabId in all) {
    delete all[chatTabId]
    safeWriteAll(all)
  }
}
