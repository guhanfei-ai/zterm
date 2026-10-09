/**
 * Pi 自定义终端工具契约测试(验收退回 R01/R06/R07)。
 *
 * 覆盖:
 * - R01:运行中降权即时生效(allowWrite 直读 turn 对象);
 * - R01:recordStep 原地追加,完成回调拿到全部步骤(不被收尾覆盖);
 * - R01:预算"本轮从 0 起",恢复旧步骤不再使预算算式失效;
 * - R06/R07:blocked/预算耗尽/未知写屏障的错误分类;
 * - R07:读取工具总上限;未知结果写命令屏障跨 toolCallId;
 * - R07:跨 tab 终端互斥(共用同一 bridge 的命令串行执行)。
 *
 * 不依赖真实模型/终端/网络:bridge 与 callbacks 全部 stub。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createBoundTerminalTools,
  resetTerminalLocksForTest,
  READ_CALLS_LIMIT,
  type PiToolTurnState,
  type PiToolExecutionContext
} from '../piAgentTools'
import type { AgentCommandResult, TerminalBridge } from '../terminalBridge'
import type { AgentGraphCallbacks } from '../agentGraph'
import type { StepRecord } from '../agentGraphState'

// ---- 测试脚手架 ----

function makeTurn(overrides?: Partial<PiToolTurnState>): PiToolTurnState {
  // G01:cancelled + callbacks 是 turn 的字段(迟到结果按旧任务身份处理)
  const stepSnapshots: StepRecord[][] = []
  const baseTurn: PiToolTurnState = {
    running: true,
    stopped: false,
    cancelled: false,
    maxSteps: 25,
    commandsUsed: 0,
    readCallsUsed: 0,
    budgetExhausted: false,
    readLimitExhausted: false,
    uncertainResult: false,
    steps: [],
    // 本文件测试保留的通用执行链路；读模式契约由 agentReadTools.test 覆盖。
    allowWrite: true,
    boundHost: 'test-host',
    executedToolCallIds: new Set<string>(),
    unknownWriteCommands: new Set<string>(),
    callbacks: {
      emitMessage() {},
      emitStateChange() {},
      getTerminalContext() { return null },
      onStepComplete(data: { steps: StepRecord[]; currentStep: number }) {
        stepSnapshots.push(data.steps)
      },
    },
    ...overrides,
  }
  return baseTurn
}

describe('生产安全规则接入真实工具路径', () => {
  it.each([
    'printf harmless > "/tmp/example"',
    'env sh -c "printf harmless"',
    'find . -exec sh -c "printf harmless" \\;',
    'git branch new-branch',
  ])('默认只读时不得下发绕过命令：%s', async (command) => {
    const bridge = makeBridge()
    const turn = makeTurn({ allowWrite: false })
    const tool = createBoundTerminalTools({ bridge, turn })[1]
    const result = await tool.execute('production-test', { command }, undefined, undefined, {} as never)
    expect(bridge._writeCommand).not.toHaveBeenCalled()
    expect(result.details).toMatchObject({ blocked: true })
    expect(turn.commandsUsed).toBe(1)
    expect(turn.steps.at(-1)?.status).toBe('blocked')
  })
})

/** 从 turn 收集 onStepComplete 快照(工具 recordStep 回调写入)。 */
function turnStepSnapshots(turn: PiToolTurnState): StepRecord[][] {
  const out: StepRecord[][] = []
  const orig = turn.callbacks.onStepComplete
  const collecting = (data: { steps: StepRecord[]; currentStep: number }): void => {
    out.push(data.steps)
    orig.call(turn.callbacks, data)
  }
  // 包装当前 callbacks 的 onStepComplete(仅在调用时收集)
  const origEmit = turn.callbacks
  ;(turn as PiToolTurnState & { callbacks: AgentGraphCallbacks }).callbacks = {
    ...origEmit,
    onStepComplete: collecting,
  }
  return out
}

