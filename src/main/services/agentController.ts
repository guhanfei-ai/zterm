/**
 * AgentController — thin adapter layer over LangGraph graph runtime.
 *
 * This class preserves the original public API (EventEmitter + method signatures)
 * so the IPC layer and frontend remain compatible.
 *
 * Internal execution is fully delegated to AgentGraphRuntime (LangGraph StateGraph).
 */
import { EventEmitter } from 'events'
import { AiClient, type ProviderConfig } from './aiClient'
import { TerminalBridge } from './terminalBridge'
import { AgentGraphRuntime } from './agentGraphRuntime'
import { AgentGraphCallbacks } from './agentGraph'
import { GraphPhase, StopReason } from './agentGraphState'
import type { SafetyCheck } from './safetyGuard'
import {
  saveContext,
  clearContext,
  loadContext,
  markStop,
  updateContext,
  getResumeType,
  appendChatTurn
} from './agentContextStore'
import type { AgentContextSnapshot, ContextChatTurn, ResumeType } from './agentContextStore'

// ---- Re-exported types (preserved for IPC / preload / frontend compat) ----

/** 读写模式开关操作的结构化返回结果 */
export interface SetAllowWriteResult {
  success: boolean
  error?: string
  allowWrite?: boolean
}

export type AgentState =
  | 'starting'
  | 'idle'
  | 'planning'
  | 'executing'
  | 'observing'
  | 'summarizing'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'stepLimitReached'

export interface AgentTask {
  id: string
  description: string
  createdAt: string
}

export interface AgentStep {
  stepNumber: number
  plan: string
  command?: string
  commandOutput?: string
  observation: string
  safetyCheck?: SafetyCheck
  status: 'pending' | 'executing' | 'done' | 'blocked' | 'skipped'
  startedAt?: string
  duration?: number
}

export interface AgentMessage {
  id: string
  type: 'plan' | 'execution' | 'observation' | 'conclusion' | 'thinking' | 'error' | 'status' | 'assistant_reply' | 'user_turn'
  stepNumber?: number
  content: string
  details?: Record<string, unknown>
  createdAt: string
}

export interface SystemInfo {
  kernel: string
  distroName: string
  distroVersion: string
  packageManager: string
  rawOutput: string
}

export interface AgentStatus {
  state: AgentState
  task?: AgentTask
  currentStep?: number
  maxSteps: number
  elapsedSteps: number
  allowWrite: boolean
  boundHost?: string
  boundTerminalTabId?: string | null
  steps: AgentStep[]
  error?: string
}

// ---- Phase → AgentState mapping ----
function phaseToAgentState(phase: GraphPhase): AgentState {
  switch (phase) {
    case 'idle': return 'idle'
    case 'probing': return 'executing'
    case 'planning': return 'planning'
    case 'safety_check': return 'planning'
    case 'executing': return 'executing'
    case 'observing': return 'observing'
    case 'summarizing': return 'summarizing'
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'stopped': return 'stopped'
    case 'stepLimitReached': return 'stepLimitReached'
    default: return 'idle'
  }
}

/**
 * Agent "任务终态"集合：进入后不再被中间态反向覆盖。
 * 注意：不含 `idle`——`idle` 表示"无任务"，允许被新任务主动推进覆盖。
 */
const AGENT_FINAL_STATES = new Set<AgentState>([
  'completed',
  'failed',
  'stopped',
  'stepLimitReached'
])

