/**
 * Agent Graph Runtime — manages per-chat-tab graph instances and lifecycle.
 *
 * This is the bridge between the old IPC layer and the new LangGraph execution engine.
 * Each chatTabId gets its own:
 *   - Compiled graph instance
 *   - MemorySaver checkpointer (for step continuation)
 *   - AbortController (for stop)
 *   - Callbacks (for emitting messages back to frontend)
 */
import { MemorySaver, Command } from '@langchain/langgraph'
import {
  buildAgentGraph,
  AgentGraphCallbacks,
  AgentGraphContext
} from './agentGraph'
import {
  AgentGraphState,
  createInitialState,
  GraphPhase,
  StepRecord,
  StopReason,
  ChatTurn,
  KeyOutput
} from './agentGraphState'
import { TerminalBridge } from './terminalBridge'
import { AiClient } from './aiClient'

// ---- Per-tab runtime state ----
interface TabRuntime {
  checkpointer: MemorySaver
  abortController: AbortController
  graphCtx: AgentGraphContext
  compiledGraph: ReturnType<typeof buildAgentGraph>
  running: boolean
  /**
   * 该 tab 是否已被用户 stop。
   * stop 后禁止 resume/continueTask"复活"已中止的图（否则新 AbortController
   * 会清掉 abort 状态，已停止的任务可能继续执行写命令）；
   * 仅 reinitTab（新任务）会重置为 false。
   */
  stopped: boolean
  lastState: AgentGraphState | null
}

/**
 * Manages all graph runtime instances keyed by chatTabId.
 */
export class AgentGraphRuntime {
  private tabs = new Map<string, TabRuntime>()
  private aiClient: AiClient

  constructor(aiClient: AiClient) {
    this.aiClient = aiClient
  }

  /** Get or create a tab runtime */
  private getOrCreateTab(
    chatTabId: string,
    bridge: TerminalBridge,
    callbacks: AgentGraphCallbacks
  ): TabRuntime {
    let tab = this.tabs.get(chatTabId)
    if (!tab) {
      const abortController = new AbortController()
      const graphCtx: AgentGraphContext = {
        bridge,
        aiClient: this.aiClient,
        callbacks,
        abortController
      }
      const checkpointer = new MemorySaver()
      const compiledGraph = buildAgentGraph(graphCtx, checkpointer)

      tab = {
        checkpointer,
        abortController,
        graphCtx,
        compiledGraph,
        running: false,
        stopped: false,
        lastState: null
      }
      this.tabs.set(chatTabId, tab)
    } else {
      // Update bridge and callbacks for existing tab
      tab.graphCtx.bridge = bridge
      tab.graphCtx.callbacks = callbacks
    }
    return tab
  }

  /** Reinitialize a tab runtime (fresh graph, fresh checkpointer) */
  reinitTab(
    chatTabId: string,
    bridge: TerminalBridge,
    callbacks: AgentGraphCallbacks
  ): void {
    // Abort existing if running
    const existing = this.tabs.get(chatTabId)
    if (existing) {
      existing.abortController.abort()
      existing.running = false
    }

    const abortController = new AbortController()
    const graphCtx: AgentGraphContext = {
      bridge,
      aiClient: this.aiClient,
      callbacks,
      abortController
    }
    const checkpointer = new MemorySaver()
    const compiledGraph = buildAgentGraph(graphCtx, checkpointer)

    this.tabs.set(chatTabId, {
      checkpointer,
      abortController,
      graphCtx,
      compiledGraph,
      running: false,
      stopped: false,
      lastState: null
    })
  }