function makeBridge(overrides?: {
  output?: string
  duration?: number
  completion?: AgentCommandResult['completion']
  connected?: boolean
  writeCommand?: ReturnType<typeof vi.fn>
}): TerminalBridge & { _writeCommand: ReturnType<typeof vi.fn> } {
  const writeCommand = overrides?.writeCommand ?? vi.fn()
  const connected = overrides?.connected ?? true
  // F02:每个 stub bridge 有独立的底层锁 key(模拟不同 session 实例)
  const lockKey = { fakeSession: true }
  const bridge = {
    isConnected: () => connected && !bridge.isDisposed(),
    isDisposed: () => false,
    getTerminalLockKey: () => lockKey,
    getTerminalContext: (lines = 200) => ({
      hostName: 'test',
      hostDetails: 'test@host',
      source: 'direct' as const,
      recentOutput: `最近 ${lines} 行输出`,
      isConnected: connected,
    }),
    getPreCommandSnapshot: () => 'SNAPSHOT',
    writeCommand,
    executeAgentCommand: async (command: string): Promise<AgentCommandResult> => {
      await (writeCommand as (value: string) => void | Promise<void>)(command)
      const completion = overrides?.completion ?? 'verified'
      return {
        command,
        output: overrides?.output ?? '执行成功输出',
        duration: overrides?.duration ?? 500,
        completion,
        commandSent: true,
        ...(completion === 'verified' ? { exitCode: 0 } : {}),
      }
    },
    dispose: () => {},
  } as unknown as TerminalBridge & { _writeCommand: ReturnType<typeof vi.fn> }
  return Object.assign(bridge, { _writeCommand: writeCommand })
}

function makeCallbacks(): AgentGraphCallbacks & {
  messages: Array<{ type: string; content: string; details?: Record<string, unknown> }>
  stepSnapshots: StepRecord[][]
} {
  const messages: Array<{ type: string; content: string; details?: Record<string, unknown> }> = []
  const stepSnapshots: StepRecord[][] = []
  return {
    messages,
    stepSnapshots,
    emitMessage(msg) {
      messages.push({ ...msg })
    },
    emitStateChange() {},
    getTerminalContext() { return null },
    onStepComplete(data) {
      stepSnapshots.push(data.steps)
    },
  } as AgentGraphCallbacks & { messages: typeof messages; stepSnapshots: typeof stepSnapshots }
}

function makeCtx(
  turn: PiToolTurnState,
  _bridge: TerminalBridge,
  _callbacks: AgentGraphCallbacks
): PiToolExecutionContext {
  // G01 后生产 ctx 只含 bridge/turn;记录/校验由 bindCallContext
  // 用绑定 turn 实现 —— 测试与生产结构一致。
  return { bridge: _bridge, turn }
}

/** 直接调用工具 execute(绕过 SDK,参数与 SDK 调用一致)。 */
type ExecutableTool = {
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown
  ) => Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown>; terminate?: boolean }>
}

async function callTool(
  tool: ExecutableTool,
  toolCallId: string,
  params: Record<string, unknown>,
  signal?: AbortSignal
) {
  return tool.execute(toolCallId, params, signal, undefined, undefined)
}

function findTool(tools: ReturnType<typeof createBoundTerminalTools>, name: string): ExecutableTool {
  const t = tools.find((x) => x.name === name)
  if (!t) throw new Error(`tool not found: ${name}`)
  return t as unknown as ExecutableTool
}

beforeEach(() => {
  resetTerminalLocksForTest()
})

// ================================================================
//  R01:状态共享与预算
// ================================================================

