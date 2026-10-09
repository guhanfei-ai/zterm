import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { TerminalBridge, type AnyTerminalSession } from '../terminalBridge'
import { createBoundTerminalTools, type PiToolTurnState } from '../piAgentTools'

/** Only an in-memory terminal: never starts a shell, SSH connection or service. */
function fakeTerminal(options?: { answerProbe?: boolean; probeExitCode?: number; autoComplete?: boolean; completeAll?: boolean; exitCode?: number; onProbe?: () => void }) {
  const events = new EventEmitter() as EventEmitter & { connected: boolean; tabId: string; sessionMeta: object; getRecentOutput: () => string; write: (data: string) => void }
  events.connected = true
  events.tabId = `agent-protocol-${Math.random()}`
  events.sessionMeta = { source: 'direct', displayName: 'test' }
  events.getRecentOutput = () => ''
  const writes: string[] = []
  let finish: ((output?: string) => void) | undefined
  events.write = (input) => {
    writes.push(input)
    const ready = input.match(/'__ZTERM_AGENT_READY_' '([a-f0-9]{32})__'/)
    if (ready && options?.answerProbe !== false) {
      options?.onProbe?.()
      events.emit('data', Buffer.from(`\r\n__ZTERM_AGENT_READY_${ready[1]}__:${options?.probeExitCode ?? 37}\r\n`))
    }
    const done = input.match(/'__ZTERM_AGENT_END_' '([a-f0-9]{32})__'/)
    if (done) {
      finish = (output = '命令输出') => {
        // Split the UTF-8 stream across chunks, as a real PTY/SSH channel may.
        events.emit('data', Buffer.from(`\r\n${output}\r\n__ZTERM_AGENT_END_${done[1].slice(0, 12)}`))
        events.emit('data', Buffer.from(`${done[1].slice(12)}__:${options?.exitCode ?? 0}\r\n`))
      }
      if (options?.completeAll || options?.autoComplete && writes.length === 2) finish()
    }
  }
  return { bridge: new TerminalBridge(events as unknown as AnyTerminalSession), events, writes, complete: (text?: string) => finish?.(text) }
}

describe('Pi Agent 专用终端完成协议', () => {
  it('真实 Pi 工具在探测中降权时零下发，随后仍可查询同一终端', async () => {
    const turn: PiToolTurnState = {
      running: true, stopped: false, cancelled: false, maxSteps: 25,
      commandsUsed: 0, readCallsUsed: 0, budgetExhausted: false, readLimitExhausted: false,
      uncertainResult: false, steps: [], allowWrite: true, boundHost: 'test',
      executedToolCallIds: new Set(), unknownWriteCommands: new Set(),
      callbacks: { emitMessage() {}, emitStateChange() {}, getTerminalContext: () => null, onStepComplete() {} },
    }
    const fake = fakeTerminal({ completeAll: true, onProbe: () => { turn.allowWrite = false } })
    const tools = createBoundTerminalTools({ bridge: fake.bridge, turn })
    const tool = tools[1]
    const rejected = await tool.execute('write-1', { command: 'touch /test-marker' }, undefined, undefined, {} as never)
    expect(rejected.details).toMatchObject({ blocked: true })
    expect(fake.writes).toHaveLength(1)
    expect(fake.writes.some((line) => line.includes('touch /test-marker'))).toBe(false)
    expect(turn.steps.at(-1)?.status).toBe('blocked')
    const read = tools.find((item) => item.name === 'read_bound_system')!
    const query = await read.execute('read-2', {}, undefined, undefined, {} as never)
    expect(query.details).toMatchObject({ fidelity: 'verified', exitCode: 0 })
    expect(turn.uncertainResult).toBe(false)
  })
  it('探测等待期间降权后，真实发送边界拒绝业务命令', async () => {
    let allowed = true
    const fake = fakeTerminal({ onProbe: () => { allowed = false } })
    const result = await fake.bridge.executeAgentCommand('touch /test-marker', 1000, undefined, () => allowed)
    expect(result).toMatchObject({ completion: 'aborted', commandSent: false, authorizationDenied: true })
    expect(fake.writes).toHaveLength(1)
    expect(fake.writes[0]).not.toContain('touch /test-marker')
  })
  it('输出静默不等于命令结束：必须等随机完成标记和退出码', async () => {
    const fake = fakeTerminal({ exitCode: 7 })
    let settled = false
    const pending = fake.bridge.executeAgentCommand('printf hello', 1000).then((result) => { settled = true; return result })
    await vi.waitFor(() => expect(fake.writes).toHaveLength(2))
    fake.events.emit('data', Buffer.from('\r\n已输出部分内容\r\n'))
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(settled).toBe(false)
    fake.complete('最后一段输出')
    const result = await pending
    expect(result.completion).toBe('verified')
    expect(result.exitCode).toBe(7)
    expect(result.commandSent).toBe(true)
    expect(result.output).toContain('最后一段输出')
    expect(fake.writes[1]).toContain("sh -c 'printf hello")
    // 用户命令可能不以换行结束；协议须主动起新行打印标记。
    expect(fake.writes[1]).toContain("printf '\\n%s%s:%d\\n'")
    expect(fake.writes[1]).not.toMatch(/__ZTERM_AGENT_END_[a-f0-9]{32}__/)
  })

  it('探测不支持 POSIX 协议时绝不下发用户命令', async () => {
    const fake = fakeTerminal({ answerProbe: false })
    const result = await fake.bridge.executeAgentCommand('touch /test-marker', 30)
    expect(result.completion).toBe('timedOut')
    expect(result.commandSent).toBe(false)
    expect(fake.writes).toHaveLength(1)
    expect(fake.writes[0]).toContain("sh -c 'exit 37'")
    expect(fake.writes[0]).not.toContain('touch /test-marker')
  })

  it('非 POSIX Shell 可打印标记却无法证明退出码时,不下发业务命令', async () => {
    const fake = fakeTerminal({ probeExitCode: 0 })
    const result = await fake.bridge.executeAgentCommand('touch /test-marker', 100)
    expect(result.completion).toBe('unsupported')
    expect(result.commandSent).toBe(false)
    expect(fake.writes).toHaveLength(1)
    expect(fake.writes[0]).not.toContain('touch /test-marker')
  })

  it('大量输出被截断但末尾真实完成标记仍能验证', async () => {
    const fake = fakeTerminal({ autoComplete: true })
    const result = await fake.bridge.executeAgentCommand('cat /large', 1000)
    expect(result.completion).toBe('verified')
    // 同一 session 上每条命令都重探测，防止用户手工切换交互 shell 后沿用旧缓存。
    const second = fake.bridge.executeAgentCommand('cat /another-large', 1000)
    await vi.waitFor(() => expect(fake.writes).toHaveLength(4))
    fake.complete('x'.repeat(70_000))
    expect((await second).output).toContain('[前段输出已截断]')
  })

  it('用户命令已下发而未收到标记:超时和断线都不伪造退出码', async () => {
    const timed = fakeTerminal()
    const timedResult = await timed.bridge.executeAgentCommand('uptime', 35)
    expect(timedResult).toMatchObject({ completion: 'timedOut', commandSent: true })
    expect(timedResult.exitCode).toBeUndefined()

    const closed = fakeTerminal()
    const waiting = closed.bridge.executeAgentCommand('uptime', 1000)
    await vi.waitFor(() => expect(closed.writes).toHaveLength(2))
    closed.events.connected = false
    closed.events.emit('closed')
    const disconnected = await waiting
    expect(disconnected).toMatchObject({ completion: 'disconnected', commandSent: true })
    expect(disconnected.exitCode).toBeUndefined()
  })
})