  /**
   * Start a new task on the graph.
   * Resets checkpointer and runs from scratch.
   */
  async startTask(
    chatTabId: string,
    taskDescription: string,
    maxSteps: number,
    bridge: TerminalBridge,
    callbacks: AgentGraphCallbacks,
    options?: {
      allowWrite?: boolean
      boundHost?: string
      // 历史对话（包含 user 与 assistant 发言），startTask 时灌入 graph state，
      // 让 think 节点能看到"上一轮助手说了什么"，实现自然追问
      conversationHistory?: ChatTurn[]
      // 当前轮用户发言；与稳定的 taskDescription 分离，避免追问覆盖任务目标。
      userMessage?: string
      taskId?: string
      recentKeyOutputs?: KeyOutput[]
      restoredState?: {
        currentStep: number
        steps: StepRecord[]
        systemDetected: boolean
        // 上一轮探测到的系统信息（follow-up turn 必须带回，否则 think 拿不到"上一步命令输出"以外的上下文）
        systemInfo?: AgentGraphState['systemInfo']
        recentKeyOutputs?: KeyOutput[]
        stopReason: StopReason
        phase: GraphPhase
      }
    }
  ): Promise<void> {
    // Reinitialize for a fresh task
    this.reinitTab(chatTabId, bridge, callbacks)
    const tab = this.tabs.get(chatTabId)!
    tab.running = true

    const initialState = createInitialState()
    initialState.taskId = options?.taskId ?? Date.now().toString()
    initialState.taskDescription = taskDescription
    initialState.userMessage = options?.userMessage ?? taskDescription
    initialState.chatTabId = chatTabId
    initialState.maxSteps = maxSteps
    initialState.allowWrite = options?.allowWrite ?? false
    initialState.boundHost = options?.boundHost ?? ''
    if (options?.conversationHistory) {
      initialState.conversationHistory = [...options.conversationHistory]
    }
    if (options?.recentKeyOutputs) {
      initialState.recentKeyOutputs = [...options.recentKeyOutputs]
    }

    // Restore graph state from persisted context (post-restart recovery)
    if (options?.restoredState) {
      const rs = options.restoredState
      initialState.currentStep = rs.currentStep
      initialState.steps = rs.steps
      initialState.systemDetected = rs.systemDetected
      if (rs.systemInfo) initialState.systemInfo = rs.systemInfo
      if (rs.recentKeyOutputs) initialState.recentKeyOutputs = [...rs.recentKeyOutputs]
      initialState.stopReason = rs.stopReason
      initialState.phase = rs.phase
    }

    // 记录本轮 turn 起始时已有的业务步骤数：
    // 新任务为 0；follow-up 等于旧任务步骤数。reply 收尾时据此区分
    // "本轮执行过命令 → completed"与"纯聊天 → idle"（详见 agentGraph.createReplyNode）
    initialState.turnStartStepCount = initialState.steps.filter(s => s.stepNumber > 0).length

    const config = {
      configurable: {
        thread_id: chatTabId
      },
      recursionLimit: Math.max(maxSteps * 6 + 30, 200),
      signal: tab.abortController.signal
    }

    try {
      await tab.compiledGraph.invoke(initialState, config)
    } catch (err) {
      if (tab.abortController.signal.aborted) {
        // Stopped by user — not an error
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      callbacks.emitMessage({ type: 'error', content: `执行失败：${msg}` })
      callbacks.emitStateChange('failed')
    } finally {
      tab.running = false
    }
  }

  /** Continue with additional steps after reaching step limit */
  async continueTask(
    chatTabId: string,
    additionalSteps: number
  ): Promise<void> {
    const tab = this.tabs.get(chatTabId)
    if (!tab) throw new Error('未找到 Agent 会话')
    // 已被用户 stop 的图禁止续跑复活（语义同 resume）
    if (tab.stopped) {
      throw new Error('任务已停止，无法续跑；请重新发起任务或续接上下文')
    }
    if (tab.running) {
      throw new Error('任务正在执行中，无法续跑')
    }

    tab.running = true
    try {
      // Reset abort controller for continued execution
      tab.graphCtx.abortController = new AbortController()
      tab.abortController = tab.graphCtx.abortController

      // Get current state from checkpoint
      const initialConfig = {
        configurable: {
          thread_id: chatTabId
        }
      }

      const snapshot = await tab.compiledGraph.getState(initialConfig)
      if (!snapshot || !snapshot.values) {
        throw new Error('无法恢复图状态')
      }

      const currentState = snapshot.values as AgentGraphState
      // 预算语义（2026-09-16）：点"继续"属于人类介入 —— 重置本轮预算基准，
      // 重新获得满额 additionalSteps 轮，而不是在旧 maxSteps 上累计追加。
      const turnBase = currentState.steps.filter(s => s.stepNumber > 0).length
      const newMaxSteps = additionalSteps

      // Resume with adequate recursion headroom (per-round jump budget)
      const config = {
        configurable: {
          thread_id: chatTabId
        },
        recursionLimit: Math.max(newMaxSteps * 6 + 30, 200),
        signal: tab.abortController.signal
      }

      tab.graphCtx.callbacks.emitMessage({
        type: 'status',
        content: `已重置本轮预算 ${additionalSteps} 步，继续执行`
      })

      // Reset turn budget baseline and resume（对话优先重构：续跑回到 reply 主循环）
      try {
        await tab.compiledGraph.invoke(
          new Command({
            resume: null,
            goto: ['reply'] as any,
            update: {
              maxSteps: newMaxSteps,
              turnStartStepCount: turnBase,
              aborted: false,
              stopReason: null
            } as any
          }) as any,
          config
        )
      } catch (err) {
        if (tab.abortController.signal.aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        tab.graphCtx.callbacks.emitMessage({ type: 'error', content: `续跑执行失败：${msg}` })
        tab.graphCtx.callbacks.emitStateChange('failed')
      }
    } finally {
      tab.running = false
    }
  }

  /** Stop a running graph */
  stop(chatTabId: string): void {
    const tab = this.tabs.get(chatTabId)
    if (!tab) return

    // 仅运行中才发射 stopped 状态与提示消息；空闲时（如 reset 调用）不应凭空多一条消息
    const wasRunning = tab.running
    tab.abortController.abort()
    tab.running = false
    // 标记已停止：阻止后续 resume/continueTask 复活已中止的图
    tab.stopped = true
    if (wasRunning) {
      tab.graphCtx.callbacks.emitStateChange('stopped')
      tab.graphCtx.callbacks.emitMessage({ type: 'status', content: '任务已被用户停止' })
    }
  }

  /** Get the current phase/state of a tab */
  isRunning(chatTabId: string): boolean {
    return this.tabs.get(chatTabId)?.running ?? false
  }

  /** Check if a tab runtime exists (may or may not be running) */
  hasTab(chatTabId: string): boolean {
    return this.tabs.has(chatTabId)
  }

  /** Remove a tab runtime */
  removeTab(chatTabId: string): void {
    const tab = this.tabs.get(chatTabId)
    if (tab) {
      tab.abortController.abort()
      this.tabs.delete(chatTabId)
    }
  }

  /** Update callbacks for a tab (e.g., when webContents changes) */
  updateCallbacks(chatTabId: string, callbacks: AgentGraphCallbacks): void {
    const tab = this.tabs.get(chatTabId)
    if (tab) {
      tab.graphCtx.callbacks = callbacks
    }
  }
}
