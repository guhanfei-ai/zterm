/**
 * Pi 自定义终端工具:read_bound_terminal_context + execute_bound_terminal。
 *
 * 这是 zTerm Agent 模式接入 Pi 后模型唯一可见的两个工具。
 * host/terminalTabId/allowWrite 由宿主注入,模型不能用参数自由选择资产
 * 或提高权限(总纲 6.1)。
 *
 * 验收退回 R07 修复:
 * - 读取工具有本轮总调用上限,与命令预算一样耗尽即拒;
 * - Agent POSIX 子 shell 返回随机完成标记与真实退出码才算 verified;
 * - 超时/取消/断线/协议失败时,整个真实终端进入结果不明隔离,
 *   跨 tab/新轮都不能继续自动下发;须关闭并重建终端会话;
 * - 命令执行按真实终端实例全局互斥(跨 tab 串行),取消可释放锁。
 *
 * 详见 _tacp/20260925-030120 验收退回 R01/R06/R07。
 */
import { Type, type Static } from '@earendil-works/pi-ai'
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { checkCommand } from './safetyGuard'
import type { AgentCommandResult, TerminalBridge } from './terminalBridge'
import type { SafetyCheck } from './safetyGuard'
import type { AgentGraphCallbacks } from './agentGraph'
import type { StepRecord } from './agentGraphState'
import {
  getAgentTerminalKey,
  isAgentTerminalUncertain,
  markAgentTerminalUncertain,
  resetAgentTerminalCoordinatorForTest,
  withAgentTerminalLock,
} from './agentTerminalCoordinator'

// execute 签名第 4/5 参数(onUpdate / ctx)由 SDK 传入;zTerm 工具不使用。
type ToolExecuteRest = [
  onUpdate: unknown,
  ctx: unknown
]

/** read_bound_terminal_context 的 details 字段(所有字段可选,适配多分支返回)。 */
interface ReadToolDetails {
  skipped?: boolean
  reason?: string
  error?: string
  lines?: number
  host?: string | undefined
}

/** execute_bound_terminal 的 details 字段。 */
interface ExecToolDetails {
  skipped?: boolean
  reason?: string
  error?: string
  command?: string
  blocked?: boolean
  stepNumber?: number
  duration?: number
  exitCode?: number
  fidelity?: ExecutionFidelity
  truncated?: boolean
  errMsg?: string
}

/**
 * 工具可见的每轮可变状态(R01:唯一对象,工具闭包与 runtime 共享同一实例)。
 * runtime 的 TurnState 结构兼容本接口;所有字段读写对双方即时可见。
 */
export interface PiToolTurnState {
  running: boolean
  stopped: boolean
  /** G01:该轮被取消(stop/销毁/新轮启动);迟到结果不再写入任何轮。 */
  cancelled: boolean
  // ---- 预算(本轮计数从 0 起,R01 修复:不再用累计数减基准的混合算式) ----
  /** 本轮命令预算上限(每次人类介入重置)。 */
  maxSteps: number
  /** 本轮已消耗的命令数(含 blocked)。 */
  commandsUsed: number
  /** 本轮读取工具已调用数。 */
  readCallsUsed: number
  /** 工具上报的预算耗尽标志(供 runtime 收尾映射 ROUND_LIMIT)。 */
  budgetExhausted: boolean
  /** 读取上限耗尽标志。 */
  readLimitExhausted: boolean
  /** 本轮出现未验证命令结果；收尾不得宣称任务完成。 */
  uncertainResult: boolean
  /** 最后一条已证实结束的业务命令退出码；非零不等于任务完成。 */
  lastCommandExitCode?: number
  // ---- 审计(全局步号,与预算分离) ----
  steps: StepRecord[]
  // ---- 权限(运行中可变,R01 修复:直读字段,不用闭包快照) ----
  allowWrite: boolean
  boundHost: string | undefined
  // ---- 去重与屏障 ----
  /** 已执行的 toolCallId,防 Pi 自动重试重放副作用。 */
  executedToolCallIds: Set<string>
  /** 旧轮内同命令的附加提示；真正的结果不明隔离按底层 session 跨轮维持。 */
  unknownWriteCommands: Set<string>
  /** G01:该轮的回调(迟到结果校验所属轮仍有效后按旧任务身份回调)。 */
  callbacks: AgentGraphCallbacks
}

/**
 * 工具执行上下文(F01/G01):bridge/turn 是动态 getter ——
 * 每次工具调用**入口**取当前轮/当前绑定;工具内部随即把 getter 解引用
 * 为本次调用的绑定引用(见 bindCallContext),后续记录/校验都用绑定值,
 * 不在完成时重新查找"最新任务"。
 * 绑定的是对象引用而非字段快照:turn.allowWrite/stopped 等字段仍实时
 * (保留 F03 排队降权、停止即拒的语义)。
 */
