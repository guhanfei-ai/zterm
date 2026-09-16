/**
 * Agent Graph — LangGraph StateGraph implementation.
 *
 * 2026-09-16 对话优先重构（作者决策：聊天一等公民，工具执行二等公民）：
 *
 *   START → reply → (route)
 *              ├─ 无 COMMAND（纯聊天 / 最终回复）      → END
 *              ├─ 首轮检查型请求且零命令               → repair_action_plan（强制取证）→ check_safety …
 *              ├─ 有 COMMAND（预算内）                → check_safety → execute → (route)
 *              └─ 有 COMMAND 但预算耗尽               → set_round_limit → END
 *
 *   execute → 队列未尽 → check_safety（连做）；队列尽 → reply（工具结果已回填对话）
 *
 * 与旧架构（think / check_safety / execute / analyze / summarize 流水线）的差异：
 *   - analyze_result 已删：命令输出作为工具回合追加进 conversationHistory，
 *     由 reply 主循环统一消化（每条命令省一次模型调用）。
 *   - summarize 已删：最后一次无命令回复即本轮结论（conclusion 持久化为该文本），
 *     不再二次调用模型生成正式任务报告。
 *   - 执行纪律保留为工具级约束：safetyGuard 逐命令检查、allowWrite 读写分级、
 *     首轮检查型请求强制取证（repair）、maxSteps 单轮工具调用预算。
 *     预算语义：maxSteps = 一次人类介入后无人值守状态下最多执行的命令轮数；
 *     人类每介入一次（新消息 / 续跑 / 恢复），turnStartStepCount 基准重算，
 *     预算从零重新计数（见 turnBudgetExhausted）。
 */
import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph'
import {
  AgentStateAnnotation,
  AgentGraphState,
  AgentGraphUpdate,
  StepRecord,
  GraphPhase,
  StopReason,
  SystemInfo,
  ChatTurn
} from './agentGraphState'
import {
  parseAIResponse,
  shouldRequireInspection,
  stripProtocolLines,
  TerminalContext
} from './agentGraphPrompt'
import { checkCommand } from './safetyGuard'
import { TerminalBridge, CommandResult } from './terminalBridge'
import { AiClient } from './aiClient'
import { ModelStreamSession } from '../harness/modelStreamSession'
import type { ModelRequest } from '../model/contracts'
import {
  projectReplyModelRequest,
  projectRepairPlanModelRequest
} from '../projection/agent/agentModelProjection'
import { STEP_TIMEOUT_MS, FALLBACK_COMMAND } from './agentGraphConfig'

// ---- Callbacks for side-effect emission (bridge to old IPC events) ----
export interface AgentGraphCallbacks {
  emitMessage: (msg: {
    type: string
    content: string
    stepNumber?: number
    details?: Record<string, unknown>
  }) => void
  emitStateChange: (phase: GraphPhase) => void
  getTerminalContext: (lines?: number) => TerminalContext | null
  onStepComplete: (data: {
    steps: StepRecord[]
    currentStep: number
    conclusion?: string
    stopReason?: StopReason
    systemInfo?: SystemInfo
    systemDetected?: boolean
  }) => void
}

// ---- Context injected at graph build time ----
export interface AgentGraphContext {
  bridge: TerminalBridge
  aiClient: AiClient
  callbacks: AgentGraphCallbacks
  abortController: AbortController
}

// ================================================================
//  Helpers
// ================================================================

function nowIso(): string {
  return new Date().toISOString()
}

/** conversationHistory 追加一回合（Annotation 为 last-value-wins，返回全新数组） */
function appendTurn(history: ChatTurn[], turn: ChatTurn): ChatTurn[] {
  return [...history, turn]
}

/**
 * 步骤快照 observation 的上限。
 * 完整输出存在 commandOutput 与工具回合里；steps 的 observation 只是审计摘要。
 */
function clampStepObservation(obs: string): string {
  return obs.length <= 400 ? obs : obs.slice(0, 400) + '…[已截断]'
}

/** 首轮 + 检查型请求 + 零命令 → 需要强制取证（repair）。
 *  reply 节点与 routeAfterReply 共用同一谓词，保证口径一致。 */
