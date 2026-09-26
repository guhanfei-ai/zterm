import type { TerminalBridge } from './terminalBridge'

/** 每个真实 terminal session 一条 Agent 命令链；Pi 与 Graph 回退共享。 */
const terminalLocks = new Map<object, Promise<void>>()
/** 完成标记缺失后隔离真实 session，不能靠换 bridge/引擎/轮次解锁。 */
let uncertainSessions = new WeakSet<object>()

export function getAgentTerminalKey(bridge: TerminalBridge): object {
  const key = bridge.getTerminalLockKey()
  if (!key || (typeof key !== 'object' && typeof key !== 'function')) {
    throw new Error('无法验证底层终端实例，禁止 Agent 命令下发')
  }
  return key
}

export function isAgentTerminalUncertain(key: object): boolean {
  return uncertainSessions.has(key)
}

export function markAgentTerminalUncertain(key: object): void {
  uncertainSessions.add(key)
}

/**
 * 按真实终端实例串行执行。排队期间取消可立即返回，但它的占位 tail 会保留
 * 到前序完成，防止第三条命令绕过仍在执行的第一条。
 */
export async function withAgentTerminalLock<T>(
  key: object,
  signal: AbortSignal | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const previous = terminalLocks.get(key) ?? Promise.resolve()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.catch(() => {}).then(() => gate)
  terminalLocks.set(key, tail)

  try {
    if (signal) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          signal.removeEventListener('abort', onAbort)
          reject(signal.reason ?? new Error('已取消'))
        }
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
        void previous.catch(() => {}).then(() => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        })
      })
    } else {
      await previous.catch(() => {})
    }
    signal?.throwIfAborted()
    return await fn()
  } finally {
    release()
    void tail.finally(() => {
      if (terminalLocks.get(key) === tail) terminalLocks.delete(key)
    })
  }
}

/** 仅供测试清空模块级协调状态；生产只能通过新建真实 session 解锁。 */
export function resetAgentTerminalCoordinatorForTest(): void {
  terminalLocks.clear()
  uncertainSessions = new WeakSet<object>()
}