export interface PiToolExecutionContext {
  bridge: TerminalBridge
  turn: PiToolTurnState
}

// ---- 工具 1: read_bound_terminal_context ----

const ReadContextParams = Type.Object({
  lines: Type.Optional(
    Type.Number({ description: '读取最近 N 行输出(默认 200,上限 2000)', minimum: 1, maximum: 2000 })
  ),
})

type ReadContextArgs = Static<typeof ReadContextParams>

// ---- 工具 2: execute_bound_terminal ----

const ExecuteCommandParams = Type.Object({
  command: Type.String({
    description: '要在已绑定终端上执行的命令。不能选择其他主机或提升权限。',
  }),
  plan: Type.Optional(
    Type.String({ description: '执行此命令的计划说明(可选,供用户审计)' })
  ),
})

type ExecuteCommandArgs = Static<typeof ExecuteCommandParams>

// ---- 上限常量 ----

/** 读取工具本轮总调用上限(总纲 6.4:非执行工具也要有限总上限,防无限循环)。 */
export const READ_CALLS_LIMIT = 50
/** 工具返回给模型的输出上限(总纲 6.6:输出大小有界,截断可见)。 */
const MAX_TOOL_OUTPUT_CHARS = 8000
/** 与现有 graph 对齐的步超时(agentGraphConfig.ts)。 */
const STEP_TIMEOUT_MS = 30_000

/** 命令执行结果保真度：只有收到 Agent 协议结束标记和退出码才算 verified。 */
export type ExecutionFidelity = 'verified' | 'timedOut' | 'aborted' | 'disconnected' | 'unsupported'

function truncateToolOutput(text: string): string {
  return text.length <= MAX_TOOL_OUTPUT_CHARS ? text : text.slice(0, MAX_TOOL_OUTPUT_CHARS) + '\n…[输出已截断]'
}

/** 兼容既有测试入口；真实协调状态已下沉为 Pi/Graph 共用模块。 */
export function resetTerminalLocksForTest(): void {
  resetAgentTerminalCoordinatorForTest()
}

// ---- G01:每次工具调用的绑定上下文 ----

/**
 * 工具调用入口把动态 getter 解引用为本次调用的绑定引用。
 * 后续所有记录/校验用绑定值,不在完成时重新查找"最新任务" ——
 * 旧任务的迟到结果不会写进新任务(cancelled 的旧轮不写回调)。
 * 绑定的是对象引用:turn.allowWrite/stopped 等字段仍实时可变
 * (保留 F03 排队降权、停止即拒语义)。
 */
function bindCallContext(ctx: PiToolExecutionContext) {
  const turn = ctx.turn
  const bridge = ctx.bridge
  return {
    turn,
    bridge,
    isConnectionValid: (): boolean =>
      !turn.stopped && !turn.cancelled && bridge.isConnected() && !bridge.isDisposed(),
    /** G01:所属轮已取消/停止的迟到结果不写入；下发前的 executing 证据已先持久化。 */
    recordStep: (step: StepRecord): void => {
      if (turn.cancelled || turn.stopped) return
      const existing = turn.steps.findIndex((item) => item.stepNumber === step.stepNumber)
      if (existing >= 0) turn.steps[existing] = step
      else turn.steps.push(step)
      turn.callbacks.onStepComplete({
        steps: [...turn.steps],
        currentStep: step.stepNumber,
      })
    },
    nextStepNumber: (): number =>
      (turn.steps.length > 0 ? Math.max(...turn.steps.map((s) => s.stepNumber)) : 0) + 1,
  }
}

// ---- 工具工厂 ----

/**
 * 创建两个自定义终端工具。
 * 每次 startTask 时调用,turn 通过上下文传入(同一可变对象,非快照)。
 */