/**
 * 判断从 `current` 状态是否应允许 emit `next` 状态（纯函数，便于单测）。
 *
 * 收敛规则（保持停止优先级、避免重复或反向覆盖）：
 *   1. 用户主动停止（`stopped`）优先级最高：已 `stopped` 后不再被任何状态反向改写；
 *   2. 已是任务终态且新事件相同：不重复发送相同 `state-change` 事件；
 *   3. 已是任务终态（`completed` / `failed` / `stepLimitReached`）但新事件是中间态
 *      （`summarizing` / `planning` / `executing` / `observing` / `starting`）：
 *      不接受异步收尾的旧 phase 反向覆盖终态；
 *      `idle` 视为"无任务"态，允许被覆盖（用于主动重置场景）。
 *   4. 其余转换允许（含 `idle → planning`、`completed → idle` 等主动推进/重置场景）。
 *
 * 注意：本函数仅用于"异步完成态映射"路径（syncStateFromContext / startTask.then /
 * resumeFromContext.then）的收敛判断，**不**用于 graph 节点的 emitStateChange 回调——
 * 后者是主动推进状态，应允许 completed → planning 等合法转换。
 *
 * @param current Controller 当前已持有的状态
 * @param next    新到达的状态
 */
export function shouldEmitStateChange(
  current: AgentState,
  next: AgentState
): boolean {
  // 1) 停止优先级最高：已 stopped 不再被任何状态反向改写
  if (current === 'stopped') return false
  // 2) 已是任务终态且新事件相同：不重复发送
  if (current === next) return false
  // 3) 已是任务终态（completed / failed / stepLimitReached），
  //    新事件是中间态：不接受异步收尾的旧 phase 反向覆盖终态
  //    （idle 视为"无任务"态，允许被任何状态覆盖）
  if (
    AGENT_FINAL_STATES.has(current) &&
    next !== 'idle' &&
    !AGENT_FINAL_STATES.has(next)
  ) {
    return false
  }
  // 4) 其余转换允许
  return true
}

// ---- Controller ----
export class AgentController extends EventEmitter {
  private runtime: AgentGraphRuntime | null = null
  private bridge: TerminalBridge | null = null
  private config: ProviderConfig | null = null

  state: AgentState = 'idle'
  private task: AgentTask | null = null
  private steps: AgentStep[] = []
  // 单轮预算：一次人类介入后无人值守下最多执行的命令轮数（人类介入即重置）
  private maxSteps = 25
  private currentStep = 0
  // 本轮（自上次人类介入以来）开始时已有的业务步骤数，是预算计数的基准，
  // 同时用于 getStatus 的 elapsedSteps 展示（本轮 x / maxSteps 步）
  private turnStartStepCount = 0
  private allowWrite = false
  private boundHost: string | undefined = undefined
  private boundTerminalTabId: string | null = null

  private chatTabId: string | null = null
  private stopReason: StopReason = null

  init(aiClient: AiClient, bridge: TerminalBridge, config: ProviderConfig): void {
    // 显式释放旧 bridge（若有），避免反复 init 后旧引用长期存活
    if (this.bridge && this.bridge !== bridge) {
      this.bridge.dispose()
    }
    this.bridge = bridge
    this.config = config
    if (!this.runtime) {
      this.runtime = new AgentGraphRuntime(aiClient)
    }
  }

  /** Get the currently bound bridge (read-only, for diagnostics) */
  getBridge(): TerminalBridge | null {
    return this.bridge
  }

  /** Get the runtime instance (for resource cleanup in IPC layer) */
  getRuntime(): AgentGraphRuntime | null {
    return this.runtime
  }

  /** Inject an external runtime (used when sharing across tabs) */
  setRuntime(runtime: AgentGraphRuntime): void {
    this.runtime = runtime
  }

  setChatTabId(chatTabId: string | null): void {
    this.chatTabId = chatTabId
  }

  getChatTabId(): string | null {
    return this.chatTabId
  }

  getStopReason(): StopReason {
    return this.stopReason
  }

  readPersistedContext(): AgentContextSnapshot | null {
    if (!this.chatTabId) return null
    return loadContext(this.chatTabId)
  }

