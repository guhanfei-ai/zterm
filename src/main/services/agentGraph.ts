/**
 * Agent Graph — LangGraph StateGraph implementation.
 *
 * Replaces the old AgentController.runLoop() with a standard graph orchestration:
 *   START → probe_system → plan_step → (route) → check_safety → (route) →
 *   [confirm_command | execute_command] → analyze_result → (route) → plan_step | summarize → END
 */
import { StateGraph, START, END, interrupt, MemorySaver } from '@langchain/langgraph'
import {
  AgentStateAnnotation,
  AgentGraphState,
  AgentGraphUpdate,
  StepRecord,
  GraphPhase,
  StopReason,
  SystemInfo
} from './agentGraphState'
import {
  parseAIResponse,
  parseSystemInfo,
  shouldRequireInspection,
  TerminalContext
} from './agentGraphPrompt'
import { checkCommand, SafetyCheck } from './safetyGuard'
import { TerminalBridge, CommandResult } from './terminalBridge'
import { AiClient } from './aiClient'
import { ModelStreamSession } from '../harness/modelStreamSession'
import type { ModelRequest } from '../model/contracts'
import {
  projectObservationModelRequest,
  projectRepairPlanModelRequest,
  projectSummaryModelRequest,
  projectThinkModelRequest
} from '../projection/agent/agentModelProjection'
import {
  STEP_TIMEOUT_MS,
  SUMMARY_TIMEOUT_MS,
  FALLBACK_COMMAND,
  MAX_OBS_LEN,
  OBS_HEAD,
  OBS_TAIL
} from './agentGraphConfig'