describe('R01 运行中降权即时生效', () => {
  it('写模式开始 → 运行中降为只读 → 下一条写命令被拒', async () => {
    const turn = makeTurn({ allowWrite: true })
    const bridge = makeBridge()
    const callbacks = makeCallbacks()
    const tools = createBoundTerminalTools(makeCtx(turn, bridge, callbacks))
    const exec = findTool(tools, 'execute_bound_terminal')

    // 只读命令先放行(建立基线)
    let r = await callTool(exec, 'c1', { command: 'ls /var/log' })
    expect(r.details.blocked).toBeUndefined()

    // 运行中降权(直改 turn 对象 —— 与 updateAllowWrite 同一路径)
    turn.allowWrite = false

    // 写命令:读模式下被拦截
    r = await callTool(exec, 'c2', { command: 'touch /tmp/x' })
    expect(r.details.blocked).toBe(true)
    expect(bridge._writeCommand).toHaveBeenCalledTimes(1) // 只放过 ls
  })

  it('下发前 executing 证据持久化失败时 fail-closed，终端零写入', async () => {
    const turn = makeTurn()
    const bridge = makeBridge()
    turn.callbacks.onStepComplete = () => { throw new Error('persist failed') }
    const exec = findTool(createBoundTerminalTools(makeCtx(turn, bridge, makeCallbacks())), 'execute_bound_terminal')

    await expect(callTool(exec, 'persist-fail', { command: 'uptime' }))
      .rejects.toThrow('persist failed')
    expect(bridge._writeCommand).not.toHaveBeenCalled()
  })

  it('recordStep 原地追加:完成回调拿到全部步骤,不被旧快照覆盖', async () => {
    const turn = makeTurn()
    // G01:recordStep 按绑定 turn 的 callbacks 回调(收集快照)
    const snapshots = turnStepSnapshots(turn)
    const ctx = makeCtx(turn, makeBridge(), makeCallbacks())
    const tools = createBoundTerminalTools(ctx)
    const exec = findTool(tools, 'execute_bound_terminal')

    await callTool(exec, 'c1', { command: 'ls /a' })
    await callTool(exec, 'c2', { command: 'ls /b' })

    // 每条命令在下发边界先持久化 executing、完成后原位替换；最后快照含 2 步。
    expect(snapshots.length).toBe(4)
    const last = snapshots[snapshots.length - 1]
    expect(last.length).toBe(2)
    // turn.steps 同一数组仍在增长(闭包共享)
    expect(turn.steps.length).toBe(2)
  })

  it('G01:旧轮(cancelled)的迟到结果不写入、不回调', async () => {
    const turn = makeTurn()
    const snapshots = turnStepSnapshots(turn)
    const bridge = makeBridge()
    const ctx = makeCtx(turn, bridge, makeCallbacks())
    const tools = createBoundTerminalTools(ctx)
    const exec = findTool(tools, 'execute_bound_terminal')

    // 模拟:工具在锁内执行中途,轮被取消(新任务已启动)
    const bridgeLate = makeBridge({
      output: '旧主机迟到输出',
    })
    // 直接构造迟到场景:turn 已 cancelled 时完成执行
    await callTool(exec, 'c1', { command: 'uptime' })
    expect(turn.steps.length).toBe(1)
    expect(snapshots.length).toBe(2) // executing + verified completion

    // 取消轮后再次调用(模拟旧 toolCall 迟到完成的结果记录路径):
    // execute 入口即拒,且不产生任何新步骤/回调
    turn.cancelled = true
    const r2 = await callTool(exec, 'c2', { command: 'ls /late' })
    expect(r2.details.error).toBe('no_bound_terminal')
    expect(turn.steps.length).toBe(1) // 无新步骤
    expect(snapshots.length).toBe(2)  // 无新回调
    void bridgeLate
  })

  it('预算本轮从 0 起:恢复已有 3 步 + maxSteps=2 时,第 3 条命令被拒', async () => {
    // R01 旧 bug:executedCommandCount 初始化 0 却减旧步骤数,连 5 次都放行
    const turn = makeTurn({
      maxSteps: 2,
      steps: [
        { stepNumber: 1, plan: '', command: 'ls', observation: '', status: 'done' },
        { stepNumber: 2, plan: '', command: 'ls', observation: '', status: 'done' },
        { stepNumber: 3, plan: '', command: 'ls', observation: '', status: 'done' },
      ],
    })
    const callbacks = makeCallbacks()
    const tools = createBoundTerminalTools(makeCtx(turn, makeBridge(), callbacks))
    const exec = findTool(tools, 'execute_bound_terminal')

    // 本轮预算 2:前两条放行(步号从 4 开始 —— 全局单调)
    const r1 = await callTool(exec, 'c1', { command: 'ls /1' })
    const r2 = await callTool(exec, 'c2', { command: 'ls /2' })
    expect(r1.details.blocked).toBeUndefined()
    expect(r2.details.blocked).toBeUndefined()

    // 第 3 条:预算耗尽
    const r3 = await callTool(exec, 'c3', { command: 'ls /3' })
    expect(r3.details.error).toBe('budget_exhausted')
    expect(r3.terminate).toBe(true)
    expect(turn.budgetExhausted).toBe(true)
  })

  it('blocked 命令也消耗预算', async () => {
    const turn = makeTurn({ maxSteps: 1, allowWrite: false })
    const callbacks = makeCallbacks()
    const tools = createBoundTerminalTools(makeCtx(turn, makeBridge(), callbacks))
    const exec = findTool(tools, 'execute_bound_terminal')

    // 第 1 条:读模式下写命令 → blocked,消耗预算
    const r1 = await callTool(exec, 'c1', { command: 'touch /tmp/x' })
    expect(r1.details.blocked).toBe(true)

    // 第 2 条:预算已耗尽
    const r2 = await callTool(exec, 'c2', { command: 'ls' })
    expect(r2.details.error).toBe('budget_exhausted')
  })
})