  getStatus(): AgentStatus {
    return {
      state: this.state,
      task: this.task || undefined,
      currentStep: this.currentStep,
      maxSteps: this.maxSteps,
      // 本轮已执行步数（自上次人类介入起算），与单轮预算 maxSteps 同口径展示
      elapsedSteps: Math.max(
        0,
        this.steps.filter(s => s.stepNumber > 0).length - this.turnStartStepCount
      ),
      allowWrite: this.allowWrite,
      boundHost: this.boundHost,
      boundTerminalTabId: this.boundTerminalTabId,
      steps: [...this.steps]
    }
  }

  // ---- Callbacks for graph → IPC event bridging ----
  private createCallbacks(): AgentGraphCallbacks {
    const self = this
    return {
      emitMessage(msg) {
        // 对话优先：assistant_reply 与工具回合（命令输出 / 拦截反馈）同步进
        // conversationHistory 并持久化，跨重启后 reply 主循环仍能接上上下文。
        if (self.chatTabId) {
          if (msg.type === 'assistant_reply') {
            const turn: ContextChatTurn = {
              role: 'assistant',
              content: msg.content,
              // 边聊边干场景：自然语言部分伴随命令一起输出，标记为执行相关回复
              isFromExecution: msg.details?.withCommands === true,
              createdAt: new Date().toISOString()
            }
            appendChatTurn(self.chatTabId, turn)
          } else if (
            (msg.type === 'observation' || msg.type === 'error') &&
            typeof msg.details?.command === 'string' &&
            msg.details.command
          ) {
            // 只有带 details.command 的消息才是工具回合（模型调用错误等不带）
            const toolTurn: ContextChatTurn = {
              role: 'tool',
              content: msg.content,
              command: msg.details.command,
              createdAt: new Date().toISOString()
            }
            appendChatTurn(self.chatTabId, toolTurn)
          }
        }
        const full: AgentMessage = {
          ...msg,
          type: msg.type as AgentMessage['type'],
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: new Date().toISOString()
        }
        self.emit('message', full)
      },
      emitStateChange(phase: GraphPhase) {
        const agentState = phaseToAgentState(phase)
        // 收敛规则：stopped 优先级最高，graph 内部回调不得把已停止的任务
        // 反向改写为中间/终态（如任务停止后异步收尾 emit executing/completed）。
        // 主动推进路径（startTask/continueTask/reset 等）直接设置 self.state，
        // 不经过本回调，不受影响。
        if (!shouldEmitStateChange(self.state, agentState)) return
        self.state = agentState
        self.emit('state-change', agentState)
      },
      getTerminalContext(lines = 200) {
        if (!self.bridge || !self.bridge.isConnected()) return null
        return self.bridge.getTerminalContext(lines)
      },
      onStepComplete(data) {
        // Sync local controller state
        self.steps = data.steps.map(s => ({
          stepNumber: s.stepNumber,
          plan: s.plan,
          command: s.command,
          commandOutput: s.commandOutput,
          observation: s.observation,
          safetyCheck: s.safetyCheck,
          status: s.status,
          startedAt: s.startedAt,
          duration: s.duration
        }))
        self.currentStep = data.currentStep

        // Update stop reason if provided
        if (data.stopReason) {
          self.stopReason = data.stopReason
        }

        // Persist to contextStore
        if (self.chatTabId) {
          // systemInfo / systemSummary 采用"保留式"写入：只有本次 onStepComplete
          // 显式带 data.systemInfo 时才覆盖；否则沿用持久化中已有的值。
          // 避免后续 analyze / execute / 总结 等不带系统信息的 onStepComplete 调用
          // 把 probe 阶段写入的完整结构化 systemInfo 覆盖成 undefined。
          const existing = loadContext(self.chatTabId)
          const nextSystemInfo: SystemInfo | undefined =
            data.systemInfo ?? existing?.systemInfo
          const nextSystemSummary: string | undefined =
            data.systemDetected && data.systemInfo
              ? `${data.systemInfo.distroName} ${data.systemInfo.distroVersion} (内核 ${data.systemInfo.kernel})`
              : existing?.systemSummary
          const nextKeyOutputs = data.steps
            .filter(s => !!s.commandOutput)
            .slice(-6)
            .map(s => ({
              stepNumber: s.stepNumber,
              command: s.command,
              output: (s.commandOutput || '').slice(0, 600)
            }))

          updateContext(self.chatTabId, {
            steps: data.steps.map(s => ({
              stepNumber: s.stepNumber,
              plan: s.plan,
              command: s.command,
              observation: s.observation,
              status: s.status,
              startedAt: s.startedAt,
              duration: s.duration
            })),
            currentStep: data.currentStep,
            maxSteps: self.maxSteps,
            recentKeyOutputs: nextKeyOutputs.length > 0 ? nextKeyOutputs : existing?.recentKeyOutputs,
            stopReason: data.stopReason ?? self.stopReason,
            systemInfo: nextSystemInfo,
            systemSummary: nextSystemSummary,
            lastConclusion: data.conclusion
          })
        }
      }
    }
  }