// ---- Callbacks for side-effect emission (bridge to old IPC events) ----
export interface AgentGraphCallbacks {
  emitMessage: (msg: {
    type: string
    content: string
    stepNumber?: number
    details?: Record<string, unknown>
  }) => void
  emitStateChange: (phase: GraphPhase) => void
  emitConfirmRequest: (data: { message: string; pendingCommand: string }) => void
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
//  Helper: invoke AI model with streaming, emit thinking in real-time
// ================================================================
async function invokeModelWithStreaming(
  ctx: AgentGraphContext,
  request: ModelRequest,
  phase: string,
  stepNum: number,
  options?: { timeoutMs?: number }
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

  let timeoutId: ReturnType<typeof setTimeout> | undefined
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

    if (options?.timeoutMs && options.timeoutMs > 0) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          streamSession.abort()
          reject(new Error(`${phase} 阶段模型调用超时`))
        }, options.timeoutMs)
      })
      await Promise.race([runPromise, timeoutPromise, abortPromise])
    } else {
      await Promise.race([runPromise, abortPromise])
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
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

function createThinkNode(ctx: AgentGraphContext) {
  return async (state: AgentGraphState): Promise<AgentGraphUpdate> => {
    if (state.aborted || ctx.abortController.signal.aborted) return { aborted: true, phase: 'stopped' }

    // 修正：probe 写入 stepNumber:0，所以不能以 steps.length===0 判断；
    // 只看"业务步骤"（stepNumber>0）数量，首次交互时为 0。
    const isFirstInteraction = state.steps.filter(s => s.stepNumber > 0).length === 0
    // 首次走 think 时不增加步骤编号；从第二轮开始保持 currentStep 编号（每轮不递增）
    // 修正：聊天路径不递增 currentStep（旧 plan_step 写法 +1 被错误弃掉），
    // 执行路径在 hasCommand 分支中设 currentStep: nextStep 完成递增。
    const nextStep = state.currentStep + 1

    const displayPhase: GraphPhase = isFirstInteraction ? 'planning' : 'observing'
    ctx.callbacks.emitStateChange(displayPhase)

    if (isFirstInteraction) {
      ctx.callbacks.emitMessage({ type: 'status', content: '正在分析...' })
    }

    const request = projectThinkModelRequest(
      state,
      state.taskDescription,
      ctx.callbacks.getTerminalContext(200)
    )
    const text = await invokeModelWithStreaming(ctx, request, 'thinking', nextStep || 1)
    if (ctx.abortController.signal.aborted) return { aborted: true, phase: 'stopped' }

    const parsed = parseAIResponse(text)

    // Model says done
    if (parsed.done) {
      return { currentStep: nextStep, modelResponseText: text, phase: 'planning' }
    }

    // Emit plan if present
    if (parsed.plan) {
      ctx.callbacks.emitMessage({
        type: 'plan',
        content: parsed.plan,
        stepNumber: nextStep
      })
    }

    const hasCommand = !!parsed.command

    if (!hasCommand) {
      // --- 聊天分支：模型选择了聊天，没出命令 ---
      // 修正（第二轮）：用 assistant_reply 而不是 status，让自然回复进入正式气泡通道
      ctx.callbacks.emitMessage({
        type: 'assistant_reply',
        content: text,
        details: { chatResponse: true }
      })
      ctx.callbacks.emitStateChange('idle')
      // 不递增 currentStep，不调用 onStepComplete —— 聊天不是"执行步骤"
      // 显式清空 pendingCommand，避免上一轮残留命令被 routeAfterThink 误判重执行
      return { phase: 'idle', modelResponseText: text, pendingCommand: '' }
    }

    // --- 执行分支：模型出了命令 ---
    // 仅在"非首次"时把当前 step 推入 onStepComplete（与旧 plan_step 行为对齐）
    if (!isFirstInteraction) {
      ctx.callbacks.onStepComplete({
        steps: state.steps,
        currentStep: nextStep
      })
    }

    return {
      currentStep: nextStep,
      planText: parsed.plan || text,
      pendingCommand: parsed.command || '',
      modelResponseText: text,
      confirmationApproved: null,
      needsConfirmation: false,
      safetyResult: null
    }
  }
}

/**
 * 强制执行修正节点（修复 Agent "会聊不会干"）。
 *
 * 触发条件（由 routeAfterThink 控制）：
 *   - 当前是首次真实交互（业务步骤数 == 0）
 *   - 用户请求被识别为"检查 / 观察 / 排查 / 状态"型
 *   - 模型在首轮 think 输出为：
 *       a) DONE: ...  直接给结论
 *       b) 没有 COMMAND（聊天 / 解释）
 *
 * 节点职责：
 *   - 不直接硬编码命令（避免变成命令模板机）
 *   - 重新调用模型一次，强提示"必须出 PLAN + COMMAND"
 *   - 仍允许 1 次"自然回复"作为兜底（如果模型坚持），但先 push 它再交还
 *
 * 注意：只在首轮触发；非首轮不干扰正常 think 循环。
 */
function createRepairActionPlanNode(ctx: AgentGraphContext) {
  return async (state: AgentGraphState): Promise<AgentGraphUpdate> => {
    if (state.aborted || ctx.abortController.signal.aborted) return { aborted: true, phase: 'stopped' }
    const { callbacks } = ctx

    callbacks.emitStateChange('planning')
    callbacks.emitMessage({ type: 'status', content: '正在补一条只读观察命令以获取证据...' })

    const request = projectRepairPlanModelRequest(
      state,
      state.taskDescription,
      callbacks.getTerminalContext(200)
    )

    // 修复：repair 节点补出来的第一条业务步骤必须进入标准编号（1, 2, 3...），
    // 否则下游 think 仍会按 `stepNumber > 0` 误判成"首次交互"，反复触发 repair。
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
      // 双重兜底仍未拿到命令（极端情况）→ 走聊天收尾
      callbacks.emitMessage({
        type: 'assistant_reply',
        content: text,
        details: { chatResponse: true, fromRepair: true }
      })
      callbacks.emitStateChange('idle')
      return { phase: 'idle', modelResponseText: text }
    }

    return {
      currentStep: nextStep,
      planText: parsed.plan || '补一条只读观察命令以获取证据',
      pendingCommand: parsed.command || fallbackCommand,
      modelResponseText: text,
      confirmationApproved: null,
      needsConfirmation: false,
      safetyResult: null
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
      // No command — this step is purely informational
      const step: StepRecord = {
        stepNumber: state.currentStep,
        plan: state.planText,
        observation: '无需执行命令',
        status: 'done'
      }
      return { steps: [...state.steps, step] }
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
      return {
        safetyResult,
        needsConfirmation: false,
        steps: [...state.steps, step]
      }
    }

    // Determine if confirmation is needed
    const alwaysConfirm = safetyResult.isWrite || safetyResult.isUnknown
    const needsConf = safetyResult.requiresConfirmation && (alwaysConfirm || !state.autoExecute)

    return {
      safetyResult,
      needsConfirmation: needsConf
    }
  }
}

