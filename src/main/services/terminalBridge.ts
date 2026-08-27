import { TerminalSession } from './terminalSessionManager'
import { LocalPtySession } from './localPtySession'

/** 统一会话类型：TerminalSession（SSH/JMP）与 LocalPtySession 的共同接口 */
export type AnyTerminalSession = TerminalSession | LocalPtySession

export interface TerminalContext {
  hostName: string
  hostDetails: string
  source: 'direct' | 'jumpserver' | 'local'
  recentOutput: string
  isConnected: boolean
}

export interface CommandResult {
  command: string
  output: string
  exitCode?: number
  duration: number
}

export class TerminalBridge {
  private session: AnyTerminalSession
  private disposed = false

  constructor(session: AnyTerminalSession) {
    this.session = session
  }

  /**
   * 释放 bridge 持有的引用。TerminalBridge 本身不订阅 session 事件，
   * 但保留这个方法以便 agent:bind 等场景能显式声明旧 bridge 不再使用，
   * 让 GC 立刻回收（而不是等 controller 引用被覆盖）。
   */
  dispose(): void {
    this.disposed = true
  }

  isDisposed(): boolean {
    return this.disposed
  }

  isConnected(): boolean {
    if (this.disposed) return false
    return this.session.connected
  }

  getCurrentHost(): { host: string; port: number; username: string } | null {
    // 本地会话没有 currentHost，SSH/JMP 会话才有
    const s = this.session as TerminalSession
    if (!s.currentHost) return null
    return {
      host: s.currentHost.host,
      port: s.currentHost.port,
      username: s.currentHost.username
    }
  }

  getDisplayIdentity(): { displayName: string; displayDetail: string; source: string } | null {
    const meta = this.session.sessionMeta
    if (meta) {
      // 本地会话：展示「本地终端 (macOS)」等可读名称
      if (meta.source === 'local') {
        return {
          displayName: meta.displayName || '本地终端',
          displayDetail: meta.displayName || '本地终端',
          source: 'local'
        }
      }
      // Jumpserver 会话：展示身份为「资产名 / 账号名」，确保绑定名能对上资产
      if (meta.source === 'jumpserver') {
        const detail = meta.displaySecondary
          ? `${meta.displayName} / ${meta.displaySecondary}`
          : meta.displayName
        return {
          displayName: meta.displayName,
          displayDetail: detail,
          source: meta.source
        }
      }
      // 直连模式：保持现有展示风格
      return {
        displayName: meta.displayName,
        displayDetail: meta.displaySecondary || meta.displayName,
        source: meta.source
      }
    }
    // 无元信息时回落底层 SSH 信息（仅 TerminalSession 有 currentHost）
    const s = this.session as TerminalSession
    const host = s.currentHost
    if (host) {
      return {
        displayName: `${host.username}@${host.host}`,
        displayDetail: `${host.username}@${host.host}:${host.port}`,
        source: 'direct'
      }
    }
    return null
  }

  getTerminalContext(lines = 200): TerminalContext {
    const identity = this.getDisplayIdentity()
    return {
      hostName: identity?.displayName || '未连接',
      hostDetails: identity?.displayDetail || '',
      source: (identity?.source as 'direct' | 'jumpserver' | 'local') || 'direct',
      recentOutput: this.session.getRecentOutput(lines),
      isConnected: this.session.connected
    }
  }

  // Write a command to the terminal (appends newline)
  writeCommand(command: string): void {
    this.session.write(command + '\n')
  }

  // Get a snapshot of recent output before executing a command
  getPreCommandSnapshot(): string {
    return this.session.getRecentOutput(200)
  }

  // Wait for command output to stabilize, return delta from snapshot
  async waitForResult(previousSnapshot: string, timeout = 10000, signal?: AbortSignal): Promise<CommandResult> {
    const startTime = Date.now()
    const aborted = (): boolean => signal?.aborted ?? false

    // ---- Phase 1: wait for initial output with adaptive backoff ----
    // Intervals: 100 → 200 → 400 → 500ms (exponential, capped at 500)
    let pollInterval = 100
    const MAX_POLL_INTERVAL = 500

    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (aborted() || this.disposed || !this.session.connected) { resolve(); return }

        const current = this.session.getRecentOutput(200)
        const elapsed = Date.now() - startTime

        // Has new output appeared? (缓冲区只保留最近 200 行，滚动后长度可能不变，只比较内容)
        if (current !== previousSnapshot) {
          resolve()
          return
        }

        if (elapsed >= timeout) {
          resolve() // Timeout: return whatever we have
          return
        }

        setTimeout(check, pollInterval)
        // Exponential backoff, capped at 500ms
        pollInterval = Math.min(pollInterval * 2, MAX_POLL_INTERVAL)
      }
      setTimeout(check, pollInterval)
    })

    // ---- Phase 2: wait for output to stabilize ----
    // Stabilization = 2 consecutive samples with identical output
    let stabilized = false
    let lastOutput = this.session.getRecentOutput(200)
    let stableCount = 0 // consecutive identical samples
    const STABLE_THRESHOLD = 2 // need 2 identical samples to declare stable

    while (!stabilized && !aborted() && !this.disposed && this.session.connected) {
      // Adaptive backoff for stabilization polling too
      let stabilizeInterval = 100
      const MAX_STABILIZE_INTERVAL = 500

      await new Promise<void>((resolve) => {
        if (signal?.aborted || this.disposed || !this.session.connected) { resolve(); return }

        const onAbort = (): void => { clearTimeout(timer); resolve() }
        signal?.addEventListener('abort', onAbort, { once: true })

        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }, stabilizeInterval)
      })
      if (aborted() || this.disposed || !this.session.connected) break

      const current = this.session.getRecentOutput(200)
      const elapsed = Date.now() - startTime

      if (elapsed >= timeout) {
        stabilized = true
        break
      }

      if (current === lastOutput) {
        stableCount++
        if (stableCount >= STABLE_THRESHOLD) {
          stabilized = true
        }
      } else {
        // Output changed — reset stability counter
        stableCount = 0
        lastOutput = current
      }
    }

    // ---- Phase 3: extract delta via line-level diff ----
    const finalOutput = this.session.getRecentOutput(200)
    const delta = extractLineDelta(previousSnapshot, finalOutput)

    return {
      command: '',
      output: delta.trim() || '(无输出)',
      duration: Date.now() - startTime
    }
  }
}

/**
 * Line-level delta extraction: split both texts by newline, find common
 * prefix, and return only the new lines. This handles terminal carriage-return
 * overwrites where the same line is rewritten (startsWith would fail).
 */
function extractLineDelta(snapshot: string, current: string): string {
  if (!snapshot) return current

  const snapLines = snapshot.split('\n')
  const currLines = current.split('\n')

  // Find common prefix length (lines that haven't changed)
  let commonLen = 0
  const minLen = Math.min(snapLines.length, currLines.length)
  for (let i = 0; i < minLen; i++) {
    if (snapLines[i] === currLines[i]) {
      commonLen++
    } else {
      break
    }
  }

  // If snapshot is entirely a prefix of current (no overwrites), simple slice
  if (commonLen === snapLines.length && currLines.length > snapLines.length) {
    return currLines.slice(commonLen).join('\n')
  }

  // If common prefix is shorter than snapshot, some lines were overwritten.
  // Return everything after the common prefix — includes modified + new lines.
  if (commonLen < snapLines.length) {
    return currLines.slice(commonLen).join('\n')
  }

  // Equal content — no delta
  if (commonLen === snapLines.length && commonLen === currLines.length) {
    return ''
  }

  // Fallback: return entire current output
  return current
}