  // ---- Public API ----

  async startTask(description: string, maxSteps = 25, options?: { isNewTask?: boolean }): Promise<void> {
    // 允许从任意合法终态启动新任务；运行中（planning/executing/observing/summarizing）仍然拒绝
    // 'starting' 是 IPC handler 预设的乐观锁状态，此处不应拦截
    const terminalStates: AgentState[] = ['starting', 'idle', 'completed', 'failed', 'stopped', 'stepLimitReached']
    if (!terminalStates.includes(this.state)) {
      throw new Error('Agent 正忙，请等待当前任务完成或停止')
    }
    if (!this.config) throw new Error('模型未配置')
    if (!this.bridge || !this.bridge.isConnected()) throw new Error('终端未连接，请先连接到一台主机')
    if (!this.chatTabId) throw new Error('未绑定对话标签')
    if (!this.runtime) throw new Error('Agent 服务未初始化')

    // Auto-bind if needed
    if (!this.boundHost) this.bind()

    // 第二轮补丁：区分"开启新任务"与"普通 follow-up turn"
    // - isNewTask=true：主人明确要重开，stale steps/conclusion/systemSummary 全部清空
    // - isNewTask=false（默认）：保留执行上下文，只清掉 stopReason
    // 这样"执行后继续聊"不会因为 turn 重置而失忆。
    const isNewTask = options?.isNewTask === true

    if (isNewTask) {
      // 完整重置
      this.steps = []
      this.currentStep = 0
      this.stopReason = null
    } else {
      // 轻量重置：只清理 stopReason，保留 steps/currentStep 等执行上下文
      this.stopReason = null
    }
    // 普通追问属于同一 task；只有显式新任务才创建新的 taskId、目标和预算。
    // 第一轮收口：保留持久化但不再把 description 作为 UI 上的"任务目标"卡片发射。
    // conversationHistory 从持久化恢复（重启后能找回上文）；首次为空数组。
    const persisted = loadContext(this.chatTabId)
    const existingHistory = persisted?.conversationHistory ?? []
    const keepTask = !isNewTask && !!persisted?.taskDescription
    const taskCreatedAt = keepTask ? persisted!.createdAt : new Date().toISOString()
    const taskId = keepTask ? (persisted!.taskId || Date.now().toString()) : Date.now().toString()
    const taskDescription = keepTask ? persisted!.taskDescription : description
    this.task = { id: taskId, description: taskDescription, createdAt: taskCreatedAt }
    // 预算语义（2026-09-16）：maxSteps 是"单轮预算"——一次人类介入后无人值守状态下
    // 最多执行的命令轮数。人类每发一次消息即重置，预算恒为本次传入值（默认 25），
    // 不随任务生命周期累计（旧"触顶后追加"逻辑已随累计制一并移除）。
    this.maxSteps = maxSteps
    // 本轮基准：follow-up = 已有业务步骤数（预算从零重记）；新任务 = 0。
    // 重启场景下 controller 内存中的 currentStep 尚未恢复，以持久化值为准。
    const effectiveStep = keepTask ? Math.max(persisted!.currentStep ?? 0, this.currentStep) : this.currentStep
    this.turnStartStepCount = keepTask
      ? (persisted!.steps ?? []).filter(s => s.stepNumber > 0).length
      : 0

    if (isNewTask) {
      saveContext({
        chatTabId: this.chatTabId,
        taskId: this.task.id,
        taskDescription,
        createdAt: this.task.createdAt,
        updatedAt: this.task.createdAt,
        currentStep: 0,
        maxSteps: this.maxSteps,
        stopReason: null,
        steps: [],
        recentKeyOutputs: [],
        systemSummary: undefined,
        lastConclusion: undefined,
        allowWrite: this.allowWrite,
        boundHost: this.boundHost,
        conversationHistory: existingHistory
      })
    } else {
      // follow-up：保留持久化里的 steps / recentKeyOutputs / systemSummary / lastConclusion
      // （被 onStepComplete / recordStep / updateContext 持续写回的产物）
      saveContext({
        chatTabId: this.chatTabId,
        taskId: this.task.id,
        taskDescription,
        createdAt: this.task.createdAt,
        updatedAt: this.task.createdAt,
        currentStep: effectiveStep,
        maxSteps: this.maxSteps,
        stopReason: null,
        steps: persisted?.steps ?? [],
        recentKeyOutputs: persisted?.recentKeyOutputs ?? [],
        // follow-up 透传持久化系统信息（结构化 + 摘要），保证 follow-up 不会丢环境上下文
        systemInfo: persisted?.systemInfo,
        systemSummary: persisted?.systemSummary,
        lastConclusion: persisted?.lastConclusion,
        allowWrite: this.allowWrite,
        boundHost: this.boundHost,
        conversationHistory: existingHistory
      })
    }

    // 把本轮用户发言作为 user turn 推进历史并持久化
    const userTurn: ContextChatTurn = {
      role: 'user',
      content: description,
      createdAt: new Date().toISOString()
    }
    appendChatTurn(this.chatTabId, userTurn)
    const historyForGraph = [...existingHistory, userTurn]

    // 修正：删除原先的 type:'task' emit —— 不再把"用户发言"渲染成"任务目标"卡片。
    // 真正的时间线条目由前端 onStartAgent 推 user_turn 气泡、后端 graph 推 assistant_reply 气泡。

    // Fire graph execution (non-blocking — errors handled via callbacks)
    // 构造 restoredState：follow-up 时把上一轮的 steps / systemInfo / phase 带给 graph；
    // 真正的 graph 节点用 restoredState 中的当前值起算（runtime.startTask 内部写入 initialState）。
    // systemInfo 优先用持久化的结构化对象（旧文件只有 systemSummary 时退化为最小对象）
    const persistedSystemInfo: SystemInfo | undefined = persisted?.systemInfo
      ? {
          kernel: persisted.systemInfo.kernel,
          distroName: persisted.systemInfo.distroName,
          distroVersion: persisted.systemInfo.distroVersion,
          packageManager: persisted.systemInfo.packageManager,
          rawOutput: persisted.systemInfo.rawOutput
        }
      : persisted?.systemSummary
        ? { kernel: '', distroName: '', distroVersion: '', packageManager: '', rawOutput: persisted.systemSummary }
        : undefined
    const restoredState = isNewTask
      ? undefined
      : {
          currentStep: effectiveStep,
          steps: persisted?.steps ?? [],
          systemDetected: !!persistedSystemInfo,
          systemInfo: persistedSystemInfo,
          stopReason: null,
          phase: 'completed' as const
        }

    this.runtime.startTask(
      this.chatTabId,
      taskDescription,
      this.maxSteps,
      this.bridge,
      this.createCallbacks(),
      {
        allowWrite: this.allowWrite,
        boundHost: this.boundHost,
        conversationHistory: historyForGraph,
        userMessage: description,
        recentKeyOutputs: persisted?.recentKeyOutputs ?? [],
        restoredState
      }
    ).then(() => {
      // Sync local state from persisted context after completion
      this.syncStateFromContext()
      // 异步收尾的完成态映射：与 syncStateFromContext 共用同一套收敛规则，
      // 避免重复 emit completed，或把已 stopped 反向改写为 completed
      this.emitFinalStateFromStopReason()
    }).catch((err: Error) => {
      if (this.state === 'stopped') return
      this.stopReason = 'ERROR'
      if (this.chatTabId) markStop(this.chatTabId, 'ERROR')
      this.state = 'failed'
      this.emit('state-change', 'failed')
      this.emit('message', {
        id: `${Date.now()}`,
        type: 'error',
        content: `执行失败：${err.message}`,
        createdAt: new Date().toISOString()
      })
    })
  }