describe('R01 停止后工具拒绝执行', () => {
  it('turn.stopped 后 execute 拒绝下发且 terminate', async () => {
    const turn = makeTurn()
    const bridge = makeBridge()
    const callbacks = makeCallbacks()
    const tools = createBoundTerminalTools(makeCtx(turn, bridge, callbacks))
    const exec = findTool(tools, 'execute_bound_terminal')

    turn.stopped = true // stop() 直改 turn 对象(R01 旧 bug:闭包读不到)
    const r = await callTool(exec, 'c1', { command: 'ls' })
    expect(r.details.error).toBe('no_bound_terminal')
    expect(r.terminate).toBe(true)
    expect(bridge._writeCommand).not.toHaveBeenCalled()
  })

  it('断线后拒绝执行', async () => {
    const turn = makeTurn()
    const bridge = makeBridge({ connected: false })
    const callbacks = makeCallbacks()
    const tools = createBoundTerminalTools(makeCtx(turn, bridge, callbacks))
    const exec = findTool(tools, 'execute_bound_terminal')

    const r = await callTool(exec, 'c1', { command: 'ls' })
    expect(r.details.error).toBe('no_bound_terminal')
  })
})

// ================================================================
//  R06/R07:错误分类与真实结果
// ================================================================

describe('R07 读取工具总上限', () => {
  it(`连续 ${READ_CALLS_LIMIT} 次后拒绝,且终止轮次`, async () => {
    const turn = makeTurn()
    const callbacks = makeCallbacks()
    const tools = createBoundTerminalTools(makeCtx(turn, makeBridge(), callbacks))
    const read = findTool(tools, 'read_bound_terminal_context')

    for (let i = 0; i < READ_CALLS_LIMIT; i++) {
      const r = await callTool(read, `read-${i}`, {})
      expect(r.details.error).toBeUndefined()
    }
    const over = await callTool(read, `read-${READ_CALLS_LIMIT}`, {})
    expect(over.details.error).toBe('read_limit_exhausted')
    expect(over.terminate).toBe(true)
    expect(turn.readLimitExhausted).toBe(true)
  })

  it('重复 toolCallId 被跳过且不计入读取上限', async () => {
    const turn = makeTurn()
    const callbacks = makeCallbacks()
    const tools = createBoundTerminalTools(makeCtx(turn, makeBridge(), callbacks))
    const read = findTool(tools, 'read_bound_terminal_context')

    await callTool(read, 'same-id', {})
    const dup = await callTool(read, 'same-id', {})
    expect(dup.details.skipped).toBe(true)
    expect(turn.readCallsUsed).toBe(1)
  })
})

