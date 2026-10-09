import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, symlinkSync, existsSync, accessSync, constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { TEST_SANDBOX } from '../../../test/setup'
import { activeTerminalToolNames, BUILTIN_READ_TOOL_NAMES, prepareBuiltinRead } from '../agentReadTools'
import { createBoundTerminalTools, resetTerminalLocksForTest, READ_CALLS_LIMIT, type PiToolTurnState } from '../piAgentTools'
import type { TerminalBridge } from '../terminalBridge'
import { createAgentSession, DefaultResourceLoader } from '@earendil-works/pi-coding-agent'
import { buildPiModelSetup } from '../piModelAdapter'

function setup() {
  const turn: PiToolTurnState = {
    running: true, stopped: false, cancelled: false, maxSteps: 25, commandsUsed: 0,
    readCallsUsed: 0, budgetExhausted: false, readLimitExhausted: false, uncertainResult: false,
    steps: [], allowWrite: false, boundHost: 'bound-test-target',
    executedToolCallIds: new Set(), unknownWriteCommands: new Set(),
    callbacks: { emitMessage() {}, emitStateChange() {}, getTerminalContext() { return null }, onStepComplete() {} },
  }
  const execute = vi.fn(async (command: string) => ({
    command, output: 'observed on bound target', exitCode: 0, duration: 2,
    completion: 'verified' as const, commandSent: true,
  }))
  const key = {}
  const bridge = {
    isConnected: () => true, isDisposed: () => false, getTerminalLockKey: () => key,
    executeAgentCommand: execute, getTerminalContext: () => ({ recentOutput: 'existing output' }),
  } as unknown as TerminalBridge
  const tools = createBoundTerminalTools({ turn, bridge })
  const call = (name: string, id: string, params: Record<string, unknown> = {}) =>
    tools.find((tool) => tool.name === name)!.execute(id, params, undefined, undefined, {} as never)
  return { turn, execute, tools, bridge, call }
}

beforeEach(() => resetTerminalLocksForTest())