  stop(): void {
    this.stopReason = 'USER_INTERRUPT'
    if (this.chatTabId) markStop(this.chatTabId, 'USER_INTERRUPT')
    this.state = 'stopped'
    this.emit('state-change', 'stopped')

    if (this.chatTabId && this.runtime) {
      this.runtime.stop(this.chatTabId)
    }
  }

  reset(): void {
    if (this.chatTabId && this.runtime) {
      this.runtime.stop(this.chatTabId)
    }
    this.steps = []
    this.currentStep = 0
    this.turnStartStepCount = 0
    this.boundHost = undefined
    this.boundTerminalTabId = null
    this.stopReason = null
    this.state = 'idle'
    this.task = null
    this.emit('state-change', 'idle')
    if (this.chatTabId) clearContext(this.chatTabId)
  }

  fullReset(): void {
    this.reset()
    this.allowWrite = false
  }

  /**
   * 释放 controller 持有的运行时 / bridge 引用，用于应用退出时的对称清理。
   * 不会影响 in-flight 任务状态（任务已被 stop() 中止），仅清空引用。
   */
  dispose(): void {
    this.bridge = null
    this.config = null
    this.runtime = null
    this.task = null
    this.removeAllListeners()
  }

  async continueTask(additionalSteps = 25): Promise<void> {
    // After restart, state is 'idle' but contextStore may have recoverable context
    if (this.state === 'idle' && this.chatTabId) {
      const resumeType = getResumeType(this.chatTabId)
      if (resumeType === 'continue') {
        const ctx = loadContext(this.chatTabId)
        if (ctx) {
          await this.resumeFromContext(ctx, additionalSteps)
          return
        }
      }
      if (resumeType === 'replan') {
        const ctx = loadContext(this.chatTabId)
        if (ctx) {
          await this.resumeFromContext(ctx, additionalSteps)
          return
        }
      }
    }

    if (this.state !== 'stepLimitReached') {
      throw new Error('当前任务未到达步数上限，无需续跑')
    }
    if (!this.config) throw new Error('模型未配置')
    if (!this.bridge || !this.bridge.isConnected()) throw new Error('终端未连接')
    if (!this.chatTabId || !this.runtime) throw new Error('Agent 服务未初始化')

    // 点"继续"属于人类介入：预算重置为 additionalSteps，而不是累计追加。
    // 基准同步重算（runtime.continueTask 会把同一基准写入 graph state）。
    this.maxSteps = additionalSteps
    this.turnStartStepCount = this.steps.filter(s => s.stepNumber > 0).length
    this.stopReason = null
    this.state = 'planning'
    this.emit('state-change', 'planning')

    // Resume graph with additional steps
    try {
      await this.runtime.continueTask(this.chatTabId, additionalSteps)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.stopReason = 'ERROR'
      if (this.chatTabId) markStop(this.chatTabId, 'ERROR')
      this.state = 'failed'
      this.emit('state-change', 'failed')
      this.emit('message', {
        id: `${Date.now()}`,
        type: 'error',
        content: `续跑执行失败：${msg}`,
        createdAt: new Date().toISOString()
      })
    }
  }