describe('R07 未知写结果屏障(跨 toolCallId)', () => {
  it('写命令超时(fidelity=timedOut)进入屏障;换 toolCallId 重试同一命令被拒', async () => {
    const turn = makeTurn({ allowWrite: true })
    // 明确无完成标记,即使只返回了部分输出也不能判定结束。
    const bridge = makeBridge({ output: '部分输出', duration: 29_990, completion: 'timedOut' })
    const callbacks = makeCallbacks()
    const tools = createBoundTerminalTools(makeCtx(turn, bridge, callbacks))
    const exec = findTool(tools, 'execute_bound_terminal')

    const r1 = await callTool(exec, 'c1', { command: 'systemctl restart nginx' })
    expect(r1.details.fidelity).toBe('timedOut')
    expect(r1.content[0].text).toContain('后续 Agent 命令被隔离')
    expect(turn.unknownWriteCommands.has('systemctl restart nginx')).toBe(true)

    // 换 toolCallId 重试同一命令 → 屏障拦截(R07 旧 bug:无产品级阻断)
    const r2 = await callTool(exec, 'c2', { command: 'systemctl restart nginx' })
    expect(r2.details.error).toBe('unknown_write_barrier')
    expect(r2.terminate).toBe(true)
    expect(bridge._writeCommand).toHaveBeenCalledTimes(1)
  })

  it('只读命令超时也隔离整个真实终端,但只读上下文仍可查看', async () => {
    const turn = makeTurn()
    const bridge = makeBridge({ output: '部分输出', completion: 'timedOut' })
    const callbacks = makeCallbacks()
    const tools = createBoundTerminalTools(makeCtx(turn, bridge, callbacks))
    const exec = findTool(tools, 'execute_bound_terminal')

    await callTool(exec, 'c1', { command: 'cat /etc/os-release' })
    const second = await callTool(exec, 'c2', { command: 'uptime' })
    expect(second.details.error).toBe('terminal_result_unverified')
    expect(bridge._writeCommand).toHaveBeenCalledTimes(1)
    const read = findTool(tools, 'read_bound_terminal_context')
    expect((await callTool(read, 'read', {})).details.error).toBeUndefined()
  })

  it('换轮/换命令/换 bridge 仍隔离同一 session;新 session 可继续', async () => {
    const first = makeTurn({ allowWrite: true })
    const bridge = makeBridge({ output: 'x', completion: 'timedOut' })
    const callbacks = makeCallbacks()
    const exec1 = findTool(createBoundTerminalTools(makeCtx(first, bridge, callbacks)), 'execute_bound_terminal')
    await callTool(exec1, 'c1', { command: 'touch /tmp/a' })
    expect(first.unknownWriteCommands.size).toBe(1)

    const second = makeTurn()
    // 同 bridge 的新轮:与模型所选命令字符串无关。
    const exec2 = findTool(createBoundTerminalTools(makeCtx(second, bridge, callbacks)), 'execute_bound_terminal')
    expect((await callTool(exec2, 'c2', { command: 'uptime' })).details.error).toBe('terminal_result_unverified')
    expect(bridge._writeCommand).toHaveBeenCalledTimes(1)
    const otherTabBridge = makeBridge()
    otherTabBridge.getTerminalLockKey = () => bridge.getTerminalLockKey()
    const execOther = findTool(createBoundTerminalTools(makeCtx(makeTurn(), otherTabBridge, callbacks)), 'execute_bound_terminal')
    expect((await callTool(execOther, 'other-tab', { command: 'df -h' })).details.error).toBe('terminal_result_unverified')
    expect(otherTabBridge._writeCommand).not.toHaveBeenCalled()

    // 新底层会话持有新 key,不会被旧连接的屏障污染。
    const fresh = makeBridge()
    const exec3 = findTool(createBoundTerminalTools(makeCtx(makeTurn(), fresh, callbacks)), 'execute_bound_terminal')
    expect((await callTool(exec3, 'c3', { command: 'uptime' })).details.fidelity).toBe('verified')
  })
})