describe('读模式与读写模式', () => {
  it('真实 Pi SDK 保留执行实现，但读模式不声明也不允许跨工具调用', async () => {
    const root = mkdtempSync(join(TEST_SANDBOX.tmp, 'read-sdk-'))
    const { tools } = setup()
    const modelSetup = await buildPiModelSetup({
      providerType: 'openai-compatible', label: 'test', baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'test', model: 'test-model', enableStreaming: false, reasoningMode: 'auto',
    })
    const loader = new DefaultResourceLoader({
      cwd: root, agentDir: root, settingsManager: modelSetup.settingsManager,
      noExtensions: true, disabledBuiltinExtensions: ['mcp', 'codemode'],
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: 'test read tool exposure', appendSystemPrompt: [],
    })
    await loader.reload()
    const { session } = await createAgentSession({
      ...modelSetup, cwd: root, agentDir: root, resourceLoader: loader,
      noTools: 'builtin', tools: activeTerminalToolNames(true), customTools: tools,
    })
    try {
      session.setActiveToolsByName(activeTerminalToolNames(false))
      expect(session.getActiveToolNames()).toEqual(expect.arrayContaining([...BUILTIN_READ_TOOL_NAMES]))
      expect(session.getActiveToolNames()).not.toContain('execute_bound_terminal')
      expect(session.getCallableToolNames()).not.toContain('execute_bound_terminal')
      expect(session.getToolDefinition('execute_bound_terminal')).toBeDefined()
      for (const builtin of ['bash', 'read', 'write', 'edit']) {
        expect(session.getActiveToolNames()).not.toContain(builtin)
        expect(session.getCallableToolNames()).not.toContain(builtin)
      }
      session.setActiveToolsByName(activeTerminalToolNames(true))
      expect(session.getCallableToolNames()).toContain('execute_bound_terminal')
      session.setActiveToolsByName(activeTerminalToolNames(false))
      expect(session.getCallableToolNames()).not.toContain('execute_bound_terminal')
    } finally {
      session.dispose()
    }
  })

  it('默认只声明上下文与六个读工具，读写模式增加保留的命令入口', () => {
    expect(BUILTIN_READ_TOOL_NAMES).toHaveLength(6)
    expect(activeTerminalToolNames(false)).not.toContain('execute_bound_terminal')
    expect(activeTerminalToolNames(true)).toContain('execute_bound_terminal')
    expect(activeTerminalToolNames(false)).toEqual(expect.arrayContaining([...BUILTIN_READ_TOOL_NAMES]))
  })

  it('后台拒绝读模式的旧通用调用，连只读命令也不能绕过', async () => {
    const { call, execute, turn } = setup()
    const result = await call('execute_bound_terminal', 'old-raw', { command: 'uptime' })
    expect(result.details).toMatchObject({ blocked: true })
    expect(execute).not.toHaveBeenCalled()
    expect(turn.commandsUsed).toBe(1)
  })

  it('读模式实际下发受控查询，记录读取步骤且返回来源信息', async () => {
    const { call, execute, turn } = setup()
    const result = await call('read_bound_system', 'system')
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0][0]).toContain('uname')
    expect(result.details).toMatchObject({ fidelity: 'verified', exitCode: 0 })
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('bound') })
    expect(turn.readCallsUsed).toBe(1)
    expect(turn.commandsUsed).toBe(1)
    expect(turn.steps[0]).toMatchObject({ status: 'done', command: '查看系统概况' })
  })

  it('ss 与 lsof 结果都返回端口字段，格式不认识时保留原始证据', async () => {
    const { call, execute } = setup()
    for (const [index, output] of [
      'tcp LISTEN 0 128 [::]:8080 [::]:* users:(("node",pid=42,fd=3))',
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 42 test 3u IPv6 123 0t0 TCP *:8080 (LISTEN)',
      'unrecognized output format',
    ].entries()) {
      execute.mockResolvedValueOnce({ command: 'socket', output, exitCode: 0, duration: 2,
        completion: 'verified', commandSent: true })
      const result = await call('list_bound_sockets', 'ports-' + index, { local_port: 8080 })
      const item = result.content[0]
      expect(item.type).toBe('text')
      if (item.type !== 'text') throw new Error('missing text result')
      const payload = JSON.parse(item.text)
      if (index < 2) expect(payload.records[0]).toMatchObject({ localPort: 8080, pid: 42, protocol: 'tcp' })
      else {
        expect(payload.records).toBeUndefined()
        expect(payload.output).toContain('unrecognized')
      }
    }
  })

  it('读写模式自动执行，降回读模式后拒绝下一条通用命令', async () => {
    const { call, execute, turn } = setup()
    turn.allowWrite = true
    await call('execute_bound_terminal', 'write', { command: 'touch /tmp/test-mode' })
    turn.allowWrite = false
    expect((await call('execute_bound_terminal', 'revoked', { command: 'uptime' })).details)
      .toMatchObject({ blocked: true })
    await call('list_bound_processes', 'read')
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('排队期间降权阻断通用命令，随后读工具仍可执行', async () => {
    const { call, execute, turn } = setup()
    turn.allowWrite = true
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => { started = resolve })
    execute.mockImplementationOnce(async (command) => {
      started()
      await new Promise<void>((resolve) => { release = resolve })
      return { command, output: 'first', exitCode: 0, duration: 2, completion: 'verified', commandSent: true }
    })
    const first = call('read_bound_system', 'first')
    await entered
    const queued = call('execute_bound_terminal', 'queued', { command: 'touch /tmp/queued' })
    turn.allowWrite = false
    release()
    await first
    expect((await queued).details).toMatchObject({ blocked: true })
    expect(execute).toHaveBeenCalledOnce()
    await call('list_bound_processes', 'next-read')
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('协议探测后的发送边界也会检查最新模式', async () => {
    const { call, execute, turn } = setup()
    turn.allowWrite = true
    execute.mockImplementationOnce(async (command, ...rest: unknown[]) => {
      turn.allowWrite = false
      const authorize = rest[2] as () => boolean
      expect(authorize()).toBe(false)
      return { command, output: '', exitCode: 0, duration: 2, completion: 'verified',
        commandSent: false, authorizationDenied: true }
    })
    expect((await call('execute_bound_terminal', 'probe-revoke', { command: 'touch /tmp/probe' })).details)
      .toMatchObject({ blocked: true })
    expect(turn.uncertainResult).toBe(false)
  })

  it('无效参数、额外命令、主机和提权参数均零下发', async () => {
    const { call, execute } = setup()
    for (const [index, params] of [
      { path: '/etc/hosts', command: 'touch /tmp/bypass' },
      { path: '/etc/hosts', host: 'other-target' },
      { path: '/etc/hosts', sudo: true },
      { path: '/dev/zero' },
      { path: '/etc/shadow' },
      { path: '/tmp/.env' },
      { path: '/etc/hosts', max_lines: 1.5 },
    ].entries()) {
      expect((await call('read_bound_file', 'invalid-' + index, params)).details)
        .toMatchObject({ blocked: true, error: 'invalid_read_parameters' })
    }
    expect(execute).not.toHaveBeenCalled()
  })

  it('无效调用也消耗读取预算；重复调用不执行；停止后不再读取', async () => {
    const { call, execute, turn } = setup()
    await call('read_bound_system', 'same')
    await call('read_bound_system', 'same')
    expect(turn.readCallsUsed).toBe(1)
    turn.readCallsUsed = READ_CALLS_LIMIT - 1
    await call('read_bound_file', 'bad', { path: 'relative' })
    expect((await call('read_bound_system', 'over')).details).toMatchObject({ error: 'read_limit_exhausted' })
    turn.stopped = true
    expect((await call('read_bound_system', 'stopped')).details).toMatchObject({ error: 'no_bound_terminal' })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('读取结果未验证时隔离整个终端，已有输出仍可查看', async () => {
    const { call, execute, turn } = setup()
    execute.mockResolvedValueOnce({ command: 'read', output: 'partial', exitCode: undefined,
      duration: 2, completion: 'timedOut', commandSent: true } as never)
    await call('read_bound_system', 'unknown')
    expect(turn.uncertainResult).toBe(true)
    expect((await call('list_bound_processes', 'next')).details)
      .toMatchObject({ error: 'terminal_result_unverified' })
    expect((await call('read_bound_terminal_context', 'context')).details).not.toHaveProperty('error')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('持久化 executing 失败时读取零下发，不能吞掉记录错误', async () => {
    const { call, execute, turn } = setup()
    turn.callbacks.onStepComplete = () => { throw new Error('persist failed') }
    await expect(call('read_bound_system', 'persist')).rejects.toThrow('persist failed')
    expect(execute).not.toHaveBeenCalled()
  })
})

describe.runIf(process.platform !== 'win32')('固定查询在真实 POSIX shell 中的输入边界', () => {
  function fixture() {
    // 文件统一归属已有测试沙箱；setup 的 afterAll 会清理，避免触碰用户数据。
    return mkdtempSync(join(TEST_SANDBOX.tmp, 'read-tools-'))
  }
  function run(name: string, params: Record<string, unknown>) {
    const prepared = prepareBuiltinRead(name, params)
    return execFileSync('/bin/sh', ['-c', prepared.command], {
      encoding: 'utf8', timeout: 3000, maxBuffer: 128000,
      cwd: typeof params.path === 'string' ? dirname(params.path) : TEST_SANDBOX.tmp,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }

  it('文件名中的引号、命令替换和分号保持数据，行窗口与末尾窗口正常', () => {
    const root = fixture()
    const marker = join(root, 'injected')
    const path = join(root, "log'$(touch injected);name.txt")
    writeFileSync(path, 'first\nsecond\nthird\n', 'utf8')
    expect(run('read_bound_file', { path, start_line: 2, max_lines: 1 })).toBe('2:second\n')
    expect(run('read_bound_file', { path, from_end: true, max_lines: 1 })).toBe('third\n')
    expect(existsSync(marker)).toBe(false)
  })

  it('字面查询不执行代码，也不跟随目录中的文件符号链接', () => {
    const root = fixture()
    const marker = join(root, 'injected')
    const query = '$(touch ' + marker + '); sensitive? [x]'
    writeFileSync(join(root, 'normal.txt'), query + '\nplain\n', 'utf8')
    writeFileSync(join(root, '.env'), 'PRIVATE_SHOULD_NOT_APPEAR\n', 'utf8')
    const elsewhere = fixture()
    writeFileSync(join(elsewhere, 'hidden.txt'), 'LINK_SHOULD_NOT_APPEAR\n', 'utf8')
    symlinkSync(join(elsewhere, 'hidden.txt'), join(root, 'linked.txt'))
    const output = run('search_bound_text', { path: root, query })
    expect(output).toContain(query)
    expect(output).not.toContain('PRIVATE_SHOULD_NOT_APPEAR')
    expect(output).not.toContain('LINK_SHOULD_NOT_APPEAR')
    expect(existsSync(marker)).toBe(false)
  })

  it('符号链接最终目标的凭据和设备不能通过普通路径绕过', () => {
    const root = fixture()
    const secret = join(root, '.env')
    writeFileSync(secret, 'PRIVATE_SHOULD_NOT_APPEAR\n', 'utf8')
    const link = join(root, 'ordinary.txt')
    symlinkSync(secret, link)
    expect(() => run('read_bound_file', { path: link })).toThrow()
    const deviceLink = join(root, 'device.txt')
    symlinkSync('/dev/zero', deviceLink)
    expect(() => run('read_bound_file', { path: deviceLink })).toThrow()
  })

  it('文件读取源数据有硬上限，不加载完整大文件', () => {
    const root = fixture()
    const path = join(root, 'large.txt')
    writeFileSync(path, 'a'.repeat(100000) + '\nAFTER_LIMIT\n', 'utf8')
    const output = run('read_bound_file', { path, max_lines: 500 })
    expect(output.length).toBeLessThan(66000)
    expect(output).not.toContain('AFTER_LIMIT')
  })

  it('目录、系统和进程查询在真实本地 shell 中可用', () => {
    const root = fixture()
    writeFileSync(join(root, 'visible.txt'), 'example\n', 'utf8')
    expect(run('read_bound_directory', { path: root })).toContain('visible.txt')
    expect(run('read_bound_system', {})).toContain('=== 内存 ===')
    expect(run('list_bound_processes', { pid: process.pid })).toContain(String(process.pid))
  })

  it('搜索明确表达权限与检查范围，不把未读文件当作没有匹配', () => {
    const root = fixture()
    const path = join(root, 'restricted.txt')
    writeFileSync(path, 'needle\n', { encoding: 'utf8', mode: 0o000 })
    // root 测试进程实际可读；按本机有效权限验证，避免制造假的拒绝结果。
    let readable = true
    try { accessSync(path, constants.R_OK) } catch { readable = false }
    if (readable) expect(run('search_bound_text', { path, query: 'needle' })).toContain('needle')
    else expect(() => run('search_bound_text', { path, query: 'needle' })).toThrow()
    expect(run('search_bound_text', { path: root, query: 'missing' })).toContain('搜索范围：已检查')
  })

  it('端口、协议和进程参数不开放过滤表达式或额外参数', () => {
    expect(() => prepareBuiltinRead('list_bound_sockets', { local_port: '8080; touch /tmp/x' })).toThrow()
    expect(() => prepareBuiltinRead('list_bound_sockets', { protocol: 'tcp -K' })).toThrow()
    expect(() => prepareBuiltinRead('list_bound_processes', { pid: NaN })).toThrow()
    expect(() => prepareBuiltinRead('read_bound_file', { path: '/tmp/x\rcommand' })).toThrow()
    expect(prepareBuiltinRead('list_bound_sockets', { local_port: 8080 }).command).toContain("'sport = :8080'")
  })
})
