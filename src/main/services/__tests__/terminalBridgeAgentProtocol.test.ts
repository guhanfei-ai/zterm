import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TerminalBridge, type AnyTerminalSession } from '../terminalBridge'
import { TerminalOutputBuffer } from '../terminalOutputBuffer'
import { createBoundTerminalTools, type PiToolTurnState } from '../piAgentTools'
import { prepareBuiltinRead } from '../agentReadTools'
import { TEST_SANDBOX } from '../../../test/setup'

/** Only an in-memory terminal: never starts a shell, SSH connection or service. */
function fakeTerminal(options?: { answerProbe?: boolean; probeExitCode?: number; autoComplete?: boolean; completeAll?: boolean; exitCode?: number; onProbe?: () => void }) {
  const events = new EventEmitter() as EventEmitter & { connected: boolean; tabId: string; sessionMeta: object; getRecentOutput: () => string; write: (data: string) => void }
  events.connected = true
  events.tabId = `agent-protocol-${Math.random()}`
  events.sessionMeta = { source: 'direct', displayName: 'test' }
  const buffer = new TerminalOutputBuffer()
  events.on('data', (value: Buffer | string) => buffer.push(String(value)))
  events.getRecentOutput = () => buffer.recent(200)
  Object.assign(events, {
    beginAgentOutput: () => buffer.beginAgentOutput(), endAgentOutput: () => buffer.endAgentOutput(),
    getRecentOutputForAgent: (lines: number) => buffer.recent(lines, false),
  })
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
        events.emit('data', Buffer.from(`\r\n__ZTERM_AGENT_BEGIN_${done[1]}__`))
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
  it.runIf(process.platform !== 'win32')('真实 POSIX 包装执行复杂引号查询，回显模板不能制造搜索命中', async () => {
    const root = mkdtempSync(join(TEST_SANDBOX.tmp, 'protocol-read-'))
    const marker = join(root, 'injected')
    const path = join(root, "file' space $HOME `literal`.txt")
    const query = "ssh 'literal' $HOME `printf unintended` $(touch injected)"
    writeFileSync(path, query + '\nordinary\n')
    const fake = fakeTerminal()
    fake.events.write = (input) => {
      fake.events.emit('data', '\x1b[32mroot#\x1b[0m ' + input.replace(/(.{40})/g, '$1\r\n'))
      const output = execFileSync('/bin/sh', ['-c', input], { cwd: root, encoding: 'utf8', timeout: 1000 })
      fake.events.emit('data', Buffer.from(output))
    }
    const command = prepareBuiltinRead('search_bound_text', { path, query }).command
    const result = await fake.bridge.executeAgentCommand(command, 2000)
    expect(result).toMatchObject({ completion: 'verified', exitCode: 0 })
    expect(result.output).toContain('1:' + query)
    expect(result.output).not.toMatch(/\*\/\.ssh|__ZTERM_AGENT|command sh|root#|\x1b/)
    expect(existsSync(marker)).toBe(false)
    const noMatch = await fake.bridge.executeAgentCommand(prepareBuiltinRead('search_bound_text', { path, query: '.ssh' }).command, 2000)
    expect(noMatch.output).not.toContain('.ssh')
    expect(noMatch.output).not.toContain('FILE ')
  })
  it('窄终端折行回显、ANSI 和前后提示符不会污染真实结果', async () => {
    const fake = fakeTerminal()
    const pending = fake.bridge.executeAgentCommand('grep ssh /etc/hosts', 1000)
    await vi.waitFor(() => expect(fake.writes).toHaveLength(2))
    const input = fake.writes[1]
    const nonce = input.match(/'__ZTERM_AGENT_END_' '([a-f0-9]{32})__'/)![1]
    // 输入回显被硬折行，里面也包含关键词与分段协议字符串。
    fake.events.emit('data', '\x1b[32mroot#\x1b[0m ' + input.replace(/(.{40})/g, '$1\r\n'))
    const fold = (value: string): string => value.slice(0, 39) + '\r\n' + value.slice(39)
    const stream = `\r\n${fold('__ZTERM_AGENT_BEGIN_' + nonce + '__')}\r\n\x1b[32m真实结果\x1b[0m\r\n${fold('__ZTERM_AGENT_END_' + nonce + '__')}:0\r\nroot# `
    // 包含中文 UTF-8、ANSI 和标记的任意分块。
    const bytes = Buffer.from(stream)
    for (let i = 0; i < bytes.length; i += 3) fake.events.emit('data', bytes.subarray(i, i + 3))
    const result = await pending
    expect(result).toMatchObject({ completion: 'verified', exitCode: 0, output: '真实结果' })
    expect(result.output).not.toMatch(/grep|ssh|root#|__ZTERM|\x1b/)
  })

  it('结束标记缺少开始边界时拒绝验证；退出码完整换行前不能提前收尾', async () => {
    const missing = fakeTerminal()
    const rejected = missing.bridge.executeAgentCommand('printf value', 80)
    await vi.waitFor(() => expect(missing.writes).toHaveLength(2))
    const nonce = missing.writes[1].match(/'__ZTERM_AGENT_END_' '([a-f0-9]{32})__'/)![1]
    missing.events.emit('data', `echoed command\r\n__ZTERM_AGENT_END_${nonce}__:0\r\n`)
    expect(await rejected).toMatchObject({ completion: 'timedOut', output: '', commandSent: true })

    const split = fakeTerminal()
    let settled = false
    const pending = split.bridge.executeAgentCommand('missing-query', 1000).then((result) => { settled = true; return result })
    await vi.waitFor(() => expect(split.writes).toHaveLength(2))
    const token = split.writes[1].match(/'__ZTERM_AGENT_END_' '([a-f0-9]{32})__'/)![1]
    split.events.emit('data', `\r\n__ZTERM_AGENT_BEGIN_${token}__\r\nquery missing\r\n__ZTERM_AGENT_END_${token}__:1`)
    await Promise.resolve()
    expect(settled).toBe(false)
    split.events.emit('data', '27\r\n')
    expect(await pending).toMatchObject({ completion: 'verified', exitCode: 127, output: 'query missing' })
  })

  it('同一真实终端的新 bridge 仍能读取最近查询结果，独立于旧屏幕缓冲', async () => {
    const fake = fakeTerminal({ completeAll: true })
    Object.assign(fake.events, { currentHost: { host: 'first.test', port: 22, username: 'test' },
      verifiedHostKey: { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:first' } })
    for (let i = 0; i < 7; i++) await fake.bridge.executeAgentCommand('printf result', 1000)
    const another = new TerminalBridge(fake.events as unknown as AnyTerminalSession)
    const history = another.getTerminalContext().recentAgentResults
    expect(history).toHaveLength(6)
    expect(history?.every((item) => item.output === '命令输出' && item.exitCode === 0)).toBe(true)
    expect(another.getTerminalContext().agentRecentOutput).toBe('')
    expect(another.getTerminalContext().recentOutput).toContain('__ZTERM_AGENT_')
    Object.assign(fake.events, { currentHost: { host: 'second.test', port: 22, username: 'test' } })
    expect(another.getTerminalContext().recentAgentResults).toEqual([])
  })
  it('按发送区间清洗上下文，折行回显消失，用户的同名文本和查询结果保留', async () => {
    const fake = fakeTerminal()
    fake.events.emit('data', '\x1b[32mmanual __ZTERM_AGENT_BEGIN_example__\x1b[0m\r\n')
    const pending = fake.bridge.executeAgentCommand('printf result', 1000)
    await vi.waitFor(() => expect(fake.writes).toHaveLength(2))
    fake.events.emit('data', fake.writes[1].replace(/(.{40})/g, '$1\r\n'))
    fake.complete('query __ZTERM_AGENT_BEGIN_example__')
    await pending
    fake.events.emit('data', 'after\r\n')
    const context = new TerminalBridge(fake.events as unknown as AnyTerminalSession).getTerminalContext()
    expect(context.agentRecentOutput).toBe('manual __ZTERM_AGENT_BEGIN_example__\nafter\n')
    expect(context.agentRecentOutput).not.toContain('command sh')
    expect(context.recentAgentResults?.[0].output).toBe('query __ZTERM_AGENT_BEGIN_example__')
    expect(context.recentOutput.replace(/[\r\n]/g, '')).toContain('command sh')
  })

  it('未验证的发送区间不把迟到协议或输出升级为模型历史', async () => {
    const fake = fakeTerminal()
    fake.events.emit('data', 'before\n')
    const pending = fake.bridge.executeAgentCommand('printf pending', 80)
    await vi.waitFor(() => expect(fake.writes).toHaveLength(2))
    fake.events.emit('data', 'late echo\r\n')
    expect(await pending).toMatchObject({ completion: 'timedOut' })
    fake.events.emit('data', '__ZTERM_AGENT_END_late__\r\n')
    expect(fake.bridge.getTerminalContext().agentRecentOutput).toBe('before\n')
    expect(fake.bridge.getTerminalContext().recentOutput).toContain('__ZTERM_AGENT_END_late__')
  })

  it.runIf(process.platform !== 'win32')('真实文件查询经过完整完成协议后仍保留元数据，回显不进入模型上下文', async () => {
    const root = mkdtempSync(join(TEST_SANDBOX.tmp, 'file-protocol-'))
    const path = join(root, "file' space $HOME `literal`.txt")
    writeFileSync(path, 'first\n你好\nthird\n')
    const fake = fakeTerminal()
    const sizes: number[] = []
    fake.events.write = (input) => {
      sizes.push(...input.split('\n').map((line) => Buffer.byteLength(line)))
      fake.events.emit('data', input.replace(/(.{40})/g, '$1\r\n'))
      const output = execFileSync('/bin/sh', ['-c', input], { cwd: root, encoding: 'utf8', timeout: 3000 })
      fake.events.emit('data', Buffer.from(output))
    }
    const turn: PiToolTurnState = {
      running: true, stopped: false, cancelled: false, maxSteps: 25,
      commandsUsed: 0, readCallsUsed: 0, budgetExhausted: false, readLimitExhausted: false,
      uncertainResult: false, steps: [], allowWrite: false, boundHost: 'test',
      executedToolCallIds: new Set(), unknownWriteCommands: new Set(),
      callbacks: { emitMessage() {}, emitStateChange() {}, getTerminalContext: () => null, onStepComplete() {} },
    }
    const tools = createBoundTerminalTools({ bridge: fake.bridge, turn })
    const file = tools.find((tool) => tool.name === 'read_bound_file')!
    const result = await file.execute('file', { path, start_line: 2, max_lines: 1 }, undefined, undefined, {} as never)
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ status: 'ok',
      data: { text: '2:你好\n', firstLine: 2, lastLine: 2, totalLines: 3, nextStartLine: 3 } })
    expect(fake.bridge.getTerminalContext().agentRecentOutput).toBe('')
    expect(fake.bridge.getTerminalContext().recentAgentResults?.[0]).toMatchObject({ output: '2:你好\n', truncated: true })
    expect(turn.steps.at(-1)?.commandOutput).toBe('2:你好\n')
    // 常见 Linux PTY 的规范输入行有 4096 字节上限，查询模板不能挤满一行。
    expect(Math.max(...sizes)).toBeLessThan(4096)
  })
  it.runIf(process.platform !== 'win32')('超长且含引号的命令按物理行分段，shell 参数仍保持原样', async () => {
    const fake = fakeTerminal()
    const text = "single' $HOME `literal` 中文".repeat(400)
    let maxLineBytes = 0
    fake.events.write = (input) => {
      maxLineBytes = Math.max(maxLineBytes, ...input.split('\n').map((line) => Buffer.byteLength(line)))
      fake.events.emit('data', execFileSync('/bin/sh', ['-c', input], { encoding: 'utf8', timeout: 3000 }))
    }
    const quoted = "'" + text.replace(/'/g, "'\\''") + "'"
    const result = await fake.bridge.executeAgentCommand("printf '%s' " + quoted, 4000)
    expect(result).toMatchObject({ completion: 'verified', exitCode: 0, output: text })
    expect(maxLineBytes).toBeLessThan(4096)
  })
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