describe('R06/R07 保真度分类', () => {
  it('PTY 控制字节在发送前拒绝,即使读写权限已开启', async () => {
    const turn = makeTurn({ allowWrite: true })
    const bridge = makeBridge()
    const exec = findTool(createBoundTerminalTools(makeCtx(turn, bridge, makeCallbacks())), 'execute_bound_terminal')
    const result = await callTool(exec, 'control-byte', { command: 'printf safe\rprintf unsafe' })
    expect(result.details.blocked).toBe(true)
    expect(bridge._writeCommand).not.toHaveBeenCalled()
  })

  it('收到完成标记后:fidelity=verified,输出及真实退出码', async () => {
    const turn = makeTurn()
    const bridge = makeBridge({ output: 'Ubuntu 22.04 LTS', duration: 800 })
    const callbacks = makeCallbacks()
    const tools = createBoundTerminalTools(makeCtx(turn, bridge, callbacks))
    const exec = findTool(tools, 'execute_bound_terminal')

    const r = await callTool(exec, 'c1', { command: 'cat /etc/os-release' })
    expect(r.details.fidelity).toBe('verified')
    expect(r.content[0].text).toContain('Ubuntu 22.04 LTS')
    expect(r.content[0].text).toContain('退出码: 0')
  })

  it('执行期间断线:无结束标记,fidelity=disconnected,不 done', async () => {
    const turn = makeTurn()
    // 执行中断线:只有半截输出，没有结束标记。
    let connected = true
    const bridge = {
      isConnected: () => connected,
      isDisposed: () => false,
      getTerminalLockKey: () => ({ fakeSession: true }),
      getTerminalContext: () => null,
      executeAgentCommand: async () => {
        connected = false // 执行期间断线
        return { command: 'ls /', output: '半截输出', duration: 1000, completion: 'disconnected', commandSent: true }
      },
      dispose: () => {},
    } as unknown as TerminalBridge
    const callbacks = makeCallbacks()
    const ctx = makeCtx(turn, bridge, callbacks)
    const tools = createBoundTerminalTools(ctx)
    const exec = findTool(tools, 'execute_bound_terminal')

    const r = await callTool(exec, 'c1', { command: 'ls /' })
    expect(r.details.fidelity).toBe('disconnected')
    expect(turn.steps[0]?.status).toBe('executing') // 可能已下发但结束未验证，恢复门据此禁止重放
  })

  it('超长输出被截断且截断可见', async () => {
    const turn = makeTurn()
    const bridge = makeBridge({ output: 'x'.repeat(10_000), duration: 100 })
    const callbacks = makeCallbacks()
    const tools = createBoundTerminalTools(makeCtx(turn, bridge, callbacks))
    const exec = findTool(tools, 'execute_bound_terminal')

    const r = await callTool(exec, 'c1', { command: 'cat /big' })
    expect(r.details.truncated).toBe(true)
    expect(r.content[0].text).toContain('输出已截断')
  })
})

// ================================================================
//  R07:跨 tab 终端互斥
// ================================================================

