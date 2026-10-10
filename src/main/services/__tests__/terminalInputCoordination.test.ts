import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  sessions: new Map<string, any>(),
  send: vi.fn(),
}))
vi.mock('../ipcSecurity', () => ({ registerIpcHandler: (name: string, fn: any) => fixtures.handlers.set(name, fn) }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: fixtures.send } }] }, dialog: {} }))
vi.mock('../../data/terminal/terminalSessionRegistry', () => ({
  terminalSessionManager: { getSession: (id: string) => fixtures.sessions.get(id) },
  getLocalSession: () => undefined,
}))
vi.mock('../../ipc/jumpserver', () => ({ getJumpserverConnectContext: vi.fn(), resolveJumpserverConfigForConnect: vi.fn() }))
vi.mock('../store', () => ({ getStore: () => ({ get: () => undefined }) }))
vi.mock('../localPtySession', () => ({ LocalPtySession: class {}, getPlatformShell: vi.fn(), getPlatformDisplayName: vi.fn() }))

import { registerTerminalIpc } from '../../ipc/terminal'
import { isAgentTerminalBusy, resetAgentTerminalCoordinatorForTest, withAgentTerminalLock } from '../agentTerminalCoordinator'

beforeEach(() => {
  fixtures.handlers.clear(); fixtures.sessions.clear(); fixtures.send.mockReset()
  resetAgentTerminalCoordinatorForTest()
  registerTerminalIpc()
})

function session(id = 'terminal') {
  const value = { tabId: id, generation: 1, connected: true, write: vi.fn() }
  fixtures.sessions.set(id, value)
  return value
}
function input(id: string, text: string) {
  return fixtures.handlers.get('terminal:write')!({}, { tabId: id, data: text })
}

describe('主进程手动输入与 Agent 占用协调（无真实 SSH/PTY）', () => {
  it('同一真实连接被占用即拒绝输入，另一终端可用，释放后不会补发被拒绝的按键', async () => {
    const first = session(), other = session('other')
    let release!: () => void
    const command = withAgentTerminalLock(first, undefined, () => new Promise<void>(resolve => { release = resolve }))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect(input(first.tabId, 'echo must-not-run\r')).toMatchObject({ success: false, code: 'AGENT_BUSY' })
    expect(first.write).not.toHaveBeenCalled()
    expect(input(other.tabId, 'pwd\r')).toEqual({ success: true })
    expect(other.write).toHaveBeenCalledWith('pwd\r')
    expect(fixtures.send).toHaveBeenCalledWith('terminal:onAgentBusy', { tabId: first.tabId, generation: 1, busy: true })
    release(); await command
    await vi.waitFor(() => expect(isAgentTerminalBusy(first)).toBe(false))
    expect(first.write).not.toHaveBeenCalled()
    expect(input(first.tabId, 'pwd\r')).toEqual({ success: true })
    expect(first.write).toHaveBeenCalledExactlyOnceWith('pwd\r')
    expect(fixtures.send).toHaveBeenLastCalledWith('terminal:onAgentBusy', { tabId: first.tabId, generation: 1, busy: false })
  })

  it('取消排队不会提前释放前序占用；重连的新实例不继承旧实例的锁', async () => {
    const old = session()
    let release!: () => void
    const first = withAgentTerminalLock(old, undefined, () => new Promise<void>(resolve => { release = resolve }))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const abort = new AbortController()
    const queuedFn = vi.fn()
    const queued = withAgentTerminalLock(old, abort.signal, queuedFn)
    const rejected = expect(queued).rejects.toBeDefined()
    abort.abort(); await rejected
    expect(isAgentTerminalBusy(old)).toBe(true)
    expect(queuedFn).not.toHaveBeenCalled()
    expect(input(old.tabId, '\u0003')).toMatchObject({ success: false })
    const fresh = session()
    fresh.generation = 2
    expect(input(fresh.tabId, 'pwd\r')).toEqual({ success: true })
    release(); await first
    await vi.waitFor(() => expect(isAgentTerminalBusy(old)).toBe(false))
    expect(fixtures.send.mock.calls.filter(([, event]) => event?.busy === false)).toHaveLength(0)
  })

  it('半行命令和含换行的粘贴不会被探针提交，需用户自行完成或取消', async () => {
    const terminal = session(); const query = vi.fn(async () => 'result')
    input(terminal.tabId, 'rm example')
    await expect(withAgentTerminalLock(terminal, undefined, query)).rejects.toThrow('未提交')
    expect(query).not.toHaveBeenCalled()
    input(terminal.tabId, '\u0003')
    await expect(withAgentTerminalLock(terminal, undefined, query)).resolves.toBe('result')
    query.mockClear()
    input(terminal.tabId, '\u001b[200~first\nsecond\u001b[201~')
    await expect(withAgentTerminalLock(terminal, undefined, query)).rejects.toThrow('未提交')
    expect(query).not.toHaveBeenCalled()
    input(terminal.tabId, '\r')
    await expect(withAgentTerminalLock(terminal, undefined, query)).resolves.toBe('result')
  })

  it('断开连接和无效输入不会送进终端', () => {
    const terminal = session(); terminal.connected = false
    expect(input(terminal.tabId, 'dangerous\r')).toMatchObject({ success: false })
    expect(fixtures.handlers.get('terminal:write')!({}, null)).toMatchObject({ success: false })
    expect(terminal.write).not.toHaveBeenCalled()
  })
})