function createConfirmCommandNode(ctx: AgentGraphContext) {
  // 幂等守卫：LangGraph 的 interrupt 语义是 resume 时整个节点函数从头重跑，
  // 导致排在 interrupt() 之前的 emitStateChange / emitMessage(awaitingApproval) /
  // emitConfirmRequest 被二次发射，确认框重弹、执行卡片重复。
  // pendingConfirmSteps 记录“已发起确认副作用且尚未被 resume 消费”的步次：
  //   - 首次进入：发射副作用并记入集合，随后 interrupt() 暂停
  //   - resume 重跑：跳过副作用，interrupt() 直接返回 resume 值，随后清除该步
  //   - 拒绝后重新规划再次进入同一步：集合已清除，可正常重新发起确认
  const pendingConfirmSteps = new Set<number>()

  return async (state: AgentGraphState): Promise<AgentGraphUpdate> => {
    if (state.aborted || ctx.abortController.signal.aborted) return { aborted: true, phase: 'stopped' }
    const { callbacks } = ctx

    const confirmMessage = `确认执行以下命令？\n> ${state.pendingCommand}\n\n⚠ ${state.safetyResult?.reason}\n分类：${state.safetyResult?.category}`

    if (!pendingConfirmSteps.has(state.currentStep)) {
      // 首次进入：发起“待确认”展示。resume 重跑时跳过，避免确认框重弹与执行卡片重复
      callbacks.emitStateChange('awaiting_confirmation')
      callbacks.emitMessage({
        type: 'execution',
        content: state.pendingCommand,
        stepNumber: state.currentStep,
        details: {
          awaitingApproval: true,
          reason: state.safetyResult?.reason,
          category: state.safetyResult?.category
        }
      })
      callbacks.emitConfirmRequest({
        message: confirmMessage,
        pendingCommand: state.pendingCommand
      })
      pendingConfirmSteps.add(state.currentStep)
    }

    // This pauses the graph. On resume, returns the user's decision (boolean).
    const approved = interrupt<string, boolean>(confirmMessage)

    // interrupt() 返回意味着 resume 已发生，本次确认周期结束，清除守卫以允许该步未来重新确认
    pendingConfirmSteps.delete(state.currentStep)

    if (!approved) {
      // User rejected — record a skipped step so the model sees the rejection history
      const skippedStep: StepRecord = {
        stepNumber: state.currentStep,
        plan: state.planText,
        command: state.pendingCommand,
        observation: '用户拒绝执行该命令',
        status: 'skipped'
      }
      const allSteps = [...state.steps, skippedStep]
      callbacks.emitMessage({
        type: 'observation',
        content: '用户拒绝执行该命令，将规划下一步',
        stepNumber: state.currentStep
      })
      callbacks.onStepComplete({
        steps: allSteps,
        currentStep: state.currentStep
      })
      return {
        confirmationApproved: false,
        needsConfirmation: false,
        steps: allSteps
      }
    }

    return {
      confirmationApproved: true,
      needsConfirmation: false
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

    callbacks.emitMessage({
      type: 'observation',
      content: result.output,
      stepNumber: state.currentStep,
      details: { duration: result.duration }
    })

    return {
      commandOutput: result.output,
      phase: 'executing'
    }
  }
}

function createAnalyzeResultNode(ctx: AgentGraphContext) {
  return async (state: AgentGraphState): Promise<AgentGraphUpdate> => {
    if (state.aborted || ctx.abortController.signal.aborted) return { aborted: true, phase: 'stopped' }
    const { callbacks } = ctx

    callbacks.emitStateChange('observing')

    const request = projectObservationModelRequest(state)
    const text = await invokeModelWithStreaming(ctx, request, 'observing', state.currentStep)
    if (ctx.abortController.signal.aborted) return { aborted: true, phase: 'stopped' }

    const parsed = parseAIResponse(text)
    const observationText = parsed.observation || text

    // Record step
    const step: StepRecord = {
      stepNumber: state.currentStep,
      plan: state.planText,
      command: state.pendingCommand,
      commandOutput: state.commandOutput,
      observation: observationText,
      status: 'done',
      duration: undefined // set from command result if available
    }

    callbacks.emitMessage({
      type: 'observation',
      content: observationText,
      stepNumber: state.currentStep
    })

    const allSteps = [...state.steps, step]
    callbacks.onStepComplete({
      steps: allSteps,
      currentStep: state.currentStep
    })

    return {
      observation: observationText,
      modelResponseText: text,
      steps: allSteps
    }
  }
}

/**
 * 总结输入保守裁剪：单条 observation 过长时保留首尾要点，避免 token 爆炸导致总结超时。
 * 保留全部步骤的 plan/command 与状态，仅截断超长 observation。
 */
function trimStepsForSummary(steps: StepRecord[]): StepRecord[] {
  return steps.map((s) => {
    const obs = s.observation ?? ''
    if (obs.length <= MAX_OBS_LEN) return s
    const trimmed = `${obs.slice(0, OBS_HEAD)}\n…（已截断 ${obs.length - OBS_HEAD - OBS_TAIL} 字符）…\n${obs.slice(-OBS_TAIL)}`
    return { ...s, observation: trimmed }
  })
}

export function createSummarizeNode(ctx: AgentGraphContext) {
  return async (state: AgentGraphState): Promise<AgentGraphUpdate> => {
    if (state.aborted || ctx.abortController.signal.aborted) return { aborted: true, phase: 'stopped' }
    const { callbacks } = ctx

    callbacks.emitStateChange('summarizing')
    callbacks.emitMessage({ type: 'status', content: '正在生成最终结论...' })

    let summary = ''
    let fromFallback = false

    try {
      // 总结是 token 最重的一次调用：步骤多/观察过长时对 observation 做保守截断，
      // 降低超时概率，同时保留每一步的 plan/command 与观察首尾要点
      const request = projectSummaryModelRequest(state, trimStepsForSummary(state.steps))
      summary = await invokeModelWithStreaming(ctx, request, 'summarizing', state.currentStep, {
        timeoutMs: SUMMARY_TIMEOUT_MS
      })
      if (ctx.abortController.signal.aborted) return { aborted: true, phase: 'stopped' }
    } catch (err) {
      fromFallback = true
      // 不再静默吞错：把总结失败的真实原因（超时 / 网络错误 / 模型异常）记录到主进程日志
      const failReason = err instanceof Error ? err.message : String(err)
      console.error('[agentGraph] 最终总结调用失败，将使用兜底结论：', failReason, err)
      callbacks.emitMessage({ type: 'status', content: `最终总结失败（${failReason}），正在生成兜底结论...` })
    }

    if (fromFallback || !summary.trim() || summary === '(模型未返回内容)') {
      summary = buildFallbackConclusion(state)
    }

    // 去掉模型输出的 "DONE:" / "DONE：" 前缀，前端结论卡片已有 "总结" 标题
    summary = summary.replace(/^DONE[:：]\s*/i, '').trim()

    callbacks.emitMessage({
      type: 'conclusion',
      content: summary,
      details: {
        taskDescription: state.taskDescription,
        steps: state.steps.map(s => ({
          stepNumber: s.stepNumber,
          plan: s.plan,
          command: s.command,
          observation: s.observation,
          status: s.status
        })),
        systemInfo: state.systemDetected
          ? { kernel: state.systemInfo.kernel, distroName: state.systemInfo.distroName, distroVersion: state.systemInfo.distroVersion }
          : null
      }
    })

    // 持久化 COMPLETED 与最终结论：若抛错，不得继续宣告"任务完成"，
    // 让既有运行时异常路径转换为 failed
    try {
      callbacks.onStepComplete({
        steps: state.steps,
        currentStep: state.currentStep,
        conclusion: summary,
        stopReason: 'COMPLETED'
      })
    } catch (persistErr) {
      const reason = persistErr instanceof Error ? persistErr.message : String(persistErr)
      console.error('[agentGraph] 持久化 COMPLETED 失败，转 failed：', reason, persistErr)
      callbacks.emitStateChange('failed')
      return {
        conclusion: summary,
        phase: 'failed',
        stopReason: 'ERROR'
      }
    }

    // 持久化成功后，显式发射一次 completed 状态事件，
    // 保证"任务完成"文案出现前主进程已具备可观察的 completed 状态
    callbacks.emitStateChange('completed')

    // 最后投递"任务完成，共执行 N 步"状态文案，并返回图状态 completed
    const doneCount = state.steps.filter(s => s.status === 'done').length
    callbacks.emitMessage({ type: 'status', content: `任务完成，共执行 ${doneCount} 步` })

    return {
      conclusion: summary,
      phase: 'completed',
      stopReason: 'COMPLETED'
    }
  }
}

/** Fallback conclusion when model summary fails */
function buildFallbackConclusion(state: AgentGraphState): string {
  const doneSteps = state.steps.filter((s) => s.status === 'done')
  const lines: string[] = []
  lines.push(`## 任务：${state.taskDescription || '(未记录)'}`)
  lines.push('')
  if (doneSteps.length > 0) {
    lines.push('### 执行步骤')
    for (const step of doneSteps) {
      if (step.stepNumber === 0) continue
      lines.push(`- **步骤 ${step.stepNumber}**：${step.plan}`)
      if (step.command) lines.push(`  - 命令：\`${step.command}\``)
      if (step.observation) lines.push(`  - 结果：${step.observation}`)
    }
  } else {
    lines.push('(无已完成的执行步骤)')
  }
  lines.push('')
  lines.push('> 因模型总结调用失败，以上为自动生成的执行摘要作为兜底结论。')
  return lines.join('\n')
}

// ================================================================
//  Routing functions (conditional edges)
// ================================================================

function routeAfterThink(state: AgentGraphState): string {
  if (state.aborted) return 'end'

  // ---- 首轮 + 检查型请求的硬 guard（修复 Agent "会聊不会干"） ----
  // 业务步骤数 == 0 表示这是首次真实交互；
  // 此时若模型给的是 DONE / 聊天，必须先经过 repair 节点，
  // 不能直接进入 summarize / end。
  const businessSteps = state.steps.filter(s => s.stepNumber > 0).length
  const isFirstInteraction = businessSteps === 0
  if (isFirstInteraction && shouldRequireInspection(state.taskDescription)) {
    const parsed = parseAIResponse(state.modelResponseText)
    const isChattyZeroCommand = parsed.done || !state.pendingCommand
    if (isChattyZeroCommand) {
      return 'repair_action_plan'
    }
  }

  // Model said done
  const parsed = parseAIResponse(state.modelResponseText)
  if (parsed.done) return 'summarize'

  // No command → chat response, end gracefully
  if (!state.pendingCommand) return 'end'

  // Has command → check safety
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
  // Command was blocked → check step limit before looping back to think
  if (state.safetyResult?.blocked) {
    if (state.currentStep >= state.maxSteps) return 'step_limit'
    return 'think'
  }
  // No command (from no-command branch) → check step limit before looping back to think
  if (!state.pendingCommand) {
    if (state.currentStep >= state.maxSteps) return 'step_limit'
    return 'think'
  }
  // Needs confirmation → interrupt
  if (state.needsConfirmation) return 'confirm_command'
  // Safe to execute
  return 'execute_command'
}

function routeAfterConfirm(state: AgentGraphState): string {
  if (state.aborted) return 'end'
  if (state.confirmationApproved) return 'execute_command'
  // User rejected — check step limit before looping back to think
  if (state.currentStep >= state.maxSteps) return 'step_limit'
  return 'think'
}

function routeAfterAnalyze(state: AgentGraphState): string {
  if (state.aborted) return 'end'
  // Check if model said done in the observation
  const parsed = parseAIResponse(state.modelResponseText)
  if (parsed.done) return 'summarize'
  // Check step limit
  if (state.currentStep >= state.maxSteps) return 'step_limit'
  return 'think'
}

// ================================================================
//  Graph factory
// ================================================================

export function buildAgentGraph(ctx: AgentGraphContext, checkpointer: MemorySaver) {
  // Register nodes (chain to accumulate node name types)
  const builder = new StateGraph(AgentStateAnnotation)
    .addNode('think', createThinkNode(ctx))
    .addNode('repair_action_plan', createRepairActionPlanNode(ctx))
    .addNode('check_safety', createCheckSafetyNode(ctx))
    .addNode('confirm_command', createConfirmCommandNode(ctx))
    .addNode('execute_command', createExecuteCommandNode(ctx))
    .addNode('analyze_result', createAnalyzeResultNode(ctx))
    .addNode('summarize', createSummarizeNode(ctx))
    .addNode('set_round_limit', async (state: AgentGraphState): Promise<AgentGraphUpdate> => {
      ctx.callbacks.emitStateChange('stepLimitReached')
      ctx.callbacks.emitMessage({ type: 'status', content: '已达到最大步数上限，可点击“继续”追加步数' })
      ctx.callbacks.onStepComplete({
        steps: state.steps,
        currentStep: state.currentStep,
        stopReason: 'ROUND_LIMIT'
      })
      return { phase: 'stepLimitReached', stopReason: 'ROUND_LIMIT' }
    })

  // Edges
  builder
    .addEdge(START, 'think')

  builder.addConditionalEdges('think', routeAfterThink, {
    check_safety: 'check_safety',
    summarize: 'summarize',
    repair_action_plan: 'repair_action_plan',
    end: END                       // 聊天路径 → 直接结束
  })

  builder.addConditionalEdges('repair_action_plan', routeAfterRepair, {
    check_safety: 'check_safety',
    end: END
  })

  builder.addConditionalEdges('check_safety', routeAfterSafety, {
    confirm_command: 'confirm_command',
    execute_command: 'execute_command',
    think: 'think',                // 曾为 plan_step
    step_limit: 'set_round_limit',
    end: END
  })

  builder.addConditionalEdges('confirm_command', routeAfterConfirm, {
    execute_command: 'execute_command',
    think: 'think',                // 曾为 plan_step
    step_limit: 'set_round_limit',
    end: END
  })

  builder.addEdge('execute_command', 'analyze_result')

  builder.addConditionalEdges('analyze_result', routeAfterAnalyze, {
    think: 'think',                // 曾为 plan_step
    summarize: 'summarize',
    step_limit: 'set_round_limit',
    end: END
  })

  builder.addEdge('set_round_limit', END)

  builder.addEdge('summarize', END)

  return builder.compile({ checkpointer })
}