export function createBoundTerminalTools(
  ctx: PiToolExecutionContext
): ToolDefinition[] {
  const readTool = defineTool<
    typeof ReadContextParams,
    ReadToolDetails
  >({
    name: 'read_bound_terminal_context',
    label: '读取终端上下文',
    description:
      '读取已绑定终端的最近输出。不执行任何命令。用于了解当前终端状态、检查命令输出。每次调用前会校验终端绑定和连接是否仍然有效。本工具有每轮总调用上限,耗尽后需人类介入重置。',
    parameters: ReadContextParams,
    executionMode: 'sequential',
    async execute(
      toolCallId: string,
      params: Static<typeof ReadContextParams>,
      signal: AbortSignal | undefined,
      ..._rest: ToolExecuteRest
    ): Promise<AgentToolResult<ReadToolDetails>> {
      const { turn, bridge, isConnectionValid } = bindCallContext(ctx)
      // 防相同 toolCallId 重放(Pi 自动重试)
      if (turn.executedToolCallIds.has(toolCallId)) {
        return {
          content: [{ type: 'text', text: '[重复调用已跳过]' }],
          details: { skipped: true, reason: 'duplicate_tool_call_id' },
        }
      }
      turn.executedToolCallIds.add(toolCallId)

      // 停止/断线后拒绝(总纲 6.4:停止禁止后续工具下发)
      if (turn.stopped || !isConnectionValid()) {
        return {
          content: [{ type: 'text', text: '[终端未绑定、已断开或任务已停止,无法读取上下文]' }],
          details: { error: 'no_bound_terminal' },
          terminate: true,
        }
      }

      // R07:读取工具本轮总上限
      if (turn.readCallsUsed >= READ_CALLS_LIMIT || turn.readLimitExhausted) {
        turn.readLimitExhausted = true
        return {
          content: [{ type: 'text', text: '[本轮读取调用已达上限,请总结当前发现或请用户介入]' }],
          details: { error: 'read_limit_exhausted' },
          terminate: true,
        }
      }
      turn.readCallsUsed++

      const lines = Math.min(Math.max(params.lines ?? 200, 1), 2000)
      const context = bridge.getTerminalContext(lines)
      if (!context) {
        return {
          content: [{ type: 'text', text: '[终端无可用输出]' }],
          details: { error: 'no_output' },
        }
      }

      return {
        content: [{ type: 'text', text: truncateToolOutput(context.recentOutput || '[终端当前无输出]') }],
        details: { lines, host: turn.boundHost },
      }
    },
  })

  const executeTool = defineTool<
    typeof ExecuteCommandParams,
    ExecToolDetails
  >({
    name: 'execute_bound_terminal',
    label: '执行终端命令',
    description:
      '在已绑定的真实终端上执行一条命令并返回输出。每次调用在独立 POSIX 子 shell 中运行；cd/export/source 不会改变后续调用，必须与依赖它们的操作合并在同一条命令中。命令经 zTerm 安全策略校验:默认只读,危险命令永远阻断,写命令需用户已开启写模式。不能选择其他主机,不能提升权限。命令执行按终端串行,每次调用消耗一个命令预算;预算耗尽后停止执行。超时或结果不明的命令不会自动重试。',
    parameters: ExecuteCommandParams,
    executionMode: 'sequential',
    async execute(
      toolCallId: string,
      params: Static<typeof ExecuteCommandParams>,
      signal: AbortSignal | undefined,
      ..._rest: ToolExecuteRest
    ): Promise<AgentToolResult<ExecToolDetails>> {
      // F01/G01:入口绑定本次调用的 turn/bridge;后续用绑定值,
      // 完成时不再查找"最新任务" —— 旧轮迟到结果不写新轮。
      const { turn, bridge, isConnectionValid, recordStep, nextStepNumber } = bindCallContext(ctx)
      const command = params.command
      const plan = params.plan

      // 防相同 toolCallId 重放
      if (turn.executedToolCallIds.has(toolCallId)) {
        return {
          content: [{ type: 'text', text: '[重复调用已跳过,命令未再次执行]' }],
          details: { skipped: true, reason: 'duplicate_tool_call_id', command },
          terminate: true,
        }
      }
      turn.executedToolCallIds.add(toolCallId)

      // 停止/断线后拒绝
      if (turn.stopped || !isConnectionValid()) {
        return {
          content: [{ type: 'text', text: '[终端未绑定、已断开或任务已停止,拒绝执行命令]' }],
          details: { error: 'no_bound_terminal', command },
          terminate: true,
        }
      }

      // 本轮同命令的附加提示；下方锁内的 session 隔离覆盖所有命令与轮次。
      if (turn.unknownWriteCommands.has(command)) {
        return {
          content: [
            {
              type: 'text',
              text: `[当前终端上一条 Agent 命令结果未验证，后续自动命令已隔离。请关闭并新建终端会话，原连接不可通过新轮解锁。]\n命令: ${command}`, 
            },
          ],
          details: { error: 'unknown_write_barrier', command },
          terminate: true,
        }
      }

      // 预算(总纲 6.4:被拦截的命令同样消耗预算,防止无限试探)
      if (turn.commandsUsed >= turn.maxSteps || turn.budgetExhausted) {
        turn.budgetExhausted = true
        return {
          content: [
            {
              type: 'text',
              text: '[本轮命令预算已耗尽。请总结当前进展;如需继续执行,请用户通过界面继续并重置预算。]',
            },
          ],
          details: { error: 'budget_exhausted', command },
          terminate: true,
        }
      }

      const stepNumber = nextStepNumber()
      const startedAt = new Date().toISOString()
      // 预算在执行前扣减(blocked 与执行同口径;排队中被拦截同样计数)
      turn.commandsUsed++
      let attempted = false
      let attemptedKey: object | null = null

      try {
        // F02:锁 key 是底层真实 session(bridge.getTerminalLockKey),
        // 两个 bridge 包同一终端也串行;不是 bridge 包装对象。
        // F03:安全检查移入锁内 —— 排队期间用户降权/改绑/停止,
        // 到真正下发边界时基于当前权限重新判定,排队前的放行不作数。
        type LockOutcome =
          | { kind: 'skip'; reason: string }
          | { kind: 'uncertain' }
          | { kind: 'blocked'; safetyCheck: SafetyCheck }
          | { kind: 'exec'; safetyCheck: SafetyCheck; result: AgentCommandResult }

        const key = getAgentTerminalKey(bridge)
        attemptedKey = key
        const outcome: LockOutcome = await withAgentTerminalLock(
          key,
          signal,
          async (): Promise<LockOutcome> => {
            // 锁内重判:等待排队时可能停止、降权或发生旧命令结果不明。
            if (turn.stopped || !isConnectionValid() || bridge.isDisposed()) {
              return { kind: 'skip', reason: 'no_bound_terminal' }
            }
            if (isAgentTerminalUncertain(key)) return { kind: 'uncertain' }
            // PTY 行规程会在引号内照样解释回车、Ctrl-C、退格等字节；
            // 它们不能作为单行 sh -c 参数安全发送,必须在模型参数边界拒绝。
            if (/[\x00-\x1f\x7f]/.test(command)) {
              return { kind: 'blocked', safetyCheck: {
                safe: false, blocked: true, isWrite: false, isUnknown: true,
                reason: 'Agent 命令不能包含换行、回车或其他终端控制字符', category: '终端协议'
              } }
            }
            const safetyCheck: SafetyCheck = checkCommand(command, turn.allowWrite)
            if (safetyCheck.blocked) return { kind: 'blocked', safetyCheck }
            // 在真实下发前先持久化 executing。若随后 stop/断线，旧轮结果事件可丢弃，
            // 但恢复历史仍明确知道该命令“可能已执行”，不会把它当作从未下发。
            recordStep({
              stepNumber,
              plan: plan || '',
              command,
              observation: '命令已下发，等待可信完成标记',
              safetyCheck,
              status: 'executing',
              startedAt,
            })
            attempted = true
            try {
              const result = await bridge.executeAgentCommand(command, STEP_TIMEOUT_MS, signal)
              // 没有可信结束标记时，即使输出已稳定/只读/下一轮也不能下发。
              if (result.completion !== 'verified') markAgentTerminalUncertain(key)
              return { kind: 'exec', safetyCheck, result }
            } catch (err) {
              markAgentTerminalUncertain(key)
              throw err
            }
          }
        )

        if (outcome.kind === 'skip') {
          const skippedStep: StepRecord = {
            stepNumber,
            plan: plan || '',
            command,
            observation: '执行前终端已断开或任务已停止',
            status: 'skipped',
            startedAt,
          }
          recordStep(skippedStep)
          return {
            content: [{ type: 'text', text: '[执行前终端已断开或任务已停止,命令未执行]' }],
            details: { error: outcome.reason, command, stepNumber },
            terminate: true,
          }
        }

        if (outcome.kind === 'uncertain') {
          turn.uncertainResult = true
          recordStep({
            stepNumber,
            plan: plan || '',
            command,
            observation: '当前终端上一条 Agent 命令结果未验证，后续自动命令已隔离',
            status: 'skipped',
            startedAt,
          })
          return {
            content: [{ type: 'text', text: '[当前终端上一条 Agent 命令结果未验证，禁止后续自动命令。请关闭并新建终端会话。]' }],
            details: { error: 'terminal_result_unverified', command, stepNumber },
            terminate: true,
          }
        }

        if (outcome.kind === 'blocked') {
          const blockedStep: StepRecord = {
            stepNumber,
            plan: plan || '',
            command,
            observation: outcome.safetyCheck.reason || '命令被安全策略拦截',
            safetyCheck: outcome.safetyCheck,
            status: 'blocked',
            startedAt,
          }
          recordStep(blockedStep)
          return {
            content: [
              {
                type: 'text',
                text: `[命令被安全策略拦截] ${outcome.safetyCheck.reason || '当前不允许执行此命令'}\n命令: ${command}`,
              },
            ],
            details: {
              blocked: true,
              reason: outcome.safetyCheck.reason,
              command,
              stepNumber,
            },
          }
        }

        // ---- 正常执行结果:保真度分类 ----
        const { safetyCheck, result } = outcome
        const isWrite = safetyCheck.isWrite

        // 只有协议返回结束标记 + 退出码才是已验证完成；稳定输出绝不升级。
        const fidelity: ExecutionFidelity = result.completion === 'verified' && result.exitCode === undefined
          ? 'timedOut' : result.completion
        if (fidelity !== 'verified') turn.uncertainResult = true
        else turn.lastCommandExitCode = result.exitCode

        const output = result.output || '(无输出)'
        const truncated = output.length > MAX_TOOL_OUTPUT_CHARS

        if (isWrite && fidelity !== 'verified') turn.unknownWriteCommands.add(command)

        const status: StepRecord['status'] = fidelity === 'verified'
          ? 'done'
          : result.commandSent ? 'executing' : 'skipped'
        const observationText =
          fidelity === 'verified'
            ? truncateToolOutput(output)
            : fidelity === 'timedOut'
              ? `在 ${STEP_TIMEOUT_MS / 1000}s 内未收到可信完成标记，无法确认命令是否结束`
              : fidelity === 'aborted'
                ? '执行被取消,无法确认命令结果'
                : fidelity === 'unsupported'
                   ? '终端未通过 Agent 完成协议探测，业务命令未下发'
                   : '终端已断开,无法确认命令结果'

        const step: StepRecord = {
          stepNumber,
          plan: plan || '',
          command,
          commandOutput: output,
          observation:
            observationText.length <= 400 ? observationText : observationText.slice(0, 400) + '…[已截断]',
          safetyCheck,
          status,
          startedAt,
          duration: result.duration,
        }
        recordStep(step)

        // 总纲 6.6:没有退出码就不伪造;结果不明不宣称成功
        const exitInfo =
          result.exitCode !== undefined
            ? `退出码: ${result.exitCode}`
            : result.commandSent ? '退出码: 未知(完成未验证)' : '退出码: 未下发业务命令'
        const fidelityNote =
          fidelity === 'verified'
            ? ''
            : fidelity === 'timedOut'
              ? '\n[注意: 命令可能仍在运行,结果不确定]'
              : fidelity === 'aborted'
                ? '\n[注意: 执行已取消,结果不确定]'
                : '\n[注意: 终端已断开或不支持此完成协议,结果不确定]'
        const replayBarrierNote = fidelity === 'verified'
          ? ''
          : '\n[当前终端结果不明,后续 Agent 命令被隔离;请关闭并新建终端会话]'

        return {
          content: [
            {
              type: 'text',
              text: `${observationText}${fidelityNote}${replayBarrierNote}\n\n---\n耗时: ${result.duration}ms\n${exitInfo}`,
            },
          ],
          details: {
            command,
            stepNumber,
            duration: result.duration,
            exitCode: result.exitCode,
            fidelity,
            truncated,
          },
        }
      } catch (err) {
        // withAgentTerminalLock 排队期间被取消,或执行异常
        const isAborted = signal?.aborted === true
        const errMsg = err instanceof Error ? err.message : String(err)
        // 排队中取消尚未下发任何命令,不污染该终端；进入执行体后任何
        // 意外异常均按结果不明隔离,不能靠换命令/新轮绕过。
        if (attempted && attemptedKey) {
          markAgentTerminalUncertain(attemptedKey)
          turn.uncertainResult = true
        }
        const failedStep: StepRecord = {
          stepNumber,
          plan: plan || '',
          command,
          observation: attempted
            ? (isAborted ? '执行被取消，远端结果未验证' : `执行异常且远端结果未验证: ${errMsg}`)
            : (isAborted ? '排队期间已取消，命令未下发' : `执行前异常: ${errMsg}`),
          status: attempted ? 'executing' : 'skipped',
          startedAt,
        }
        recordStep(failedStep)
        return {
          content: [
            {
              type: 'text',
              text: `[${isAborted ? '执行被取消' : '执行异常'}] ${errMsg}\n命令: ${command}\n注意: 不会自动重试此命令。`,
            },
          ],
          details: { error: isAborted ? 'aborted' : 'execution_error', command, stepNumber, errMsg },
          terminate: true,
        }
      }
    },
  })

  return [readTool, executeTool]
}