function needsForcedInspection(state: AgentGraphState): boolean {
  const businessSteps = state.steps.filter(s => s.stepNumber > 0).length
  if (businessSteps > 0) return false
  return shouldRequireInspection(state.userMessage || state.taskDescription)
}

/**
 * 单轮预算是否耗尽：本轮（自上次人类介入以来）已执行的命令轮数 >= maxSteps。
 *
 * - 基准 turnStartStepCount 在每次人类介入（startTask 新轮 / 续跑 / 恢复）时
 *   由 runtime 重算为当时已有的业务步骤数，因此预算随介入清零重记。
 * - currentStep 仍是全局单调递增的步骤编号（仅用于编号与审计），不参与预算比较。
 * - 拦截（blocked）的命令同样计入 steps，即同样消耗预算 —— 防止反复试错绕过限制。
 */
function turnBudgetExhausted(state: AgentGraphState): boolean {
  const base = state.turnStartStepCount ?? 0
  const used = state.steps.filter(s => s.stepNumber > 0).length - base
  return used >= state.maxSteps
}

// ================================================================
//  Helper: invoke AI model with streaming, emit thinking in real-time
// ================================================================
async function invokeModelWithStreaming(
  ctx: AgentGraphContext,
  request: ModelRequest,
  phase: string,
  stepNum: number
): Promise<string> {
  const { aiClient, callbacks, abortController } = ctx
  const signal = abortController.signal

  let result = ''
  let reasoning = ''
  const thinkingId = `thinking-${Date.now()}`
  const modelInvocationId = `agent-${phase}-${stepNum}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const streamSession = new ModelStreamSession(modelInvocationId)

  callbacks.emitMessage({
    type: 'thinking',
    content: '',
    details: { phase, thinkingId, modelInvocationId, streaming: true }
  })

  const onChunk = (chunk: { text?: string; reasoning?: string }): void => {
    if (chunk.text) result += chunk.text
    if (chunk.reasoning) {
      reasoning += chunk.reasoning
      callbacks.emitMessage({
        type: 'thinking',
        content: reasoning,
        details: { phase, thinkingId, modelInvocationId, streaming: true }
      })
    }
  }

  let rejectAbort: ((reason: Error) => void) | undefined
  const onAbort = (): void => {
    streamSession.abort()
    rejectAbort?.(new Error('已中止'))
  }

  try {
    const abortPromise = new Promise<never>((_, reject) => {
      rejectAbort = reject
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
    const runPromise = aiClient.sendStream(request, streamSession, onChunk)
    await Promise.race([runPromise, abortPromise])
  } finally {
    signal.removeEventListener('abort', onAbort)
    streamSession.active = false
  }

  if (signal.aborted) return ''

  if (reasoning.trim()) {
    callbacks.emitMessage({
      type: 'thinking',
      content: reasoning.trim(),
      details: { phase, thinkingId, modelInvocationId, streaming: false }
    })
  } else {
    callbacks.emitMessage({
      type: 'thinking',
      content: '',
      details: { phase, thinkingId, modelInvocationId, streaming: false, empty: true }
    })
  }

  return result || '(模型未返回内容)'
}

// ================================================================
//  Node implementations
// ================================================================

/**
 * reply 主节点 —— 对话循环的核心。
 *
 * 每次调用 = 一次"看全部上下文（对话 + 工具结果）→ 回话"：
 *   - 无 COMMAND：本轮自然收尾。本轮执行过命令 → completed（最终回复即结论，
 *     不再二次调模型生成报告）；纯聊天 → idle。
 *   - 有 COMMAND：边聊边干。自然语言先进聊天气泡，命令入队走
 *     check_safety → execute，观察结果回填对话后回到本节点。
 */
export function createReplyNode(ctx: AgentGraphContext) {
  return async (state: AgentGraphState): Promise<AgentGraphUpdate> => {
    if (state.aborted || ctx.abortController.signal.aborted) return { aborted: true, phase: 'stopped' }

    ctx.callbacks.emitStateChange('planning')

    const request = projectReplyModelRequest(
      state,
      state.userMessage || state.taskDescription,
      ctx.callbacks.getTerminalContext(200)
    )
    const text = await invokeModelWithStreaming(ctx, request, 'reply', state.currentStep + 1 || 1)
    if (ctx.abortController.signal.aborted) return { aborted: true, phase: 'stopped' }

    const parsed = parseAIResponse(text)
    const hasCommands = parsed.commands.length > 0

    // ---- 无命令：本轮自然收尾（纯聊天，或基于已有工具结果的最终回复） ----
    if (!hasCommands) {
      // 首轮 + 检查型请求的零命令回复（含模型旧习惯的 DONE）：不出结论气泡、
      // 不落完成态，交给 repair 强制取证（执行纪律优先于聊天）。
      if (needsForcedInspection(state)) {
        return { modelResponseText: text, pendingCommand: '', pendingCommands: [], phase: 'planning' }
      }

      // 模型可能仍按旧协议带 "DONE:" 前缀 —— 剥掉按普通回复处理
      const finalText = text.replace(/^DONE[:：]\s*/i, '').trim() || text
      ctx.callbacks.emitMessage({
        type: 'assistant_reply',
        content: finalText,
        details: { chatResponse: true }
      })
      const nextHistory = appendTurn(state.conversationHistory, {
        role: 'assistant',
        content: finalText,
        createdAt: nowIso()
      })

      // 本轮执行过命令 → 任务完成态；纯聊天 → idle。
      // 两种都持久化 COMPLETED，避免空闲监测把已收尾的 turn 误判成崩溃残留。
      const turnStart = state.turnStartStepCount ?? 0
      const doneThisTurn = state.steps.filter(s => s.stepNumber > turnStart && s.status === 'done').length
      const completed = doneThisTurn > 0

      try {
        ctx.callbacks.onStepComplete({
          steps: state.steps,
          currentStep: state.currentStep,
          conclusion: completed ? finalText : undefined,
          stopReason: 'COMPLETED'
        })
      } catch (persistErr) {
        // 若抛错，不得继续宣告"本轮完成"，转 failed（与旧 summarize 同款纪律）
        const reason = persistErr instanceof Error ? persistErr.message : String(persistErr)
        console.error('[agentGraph] 持久化 COMPLETED 失败，转 failed：', reason, persistErr)
        ctx.callbacks.emitStateChange('failed')
        return { phase: 'failed', stopReason: 'ERROR', conversationHistory: nextHistory, modelResponseText: text }
      }

      // 时序纪律（与旧 summarize 一致）：持久化 → 完成状态 → 完成文案
      ctx.callbacks.emitStateChange(completed ? 'completed' : 'idle')
      if (completed) {
        ctx.callbacks.emitMessage({ type: 'status', content: `本轮完成，共执行 ${doneThisTurn} 条命令` })
      }
      return {
        phase: completed ? 'completed' : 'idle',
        stopReason: 'COMPLETED',
        conclusion: completed ? finalText : state.conclusion,
        pendingCommand: '',
        pendingCommands: [],
        modelResponseText: text,
        conversationHistory: nextHistory
      }
    }

    // ---- 有命令：边聊边干 —— 自然语言部分先进聊天气泡并计入对话 ----
    const chatPart = stripProtocolLines(text)
    const historyWithChat = chatPart
      ? appendTurn(state.conversationHistory, {
          role: 'assistant',
          content: chatPart,
          isFromExecution: true,
          createdAt: nowIso()
        })
      : state.conversationHistory
    if (chatPart) {
      ctx.callbacks.emitMessage({
        type: 'assistant_reply',
        content: chatPart,
        details: { withCommands: true }
      })
    }

    // 每条命令的计划说明按未来步号（nextStep + 序号）预先展示
    const nextStep = state.currentStep + 1
    parsed.commands.forEach((c, idx) => {
      if (c.plan) {
        ctx.callbacks.emitMessage({ type: 'plan', content: c.plan, stepNumber: nextStep + idx })
      }
    })

    return {
      currentStep: nextStep,
      planText: parsed.commands[0].plan || chatPart || text,
      pendingCommand: parsed.commands[0].command,
      pendingCommands: parsed.commands,
      modelResponseText: text,
      safetyResult: null,
      phase: 'planning',
      conversationHistory: historyWithChat
    }
  }
}

/**
 * 强制执行修正节点（执行纪律：检查型请求必须先取证）。
 *
 * 触发条件（由 routeAfterReply 控制）：
 *   - 当前是首次真实交互（业务步骤数 == 0）
 *   - 用户请求被识别为"检查 / 观察 / 排查 / 状态"型
 *   - reply 首轮输出为零命令（聊天 / 直接给结论 / 旧习惯 DONE）
 *
 * 节点职责：
 *   - 不直接硬编码命令（避免变成命令模板机）
 *   - 重新调用模型一次，强提示"必须出 PLAN + COMMAND"
 *   - 模型仍不出命令时用最小兜底只读命令（FALLBACK_COMMAND）
 */
function createRepairActionPlanNode(ctx: AgentGraphContext) {
  return async (state: AgentGraphState): Promise<AgentGraphUpdate> => {
    if (state.aborted || ctx.abortController.signal.aborted) return { aborted: true, phase: 'stopped' }
    const { callbacks } = ctx

    callbacks.emitStateChange('planning')
    callbacks.emitMessage({ type: 'status', content: '正在补一条只读观察命令以获取证据...' })

    const request = projectRepairPlanModelRequest(
      state,
      state.userMessage || state.taskDescription,
      callbacks.getTerminalContext(200)
    )

    // repair 补出来的业务步骤必须进入标准编号（1, 2, 3...），
    // 否则下游仍会按 stepNumber > 0 误判成"首次交互"，反复触发 repair。
    const nextStep = state.currentStep + 1
    const text = await invokeModelWithStreaming(ctx, request, 'repair_plan', nextStep || 1)
    if (ctx.abortController.signal.aborted) return { aborted: true, phase: 'stopped' }

    const parsed = parseAIResponse(text)

    // 如果模型仍然不配合（DONE / 无命令），给一个最小兜底只读命令：
    // 只覆盖"看看机器在跑什么"这个最泛化场景，绝不扩成命令模板机。
    let fallbackCommand = ''
    if (parsed.done || !parsed.command) {
      fallbackCommand = FALLBACK_COMMAND
    }

    const hasCommand = !!parsed.command || !!fallbackCommand

    if (parsed.plan) {
      callbacks.emitMessage({
        type: 'plan',
        content: parsed.plan,
        stepNumber: nextStep
      })
    }

    if (!hasCommand) {
      // 双重兜底仍未拿到命令（极端情况）→ 走聊天收尾。
      // 同样持久化 COMPLETED，避免空闲监测误判恢复栏。
      callbacks.emitMessage({
        type: 'assistant_reply',
        content: text,
        details: { chatResponse: true, fromRepair: true }
      })
      callbacks.onStepComplete({
        steps: state.steps,
        currentStep: state.currentStep,
        stopReason: 'COMPLETED'
      })
      callbacks.emitStateChange('idle')
      return { phase: 'idle', modelResponseText: text, pendingCommand: '', pendingCommands: [] }
    }

    return {
      currentStep: nextStep,
      planText: parsed.plan || '补一条只读观察命令以获取证据',
      pendingCommand: parsed.command || fallbackCommand,
      pendingCommands: [{ plan: parsed.plan, command: parsed.command || fallbackCommand }],
      modelResponseText: text,
      safetyResult: null,
      phase: 'planning'
    }
  }
}

function createCheckSafetyNode(ctx: AgentGraphContext) {
  return async (state: AgentGraphState): Promise<AgentGraphUpdate> => {
    if (state.aborted || ctx.abortController.signal.aborted) return { aborted: true, phase: 'stopped' }
    const { callbacks } = ctx

    callbacks.emitStateChange('safety_check')

    const cmd = state.pendingCommand
    if (!cmd) {
      // 防御：reply 只在队列非空时路由到本节点；空命令直接作废队列回 reply
      return { pendingCommands: [] }
    }

    const safetyResult = checkCommand(cmd, state.allowWrite)

    if (safetyResult.blocked) {
      const blockReason = safetyResult.isUnknown
        ? `命令被拦截（未识别）：${safetyResult.reason || '未识别命令当前不允许执行'}`
        : safetyResult.isWrite
          ? `命令被拦截（写操作）：${(safetyResult.reason || '写操作').replace(/^写操作：/, '')}。如需执行此操作，请切换到写操作`
          : `命令被拦截：${safetyResult.reason || '安全策略拦截'}`

      callbacks.emitMessage({
        type: 'error',
        content: blockReason,
        stepNumber: state.currentStep,
        details: { category: safetyResult.category, command: cmd, isWrite: safetyResult.isWrite }
      })

      const step: StepRecord = {
        stepNumber: state.currentStep,
        plan: state.planText,
        command: cmd,
        observation: safetyResult.isWrite
          ? `被安全策略拦截（写操作）：${(safetyResult.reason || '写操作').replace(/^写操作：/, '')}`
          : `被安全策略拦截：${safetyResult.reason || '安全策略拦截'}`,
        safetyCheck: safetyResult,
        status: 'blocked'
      }

      // 拦截反馈作为工具回合进对话：下一轮 reply 能看到"为什么被拦"并调整方案
      const historyWithFeedback = appendTurn(state.conversationHistory, {
        role: 'tool',
        content: `${blockReason}。请调整命令或向用户说明。`,
        command: cmd,
        createdAt: nowIso()
      })

      callbacks.onStepComplete({
        steps: [...state.steps, step],
        currentStep: state.currentStep
      })
      // 被拦截后剩余命令队列整体作废，回 reply 基于反馈重新决策
      return {
        safetyResult,
        pendingCommand: '',
        pendingCommands: [],
        steps: [...state.steps, step],
        conversationHistory: historyWithFeedback
      }
    }

    // MVP（作者决策）：安全检查放行的命令直接执行，不再人工确认
    return {
      safetyResult
    }
  }
}

function createExecuteCommandNode(ctx: AgentGraphContext) {
  return async (state: AgentGraphState): Promise<AgentGraphUpdate> => {
    if (state.aborted || ctx.abortController.signal.aborted) return { aborted: true, phase: 'stopped' }
    const { bridge, callbacks, abortController } = ctx
    const signal = abortController.signal

    callbacks.emitStateChange('executing')

    const cmd = state.pendingCommand
    if (!cmd) return {}

    callbacks.emitMessage({
      type: 'execution',
      content: cmd,
      stepNumber: state.currentStep,
      details: { running: true }
    })

    const snapshot = bridge.getPreCommandSnapshot()
    bridge.writeCommand(cmd)

    let result: CommandResult
    try {
      result = await bridge.waitForResult(snapshot, STEP_TIMEOUT_MS, signal)
    } catch {
      result = { command: cmd, output: '(执行中断或超时)', duration: 0 }
    }

    if (signal.aborted) return { aborted: true, phase: 'stopped' }

    // 观察卡片（原始输出）—— 前端用它终结 execution 卡片的 running 态
    callbacks.emitMessage({
      type: 'observation',
      content: result.output,
      stepNumber: state.currentStep,
      details: { duration: result.duration, command: cmd }
    })

    // 工具回合进对话（对话优先：观察由 reply 主循环消化，不再单独调模型解释）
    const historyWithTool = appendTurn(state.conversationHistory, {
      role: 'tool',
      content: result.output,
      command: cmd,
      createdAt: nowIso()
    })

    // 记录执行步骤（持久化审计 / 恢复用；reply prompt 不再依赖 steps）
    const step: StepRecord = {
      stepNumber: state.currentStep,
      plan: state.planText,
      command: cmd,
      commandOutput: result.output,
      observation: clampStepObservation(result.output),
      status: 'done',
      duration: result.duration
    }
    const allSteps = [...state.steps, step]
    callbacks.onStepComplete({
      steps: allSteps,
      currentStep: state.currentStep
    })

    // 队列消费：还有预排命令 → 步号 +1 直接连下一条的安全检查（无需再调 reply）；
    // 队列空 → 回 reply 主循环（基于全部工具结果决定继续还是收尾）
    const remaining = (state.pendingCommands ?? []).slice(1)
    return {
      commandOutput: result.output,
      steps: allSteps,
      currentStep: remaining.length > 0 ? state.currentStep + 1 : state.currentStep,
      pendingCommands: remaining,
      pendingCommand: remaining[0]?.command ?? '',
      planText: remaining[0]?.plan || state.planText,
      conversationHistory: historyWithTool,
      safetyResult: null
    }
  }
}

// ================================================================
//  Routing functions (conditional edges)
// ================================================================

function routeAfterReply(state: AgentGraphState): string {
  if (state.aborted) return 'end'

  const hasCommands = (state.pendingCommands?.length ?? 0) > 0

  if (!hasCommands) {
    // 首轮 + 检查型请求 + 零命令 → 强制取证（与 reply 节点内的闸门同一谓词）
    if (needsForcedInspection(state)) return 'repair_action_plan'
    // 纯聊天 / 最终回复 → 本轮结束
    return 'end'
  }

  // 预算：本轮已执行轮数 >= maxSteps 即触顶（基准随人类介入重置，见 turnBudgetExhausted）
  if (turnBudgetExhausted(state)) return 'step_limit'
  return 'check_safety'
}

function routeAfterRepair(state: AgentGraphState): string {
  if (state.aborted) return 'end'
  // repair 节点如果还是没拿到命令 → 走聊天收尾
  if (!state.pendingCommand) return 'end'
  // 拿到命令 → 进入标准安全检查 / 执行流水线
  return 'check_safety'
}

function routeAfterSafety(state: AgentGraphState): string {
  if (state.aborted) return 'end'
  // 命令被拦截 → 反馈已回填对话，回 reply 重新决策（预算由 reply 路由把关）
  if (state.safetyResult?.blocked) return 'reply'
  // 防御：无命令不应到达这里（reply 只在队列非空时进入）
  if (!state.pendingCommand) return 'reply'
  // 放行 → 执行
  return 'execute_command'
}

function routeAfterExecute(state: AgentGraphState): string {
  if (state.aborted) return 'end'
  // 队列中还有预排命令 → 先看本轮预算再连做
  if ((state.pendingCommands ?? []).length > 0) {
    if (turnBudgetExhausted(state)) return 'step_limit'
    return 'check_safety'
  }
  // 队列耗尽 → 回 reply 主循环消化工具结果
  return 'reply'
}

// ================================================================
//  Graph factory
// ================================================================

export function buildAgentGraph(ctx: AgentGraphContext, checkpointer: MemorySaver) {
  // Register nodes (chain to accumulate node name types)
  const builder = new StateGraph(AgentStateAnnotation)
    .addNode('reply', createReplyNode(ctx))
    .addNode('repair_action_plan', createRepairActionPlanNode(ctx))
    .addNode('check_safety', createCheckSafetyNode(ctx))
    .addNode('execute_command', createExecuteCommandNode(ctx))
    .addNode('set_round_limit', async (state: AgentGraphState): Promise<AgentGraphUpdate> => {
      ctx.callbacks.emitStateChange('stepLimitReached')
      ctx.callbacks.emitMessage({
        type: 'status',
        content: `本轮 ${state.maxSteps} 步预算已用完：可点击“继续”重置预算继续执行，或直接发消息（同样会重置预算）`
      })
      ctx.callbacks.onStepComplete({
        steps: state.steps,
        currentStep: state.currentStep,
        stopReason: 'ROUND_LIMIT'
      })
      return { phase: 'stepLimitReached', stopReason: 'ROUND_LIMIT' }
    })

  // Edges
  builder
    .addEdge(START, 'reply')

  builder.addConditionalEdges('reply', routeAfterReply, {
    check_safety: 'check_safety',
    repair_action_plan: 'repair_action_plan',
    step_limit: 'set_round_limit',
    end: END                       // 纯聊天 / 最终回复 → 本轮结束
  })

  builder.addConditionalEdges('repair_action_plan', routeAfterRepair, {
    check_safety: 'check_safety',
    end: END
  })

  builder.addConditionalEdges('check_safety', routeAfterSafety, {
    execute_command: 'execute_command',
    reply: 'reply',                // 被拦截 → 反馈回填对话，重新决策
    end: END
  })

  builder.addConditionalEdges('execute_command', routeAfterExecute, {
    check_safety: 'check_safety',  // 队列中还有预排命令时直接消费
    reply: 'reply',                // 队列耗尽 → 回对话主循环
    step_limit: 'set_round_limit',
    end: END
  })

  builder.addEdge('set_round_limit', END)

  return builder.compile({ checkpointer })
}