  /**
   * Unified context recovery — handles all resume types after app restart.
   * - ROUND_LIMIT: 追加步数继续执行
   * - USER_INTERRUPT / ERROR / null: 基于历史步骤重新规划
   */
  private async resumeFromContext(
    ctx: AgentContextSnapshot,
    additionalSteps: number
  ): Promise<void> {
    if (!this.config) throw new Error('模型未配置')
    if (!this.bridge || !this.bridge.isConnected()) throw new Error('终端未连接')
    if (!this.chatTabId || !this.runtime) throw new Error('Agent 服务未初始化')

    const isContinue = ctx.stopReason === 'ROUND_LIMIT'
    // 预算语义（2026-09-16）：重启恢复同样属于人类介入 —— 无论 continue 还是 replan，
    // 本轮预算都重置为 additionalSteps（默认 25），不再在历史 maxSteps 上累计追加。
    const newMaxSteps = additionalSteps
    // 本轮基准 = 恢复时已有的业务步骤数；graph 侧 turnStartStepCount 由
    // runtime.startTask 以同一口径重算，预算从零重新计数。
    const turnBase = ctx.steps.filter(s => s.stepNumber > 0).length

    // Restore local controller state from persisted context
    this.task = {
      id: ctx.taskId || Date.now().toString(),
      description: ctx.taskDescription,
      createdAt: ctx.createdAt
    }
    this.steps = ctx.steps.map(s => ({
      stepNumber: s.stepNumber,
      plan: s.plan,
      command: s.command,
      observation: s.observation,
      status: s.status,
      startedAt: s.startedAt,
      duration: s.duration
    }))
    this.currentStep = ctx.currentStep
    this.maxSteps = newMaxSteps
    this.turnStartStepCount = turnBase
    this.allowWrite = ctx.allowWrite
    this.boundHost = ctx.boundHost
    this.stopReason = null
    this.state = 'planning'
    this.emit('state-change', 'planning')

    const resumeLabel = isContinue
      ? `从上次会话恢复，本轮预算重置为 ${additionalSteps} 步`
      : `基于上次 ${ctx.steps.length} 步历史重新规划（本轮预算 ${additionalSteps} 步）`

    this.emit('message', {
      id: `${Date.now()}`,
      type: 'status' as const,
      content: resumeLabel,
      createdAt: new Date().toISOString()
    })

    // Start a new graph with restored state from context
    // 把持久化的结构化 systemInfo 恢复给 graph（无 systemInfo 但有 systemSummary 时退化为最小对象）
    const ctxSystemInfo: SystemInfo | undefined = ctx.systemInfo
      ? {
          kernel: ctx.systemInfo.kernel,
          distroName: ctx.systemInfo.distroName,
          distroVersion: ctx.systemInfo.distroVersion,
          packageManager: ctx.systemInfo.packageManager,
          rawOutput: ctx.systemInfo.rawOutput
        }
      : ctx.systemSummary
        ? { kernel: '', distroName: '', distroVersion: '', packageManager: '', rawOutput: ctx.systemSummary }
        : undefined

    const callbacks = this.createCallbacks()
    await this.runtime.startTask(
      this.chatTabId,
      ctx.taskDescription,
      newMaxSteps,
      this.bridge,
      callbacks,
      {
        allowWrite: ctx.allowWrite,
        boundHost: ctx.boundHost,
        taskId: ctx.taskId || undefined,
        userMessage: '',
        recentKeyOutputs: ctx.recentKeyOutputs ?? [],
        // 续接时也把对话历史带回（含工具回合），让 reply 主循环能看到"上次问过什么"
        conversationHistory: ctx.conversationHistory ?? [],
        // Restore graph state from persisted context
        restoredState: {
          currentStep: ctx.currentStep,
          steps: ctx.steps.map(s => ({
            stepNumber: s.stepNumber,
            plan: s.plan,
            command: s.command,
            observation: s.observation,
            status: s.status,
            startedAt: s.startedAt,
            duration: s.duration
          })),
          systemDetected: !!ctxSystemInfo,
          systemInfo: ctxSystemInfo,
          recentKeyOutputs: ctx.recentKeyOutputs ?? [],
          stopReason: null,
          phase: 'planning' as const
        }
      }
    ).then(() => {
      this.syncStateFromContext()
      // 异步收尾的完成态映射：与 syncStateFromContext 共用同一套收敛规则，
      // 避免重复 emit completed，或把已 stopped 反向改写为 completed
      this.emitFinalStateFromStopReason()
    }).catch((err: Error) => {
      this.stopReason = 'ERROR'
      if (this.chatTabId) markStop(this.chatTabId!, 'ERROR')
      this.state = 'failed'
      this.emit('state-change', 'failed')
      this.emit('message', {
        id: `${Date.now()}`,
        type: 'error',
        content: `恢复执行失败：${err.message}`,
        createdAt: new Date().toISOString()
      })
    })
  }