describe('R07 跨 tab 终端互斥(共用同一 bridge)', () => {
  it('两个工具上下文共用同一 bridge:命令串行,无交错', async () => {
    const events: string[] = []
    let inFlight = 0
    let peak = 0
    const lockKey = { fakeSession: true }
    const bridge = {
      isConnected: () => true,
      isDisposed: () => false,
      getTerminalLockKey: () => lockKey,
      getTerminalContext: () => null,
      executeAgentCommand: async (cmd: string) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        events.push(`start:${cmd}`)
        await new Promise((r) => setTimeout(r, 30))
        events.push(`end:${cmd}`)
        inFlight--
        return { command: cmd, output: 'ok', duration: 30, completion: 'verified', commandSent: true, exitCode: 0 }
      },
      dispose: () => {},
    } as unknown as TerminalBridge

    // 两个 tab(不同 turn,同一 bridge);命令用白名单只读命令
    const turnA = makeTurn()
    const turnB = makeTurn()
    const cbA = makeCallbacks()
    const cbB = makeCallbacks()
    const execA = findTool(createBoundTerminalTools(makeCtx(turnA, bridge, cbA)), 'execute_bound_terminal')
    const execB = findTool(createBoundTerminalTools(makeCtx(turnB, bridge, cbB)), 'execute_bound_terminal')

    await Promise.all([
      callTool(execA, 'a1', { command: 'uptime' }),
      callTool(execB, 'b1', { command: 'df -h' }),
    ])

    // 串行:peak 并发 = 1;事件成对且有序
    expect(peak).toBe(1)
    expect(events).toEqual(['start:uptime', 'end:uptime', 'start:df -h', 'end:df -h'])
  })

  it('排队期间取消:直接退出,不执行命令', async () => {
    const lockKey = { fakeSession: true }
    const writeCalls: string[] = []
    let enteredFirst!: () => void
    let releaseFirst!: () => void
    const firstEntered = new Promise<void>((resolve) => { enteredFirst = resolve })
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const bridge = {
      isConnected: () => true,
      isDisposed: () => false,
      getTerminalLockKey: () => lockKey,
      getTerminalContext: () => null,
      executeAgentCommand: async (cmd: string) => {
        writeCalls.push(cmd)
        if (cmd === 'uptime') {
          enteredFirst()
          await firstGate
        }
        return { command: cmd, output: 'ok', duration: 1, completion: 'verified', commandSent: true, exitCode: 0 }
      },
      dispose: () => {},
    } as unknown as TerminalBridge

    const turn = makeTurn()
    const callbacks = makeCallbacks()
    const tools = createBoundTerminalTools(makeCtx(turn, bridge, callbacks))
    const exec = findTool(tools, 'execute_bound_terminal')

    const ac = new AbortController()
    // 第一条由显式门持续占锁；第二条排队后取消（不依赖墙钟时序）。
    let firstFinished = false
    const first = callTool(exec, 'c1', { command: 'uptime' }).then(() => { firstFinished = true })
    await firstEntered
    const second = callTool(exec, 'c2', { command: 'df -h' }, ac.signal).catch((e: Error) => e.message)
    ac.abort()
    const secondResult = await second
    expect(firstFinished).toBe(false) // 等锁时取消无需等待第一条的远端结果
    // 取消的排队者不能把锁链从 Map 提前删除；第三条仍须排在第一条之后。
    const third = callTool(exec, 'c3', { command: 'whoami' })
    await Promise.resolve()
    expect(writeCalls).toEqual(['uptime'])
    releaseFirst()
    await first
    await third

    expect(writeCalls).toEqual(['uptime', 'whoami'])
    expect(secondResult).toBeTruthy() // 返回拒绝消息,不悬挂
  })
})

// ================================================================
//  R06:工具结果的消息契约(details 字段)
// ================================================================

describe('R06 工具 details 契约(runtime 事件映射依赖)', () => {
  it('成功执行带 command/stepNumber/duration/fidelity', async () => {
    const turn = makeTurn()
    const bridge = makeBridge({ output: 'ok', duration: 123 })
    const callbacks = makeCallbacks()
    const tools = createBoundTerminalTools(makeCtx(turn, bridge, callbacks))
    const exec = findTool(tools, 'execute_bound_terminal')

    const r = await callTool(exec, 'c1', { command: 'uptime' })
    expect(r.details.command).toBe('uptime')
    expect(r.details.stepNumber).toBe(1)
    expect(r.details.duration).toBe(123)
    expect(r.details.fidelity).toBe('verified')
  })

  it('blocked 带 blocked/reason/command/stepNumber', async () => {
    const turn = makeTurn()
    const callbacks = makeCallbacks()
    const tools = createBoundTerminalTools(makeCtx(turn, makeBridge(), callbacks))
    const exec = findTool(tools, 'execute_bound_terminal')

    const r = await callTool(exec, 'c1', { command: 'rm -rf /' })
    expect(r.details.blocked).toBe(true)
    expect(typeof r.details.reason).toBe('string')
    expect(r.details.stepNumber).toBe(1)
  })
})
