import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, existsSync, accessSync, constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { TEST_SANDBOX } from '../../../test/setup'
import { activeTerminalToolNames, BUILTIN_READ_TOOL_NAMES, prepareBuiltinRead, readResultText } from '../agentReadTools'
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
    command, output: command.includes('__ZTERM_FILE_V1__')
      ? '__ZTERM_FILE_V1__|3|1|0|0|0|1|1|1|0|0|0|0|3\n1:ok\n' : 'observed on bound target', exitCode: 0, duration: 2,
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
  it('所有失败信封都清除成功退出码与正文截断标志，非零执行错误保留', () => {
    for (const exitCode of [undefined, 0, 2]) {
      const response = JSON.parse(readResultText('read_bound_file', '/sample', { text: '读取失败' }, {
        status: 'error', exitCode, truncated: true, truncationReasons: ['source_bytes'],
        error: { code: 'read_failed', phase: 'content', message: '读取失败' },
      }))
      expect(response).toMatchObject({ status: 'error', exitCode: exitCode === 2 ? 2 : null,
        truncated: false, truncationReasons: [], error: { code: 'read_failed' } })
    }
  })
  it('七个读工具使用同一个返回信封，参数拒绝和执行失败也可解析', async () => {
    const { call, execute } = setup()
    for (const name of ['read_bound_terminal_context', ...BUILTIN_READ_TOOL_NAMES]) {
      const result = await call(name, 'envelope-' + name,
        name === 'search_bound_text' ? { path: '/etc/hosts', query: 'localhost' }
          : name === 'read_bound_file' || name === 'read_bound_directory' ? { path: '/etc/hosts' } : {})
      const item = result.content[0]
      if (item.type !== 'text') throw new Error('missing payload')
      expect(JSON.parse(item.text)).toMatchObject({ version: 1, tool: name, status: 'ok',
        scope: expect.any(String), observedAt: expect.any(String), error: null, truncated: false,
        truncationReasons: [], warnings: expect.any(Array), data: { format: expect.any(String) } })
      expect(JSON.parse(item.text)).toHaveProperty('exitCode')
    }
    const invalid = await call('read_bound_file', 'envelope-invalid', { path: '/dev/zero' })
    const rejected = invalid.content[0]
    if (rejected.type !== 'text') throw new Error('missing rejected payload')
    expect(JSON.parse(rejected.text)).toMatchObject({ status: 'error', exitCode: null, truncated: false,
      truncationReasons: [], error: { code: 'path_denied', phase: 'validation' }, data: { format: 'text' } })
    execute.mockResolvedValueOnce({ command: 'read', output: '路径不是可读普通文件', exitCode: 2,
      duration: 2, completion: 'verified', commandSent: true })
    const failure = await call('read_bound_file', 'envelope-failed', { path: '/not-found' })
    const failed = failure.content[0]
    if (failed.type !== 'text') throw new Error('missing failed payload')
    expect(JSON.parse(failed.text)).toMatchObject({ status: 'error', exitCode: 2, data: { format: 'text' } })
  })
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
      if (index < 2) {
        expect(payload.data.records[0]).toMatchObject({ localPort: 8080, pid: 42, protocol: 'tcp' })
        expect(payload.output).toBeUndefined()
        expect(payload.data.text).toBeUndefined()
      }
      else {
        expect(payload.data.records).toBeUndefined()
        expect(payload.data.text).toContain('unrecognized')
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

  it('终端上下文只向模型返回清洗历史，读取拒绝也有固定错误字段', async () => {
    const { bridge, call, turn } = setup()
    bridge.getTerminalContext = () => ({ recentOutput: '__ZTERM_AGENT_READY_raw__',
      agentRecentOutput: '\x1b[32mmanual\x1b[0m\r\nkept', recentAgentResults: [] } as never)
    const result = await call('read_bound_terminal_context', 'clean-context')
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({
      status: 'ok', exitCode: null, error: null, data: { terminalOutput: 'manual\nkept' } })
    turn.stopped = true
    const failure = await call('read_bound_terminal_context', 'stopped-context')
    expect(JSON.parse((failure.content[0] as { text: string }).text)).toMatchObject({ status: 'error',
      exitCode: null, truncated: false, truncationReasons: [], warnings: [], error: { code: 'no_bound_terminal', phase: 'context' } })
  })

  it('空列表是正常无匹配，捕获缓冲截断与最终字符截断分别保留', async () => {
    const { call, execute } = setup()
    for (const name of ['list_bound_processes', 'list_bound_sockets']) {
      execute.mockResolvedValueOnce({ command: 'query', output: '', exitCode: 0, duration: 1,
        completion: 'verified', commandSent: true })
      const result = await call(name, 'empty-' + name)
      expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ status: 'ok', error: null,
        data: { noMatches: true } })
    }
    execute.mockResolvedValueOnce({ command: 'query', output: 'x'.repeat(9000), exitCode: 0, duration: 1,
      completion: 'verified', commandSent: true, captureTruncated: true } as never)
    const result = await call('read_bound_system', 'truncated-system')
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ truncated: true,
      truncationReasons: ['capture_buffer', 'output_chars'] })
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
  async function read(path: string, params: Record<string, unknown> = {}) {
    const state = setup()
    state.execute.mockImplementationOnce(async (command) => {
      let output: string
      let exitCode = 0
      try { output = execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8', timeout: 3000, maxBuffer: 128000 }) }
      catch (error) {
        const failure = error as { stdout: Buffer; status: number }
        output = String(failure.stdout); exitCode = failure.status
      }
      return { command, output, exitCode, duration: 1, completion: 'verified', commandSent: true }
    })
    const result = await state.call('read_bound_file', 'file', { path, ...params })
    return JSON.parse((result.content[0] as { text: string }).text)
  }
  function queryPath() {
    const root = fixture()
    for (const utility of ['awk', 'od', 'head', 'realpath', 'readlink']) {
      const path = execFileSync('/bin/sh', ['-c', 'command -v ' + utility], { encoding: 'utf8' }).trim()
      if (path) symlinkSync(path, join(root, utility))
    }
    return root
  }
  function stub(root: string, name: string, body: string) {
    const path = join(root, name)
    // 替身独占测试 PATH，不覆盖本机工具或跟随工具链接写入。
    if (existsSync(path)) throw new Error('stub conflicts with existing test utility')
    writeFileSync(path, '#!/bin/sh\n' + body + '\n', { mode: 0o755 })
  }
  async function queryWithPath(root: string, name: string, params: Record<string, unknown> = {}) {
    const state = setup()
    state.execute.mockImplementationOnce(async (command) => {
      const result = spawnSync('/bin/sh', ['-c', command], {
        env: { ...process.env, PATH: root }, cwd: root, encoding: 'utf8', timeout: 3000, maxBuffer: 128000,
      })
      if (result.error || result.status === null) throw result.error ?? new Error('shell did not exit')
      return { command, output: result.stdout + result.stderr, exitCode: result.status,
        duration: 1, completion: 'verified', commandSent: true }
    })
    const result = await state.call(name, 'query', params)
    return JSON.parse((result.content[0] as { text: string }).text)
  }

  it.each([
    ['read_bound_directory', 'ls', {}],
    ['list_bound_processes', 'ps', { name: 'missing' }],
    ['list_bound_sockets', 'ss', { protocol: 'tcp' }],
    ['list_bound_sockets', 'lsof', { protocol: 'all' }],
    ['read_bound_system', 'df', {}],
  ] as const)('%s 的 %s 源失败不会被限量或过滤阶段升级为成功', async (name, utility, params) => {
    const root = queryPath()
    stub(root, utility, 'printf "%s\\n" "query failed" >&2\nexit 23')
    const result = await queryWithPath(root, name, name === 'read_bound_directory' ? { path: root } : params)
    expect(result).toMatchObject({ status: 'error', exitCode: 23, error: { phase: 'execution' } })
    expect(result.data.text).toContain('query failed')
    expect(result.data.text).not.toContain('__ZTERM_QUERY_EXIT_')
  })

  it('文本搜索保留 head 读取失败，不能报告成无命中', async () => {
    const root = fixture()
    for (const utility of ['awk', 'od', 'realpath', 'readlink']) {
      symlinkSync(execFileSync('/bin/sh', ['-c', 'command -v ' + utility], { encoding: 'utf8' }).trim(), join(root, utility))
    }
    stub(root, 'head', 'exit 23')
    const path = join(root, 'source.txt')
    writeFileSync(path, 'needle\n')
    expect(await queryWithPath(root, 'search_bound_text', { path, query: 'needle' })).toMatchObject({
      status: 'error', exitCode: 23, data: { text: expect.stringContaining('文本搜索读取失败') },
    })
  })

  it('正常空端口、无 PID 与名称过滤无命中仍成功，诊断输出的退出 1 不被归为空结果', async () => {
    const root = queryPath()
    stub(root, 'lsof', 'exit 1')
    expect(await queryWithPath(root, 'list_bound_sockets')).toMatchObject({ status: 'ok', exitCode: 0,
      data: { records: [], noMatches: true } })
    stub(root, 'ps', 'printf "%s\\n" "PID PPID USER STAT %CPU %MEM COMMAND"\nexit 1')
    expect(await queryWithPath(root, 'list_bound_processes', { pid: 999999 })).toMatchObject({ status: 'ok',
      exitCode: 0, data: { noMatches: true } })
    writeFileSync(join(root, 'ps'), '#!/bin/sh\nprintf "%s\\n" "permission denied" >&2\nexit 1\n')
    expect(await queryWithPath(root, 'list_bound_processes', { pid: 999999 })).toMatchObject({ status: 'error', exitCode: 1 })
    writeFileSync(join(root, 'lsof'), '#!/bin/sh\nprintf "%s\\n" "permission denied" >&2\nexit 1\n')
    expect(await queryWithPath(root, 'list_bound_sockets')).toMatchObject({ status: 'error', exitCode: 1 })
    writeFileSync(join(root, 'ps'), '#!/bin/sh\nprintf "%s\\n" "PID PPID USER STAT %CPU %MEM COMMAND" "42 1 test S 0 0 other"\n')
    expect(await queryWithPath(root, 'list_bound_processes', { name: 'missing' })).toMatchObject({
      status: 'ok', exitCode: 0, data: { noMatches: true },
    })
  })

  it('限量输出仍消费源的末尾状态，避免大列表触发 SIGPIPE 或掩盖迟到失败', async () => {
    const root = queryPath()
    stub(root, 'ss', 'i=0\nwhile [ "$i" -lt 1000 ]; do printf "%s\\n" "tcp LISTEN 0 128 127.0.0.1:8080 0.0.0.0:*"; i=$((i+1)); done\nexit 0')
    const result = await queryWithPath(root, 'list_bound_sockets', { limit: 3 })
    expect(result).toMatchObject({ status: 'ok', exitCode: 0 })
    expect(result.data.records).toHaveLength(3)
    const path = join(root, 'ss')
    const source = readFileSync(path, 'utf8')
    writeFileSync(path, source.replace('exit 0', 'exit 23'))
    expect(await queryWithPath(root, 'list_bound_sockets', { limit: 3 })).toMatchObject({ status: 'error', exitCode: 23 })
  })

  it('文件名中的引号、命令替换和分号保持数据，行窗口与末尾窗口正常', () => {
    const root = fixture()
    const marker = join(root, 'injected')
    const path = join(root, "log'$(touch injected);name.txt")
    writeFileSync(path, 'first\nsecond\nthird\n', 'utf8')
    expect(run('read_bound_file', { path, start_line: 2, max_lines: 1 }).split('\n').slice(1).join('\n')).toBe('2:second\n')
    expect(run('read_bound_file', { path, from_end: true, max_lines: 1 }).split('\n').slice(1).join('\n')).toBe('third\n')
    expect(existsSync(marker)).toBe(false)
  })

  it('字面查询不执行代码，也不跟随目录中的文件符号链接', () => {
    const root = fixture()
    const marker = join(root, 'injected')
    const query = "single' space $HOME `printf unintended` $(touch " + marker + '); sensitive? [x]'
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

  it('目录最多检查 100 个文件，无匹配项和二进制不会刷出 FILE 噪音', () => {
    const root = fixture()
    for (let index = 0; index < 101; index++) {
      writeFileSync(join(root, String(index).padStart(3, '0') + '.txt'), index === 100 ? 'needle\n' : 'nothing\n')
    }
    const bounded = run('search_bound_text', { path: root, query: 'needle' })
    expect(bounded).toContain('已检查 100 个文件')
    expect(bounded).not.toContain('FILE ')
    expect(bounded).not.toContain('101')
    const binary = join(root, 'binary.db')
    writeFileSync(binary, Buffer.from('needle\x00binary'))
    const result = run('search_bound_text', { path: binary, query: 'needle' })
    expect(result).not.toMatch(/FILE |binary file|二进制|needle/)
  })

  it('搜索保留反斜杠等字面字符和每文件匹配上限，样本后部的 NUL 也会阻止先前命中', () => {
    const path = join(fixture(), 'literal.txt')
    const query = String.raw`你好\t\a $HOME 'literal'`
    writeFileSync(path, 'unrelated\n' + Array.from({ length: 6 }, () => query).join('\n') + '\n')
    const output = run('search_bound_text', { path, query, max_matches: 2 })
    expect(output).toContain('2:' + query)
    expect(output).toContain('3:' + query)
    expect(output).not.toContain('4:' + query)
    writeFileSync(path, query + '\n' + 'x'.repeat(50000) + '\x00')
    expect(run('search_bound_text', { path, query })).not.toContain('FILE ')
  })

  it('目标当前目录可省略 path，符号链接目录按最终路径校验，缺失路径给出工具错误', () => {
    const root = fixture()
    writeFileSync(join(root, 'visible.txt'), 'line\n')
    const current = execFileSync('/bin/sh', ['-c', prepareBuiltinRead('read_bound_directory', {}).command], { cwd: root, encoding: 'utf8' })
    expect(current).toContain('目录：')
    expect(current).toContain('visible.txt')
    const link = join(fixture(), 'directory-link')
    symlinkSync(root, link)
    expect(run('read_bound_directory', { path: link })).toContain('visible.txt')
    try { run('read_bound_file', { path: join(root, 'not-found.txt') }); throw new Error('expected failure') }
    catch (error) {
      expect(String((error as { stdout?: string }).stdout)).toMatch(/目标路径不存在或无法解析|路径不是可读普通文件/)
      expect(String((error as { stderr?: string }).stderr)).not.toMatch(/realpath:|readlink:/)
    }
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

  it('空文件、空行和真实行号越界有不同结果，未换行的末行也计入总行数', async () => {
    const root = fixture()
    const path = join(root, 'text.txt')
    writeFileSync(path, '')
    expect(await read(path)).toMatchObject({ status: 'ok', data: { emptyReason: 'empty_file', totalLines: 0, linesReturned: 0 } })
    writeFileSync(path, '\n\n')
    expect(await read(path)).toMatchObject({ status: 'ok', data: { emptyReason: null, totalLines: 2, text: '1:\n2:\n' } })
    writeFileSync(path, 'hostname')
    expect(await read(path, { start_line: 2 })).toMatchObject({ status: 'error', exitCode: null,
      error: { code: 'line_out_of_range', phase: 'content' }, data: { totalLines: 1, linesReturned: 0 } })
  })

  it('完整观察的小文件可按返回行号连续读取，不漏行也不重复', async () => {
    const path = join(fixture(), 'paged.txt')
    writeFileSync(path, 'one\ntwo\nthree\nfour\nfive\n')
    const first = await read(path, { max_lines: 2 })
    expect(first).toMatchObject({ status: 'ok', truncated: true, truncationReasons: ['max_lines'],
      data: { totalLines: 5, firstLine: 1, lastLine: 2, linesReturned: 2, nextStartLine: 3, canContinue: true } })
    const second = await read(path, { start_line: first.data.nextStartLine, max_lines: 2 })
    const third = await read(path, { start_line: second.data.nextStartLine, max_lines: 2 })
    expect(first.data.text + second.data.text + third.data.text).toBe('1:one\n2:two\n3:three\n4:four\n5:five\n')
    expect(third).toMatchObject({ truncated: false, data: { firstLine: 5, lastLine: 5, nextStartLine: null, hasMore: false } })
  })

  it('超过字节窗口时不伪造总行数，窗口越界与文件越界区分', async () => {
    const path = join(fixture(), 'large-line.txt')
    writeFileSync(path, 'x'.repeat(100000) + '\nAFTER_WINDOW\n')
    const result = await read(path)
    expect(result).toMatchObject({ status: 'ok', truncated: true, truncationReasons: ['source_bytes', 'output_bytes'],
      data: { bytesRead: 65536, totalLines: null, partialLastLine: true, nextStartLine: null, canContinue: false } })
    expect(Buffer.byteLength(result.data.text)).toBeLessThanOrEqual(7000)
    expect(result.data.text).not.toContain('AFTER_WINDOW')
    expect(await read(path, { start_line: 2 })).toMatchObject({ status: 'error', exitCode: null, truncated: false, truncationReasons: [],
      error: { code: 'outside_source_window' }, data: { totalLines: null } })
  })

  it('二进制样本不进入文本或传输缓冲，错误响应不带成功退出码', async () => {
    const path = join(fixture(), 'binary.bin')
    for (const sample of [Buffer.from('a\x00b'), Buffer.concat([Buffer.from('a\x00'), Buffer.alloc(100000, 65)])]) {
      writeFileSync(path, sample)
      const result = await read(path)
      expect(result).toMatchObject({ status: 'error', exitCode: null, truncated: false, truncationReasons: [],
        error: { code: 'binary_not_supported', phase: 'content' },
        data: { totalLines: null, binaryDetection: { method: 'nul_in_sample' } } })
      expect(result.data.text).not.toContain('\x00')
    }
  })

  it('末尾大日志保留最近结果，并明确绝对行号未知和多重截断原因', async () => {
    const path = join(fixture(), 'tail.log')
    writeFileSync(path, Array.from({ length: 2000 }, (_, i) => 'line' + i + ' ' + 'x'.repeat(80)).join('\n') + '\n')
    const result = await read(path, { from_end: true, max_lines: 500 })
    expect(result).toMatchObject({ status: 'ok', truncated: true,
      truncationReasons: ['source_bytes', 'max_lines', 'output_bytes'],
      data: { totalLines: null, firstLine: null, lastLine: null, lineNumberBasis: 'window', canContinue: false } })
    expect(result.data.text).toMatch(/line1999 x+\n$/)
    expect(result.data.linesReturned).toBe(result.data.text.trimEnd().split('\n').length)
    expect(result.data.partialFirstLine).toBe(false)
  })

  it.each(['A', '你'])('尾部超长单行 %s 的末尾有无换行均保留最新文本和部分行标记', async (character) => {
    const path = join(fixture(), 'tail-long-line.log')
    for (const newline of ['', '\n']) {
      writeFileSync(path, character.repeat(70000) + 'LATEST' + newline)
      const result = await read(path, { from_end: true })
      expect(result).toMatchObject({ status: 'ok', exitCode: 0, truncated: true,
        truncationReasons: ['source_bytes', 'output_bytes'],
        data: { linesReturned: 1, partialFirstLine: true, partialLastLine: false, totalLines: null, canContinue: false } })
      expect(Buffer.byteLength(result.data.text)).toBeLessThanOrEqual(7000)
      expect(result.data.text).toMatch(/LATEST\n$/)
      expect(result.data.text).not.toContain('\uFFFD')
    }
  })

  it('UTF-8 超长行被有界截断时不切开字符，后续完整行可从 nextStartLine 继续', async () => {
    const path = join(fixture(), 'utf8.txt')
    writeFileSync(path, '你好'.repeat(3000) + '\nnext\n')
    const result = await read(path)
    expect(result.data.text).not.toContain('\uFFFD')
    expect(result.data.partialLastLine).toBe(true)
    expect(result.data.nextStartLine).toBeNull()
    writeFileSync(path, Array.from({ length: 300 }, (_, i) => 'value' + i + ' ' + 'x'.repeat(40)).join('\n') + '\n')
    const window = await read(path, { max_lines: 500 })
    expect(window.truncationReasons).toEqual(['output_bytes'])
    expect(window.data.nextStartLine).toBe(window.data.lastLine + 1)
    const next = await read(path, { start_line: window.data.nextStartLine })
    expect(next.data.firstLine).toBe(window.data.lastLine + 1)
  })

  it('没有源截断时才提供准确总行数，缺失元数据不会被当作成功空文件', async () => {
    const path = join(fixture(), 'boundary.txt')
    writeFileSync(path, 'a'.repeat(65536))
    expect(await read(path)).toMatchObject({ data: { totalLines: 1 } })
    writeFileSync(path, 'a'.repeat(65537))
    expect(await read(path)).toMatchObject({ data: { totalLines: null } })
    const state = setup()
    state.execute.mockResolvedValueOnce({ command: 'query', output: '', exitCode: 0, duration: 1, completion: 'verified', commandSent: true })
    const result = await state.call('read_bound_file', 'missing-metadata', { path })
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ status: 'error',
      exitCode: null, error: { code: 'file_metadata_unavailable', phase: 'protocol' } })
  })

  it('源字节窗口边界也不切开 UTF-8 字符，末尾小文件可给出绝对行号', async () => {
    const path = join(fixture(), 'source-utf8.txt')
    writeFileSync(path, 'a'.repeat(64000) + '\n' + '你'.repeat(600) + '\n')
    const result = await read(path, { start_line: 2 })
    expect(result.data.text).not.toContain('\uFFFD')
    expect(result).toMatchObject({ truncated: true, truncationReasons: ['source_bytes'],
      data: { totalLines: null, partialLastLine: true } })
    writeFileSync(path, 'first\nsecond\nthird')
    expect(await read(path, { from_end: true, max_lines: 2 })).toMatchObject({
      data: { totalLines: 3, firstLine: 2, lastLine: 3, lineNumberBasis: 'file', text: 'second\nthird\n' } })
  })

  it('续读行号也遵守参数上限，不返回工具自身无法接受的下一页', async () => {
    const path = join(fixture(), 'many-lines.txt')
    writeFileSync(path, '\n'.repeat(10001))
    expect(await read(path, { start_line: 10000, max_lines: 1 })).toMatchObject({ status: 'ok',
      data: { firstLine: 10000, lastLine: 10000, totalLines: 10001, nextStartLine: null, canContinue: false, hasMore: true } })
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

  it('lsof 回退按本地端口筛选，展开连接与只看监听的含义不同', () => {
    const root = fixture()
    for (const utility of ['awk', 'head']) {
      const path = execFileSync('/bin/sh', ['-c', 'command -v ' + utility], { encoding: 'utf8' }).trim()
      symlinkSync(path, join(root, utility))
    }
    // 仅测试拥有的工具目录：强制走 lsof 回退，不依赖本机是否装 ss。
    writeFileSync(join(root, 'lsof'), '#!/bin/sh\n'
      + 'printf "%s\\n" "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME" "server 42 test 3u IPv4 1 0t0 TCP *:8080 (LISTEN)"\n'
      + 'case "$*" in *-sTCP:LISTEN*) ;; *) printf "%s\\n" "client 43 test 3u IPv4 2 0t0 TCP 127.0.0.1:50000->127.0.0.1:8080 (ESTABLISHED)" "server 42 test 4u IPv4 3 0t0 TCP 127.0.0.1:8080->127.0.0.1:50000 (ESTABLISHED)";; esac\n',
      { mode: 0o755 })
    const query = (listening_only: boolean) => execFileSync('/bin/sh', ['-c', prepareBuiltinRead('list_bound_sockets', {
      protocol: 'tcp', local_port: 8080, listening_only,
    }).command], { env: { ...process.env, PATH: root }, cwd: root, encoding: 'utf8' })
    expect(query(true)).toContain('(LISTEN)')
    expect(query(true)).not.toContain('(ESTABLISHED)')
    const all = query(false)
    expect(all).toContain('127.0.0.1:8080->127.0.0.1:50000')
    expect(all).not.toContain('client 43')
  })
})