  setAllowWrite(v: boolean): SetAllowWriteResult {
    this.allowWrite = v
    return {
      success: true,
      allowWrite: this.allowWrite
    }
  }

  bind(): string | null {
    const isConnected = this.bridge?.isConnected() ?? false
    if (isConnected) {
      const identity = this.bridge?.getDisplayIdentity()
      if (identity) {
        this.boundHost = identity.displayDetail
        return this.boundHost
      }
    }
    this.boundHost = undefined
    return null
  }

  clearBinding(): void {
    if (this.boundHost !== undefined) {
      this.boundHost = undefined
    }
    this.boundTerminalTabId = null
  }

  setBoundHost(host: string | undefined): void {
    this.boundHost = host
  }

  setBoundTerminalTabId(tabId: string | null): void {
    this.boundTerminalTabId = tabId
  }

  /** Sync local controller state from persisted context (called after graph completion) */
  private syncStateFromContext(): void {
    if (!this.chatTabId) return
    const ctx = loadContext(this.chatTabId)
    if (!ctx) return

    this.currentStep = ctx.currentStep
    this.steps = ctx.steps.map(s => ({
      stepNumber: s.stepNumber,
      plan: s.plan,
      command: s.command,
      observation: s.observation,
      status: s.status,
      startedAt: s.startedAt,
      duration: s.duration
    }))

    if (ctx.stopReason) {
      this.stopReason = ctx.stopReason
      // 按 shouldEmitStateChange 收敛规则 emit 终态：
      // 避免重复 emit completed，或把已 stopped 反向改写为 completed
      this.emitFinalStateFromStopReason()
    }
  }

  /**
   * 在异步收尾（runtime.startTask Promise resolve 后）调用：
   * 根据当前 stopReason 把 Controller 状态映射到对应终态，并按收敛规则 emit。
   * - 已是 stopped：保持，不被反向改写；
   * - 已是目标终态且 mapped 相同：不重复 emit；
   * - 已是终态但 mapped 是中间态：不接受反向覆盖；
   * - 否则更新 this.state 并 emit mapped。
   */
  private emitFinalStateFromStopReason(): void {
    const stateMap: Record<string, AgentState> = {
      COMPLETED: 'completed',
      ROUND_LIMIT: 'stepLimitReached',
      USER_INTERRUPT: 'stopped',
      ERROR: 'failed'
    }
    const mapped = stateMap[this.stopReason || '']
    if (!mapped) return
    if (!shouldEmitStateChange(this.state, mapped)) return
    this.state = mapped
    this.emit('state-change', mapped)
  }
}
