import { Client } from 'ssh2'
import type { ConnectConfig, ClientChannel } from 'ssh2'
import { EventEmitter } from 'events'

export interface SshConnectionOptions {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
}

export interface SessionMeta {
  source: 'direct' | 'jumpserver' | 'local'
  displayName: string
  displaySecondary?: string
}

export interface TerminalEvent {
  data?: Buffer
  exit?: { code: number; signal: string }
}

/**
 * Represents a single SSH session tied to a terminal tab.
 * Emits events scoped to this session only.
 */
export class TerminalSession extends EventEmitter {
  public tabId: string
  public generation: number
  private conn: Client | null = null
  private stream: ClientChannel | null = null
  public connected = false
  public currentHost?: SshConnectionOptions
  public sessionMeta?: SessionMeta
  private outputBuffer: string[] = []
  private maxBufferLines = 5000
  private connHadError = false // 记录 SSH 连接层是否因错误关闭
  private keepaliveTriggered = false // 记录本次关闭是否由 keepalive 失败触发（区分正常断开）

  constructor(tabId: string, generation: number) {
    super()
    this.tabId = tabId
    this.generation = generation
  }

  private normalizeSessionPrompt(): void {
    if (!this.stream || !this.stream.writable) return
    this.stream.write("export PS1=\"${PS1% } \" >/dev/null 2>&1; printf '\\033[1A\\033[2K\\r'\n")
  }

  async connect(opts: SshConnectionOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      this.currentHost = opts
      this.conn = new Client()

      const config: ConnectConfig = {
        host: opts.host,
        port: opts.port || 22,
        username: opts.username,
        readyTimeout: 10000,
        // P8: SSH-level keepalive 防止中间网络设备空闲超时踢断（典型 300s idle timeout）
        //     每 30s 发一次 keepalive@openssh.com 请求，连续 3 次无响应才判死
        keepaliveInterval: 30000,
        keepaliveCountMax: 3
      }

      if (opts.privateKey) {
        config.privateKey = opts.privateKey
        if (opts.passphrase) {
          config.passphrase = opts.passphrase
        }
      } else if (opts.password) {
        config.password = opts.password
      }

      this.conn.on('ready', () => {
        this.connected = true
        this.emit('connected', opts)
        resolve()
      })

      // P1-2：keepalive 超时错误会从 error 事件先发，再到 close。
      // 检测 keepalive 触发的关闭：ssh2 抛出的错误 message 一般带 "Timed out" 字样；
      // 同时通过连接对象上的 _keepaliveTimeoutCount 内部状态不可见，只能通过 err.message 匹配。
      this.conn.on('error', (err: Error) => {
        this.connected = false
        if (/keepalive/i.test(err.message) || /Timed out/i.test(err.message)) {
          this.keepaliveTriggered = true
        }
        this.emit('error', err, 'ssh-connection')
        reject(err)
      })

      // P1-2：SSH keepalive 失败会通过本事件上报；显式记录用于 close 时的诊断
      // ssh2 没有 'continue' / 'keepalive-success' 事件，这里仅保留入口作为扩展位
      void this.keepaliveTriggered // (扩展位)

      this.conn.on('close', (hadError?: boolean) => {
        this.connected = false
        this.connHadError = hadError === true
        // 统一 closed 事件签名（C1）：{ reason, hadError }
        // - 'user-disconnect'：本地主动调用 disconnect()
        // - 'keepalive-timeout'：keepalive 失败触发的传输层关闭
        // - 'transport-error'：传输层发生错误
        // - 'normal'：远端正常关闭
        let reason: 'user-disconnect' | 'keepalive-timeout' | 'transport-error' | 'normal'
        if (this.keepaliveTriggered) {
          reason = 'keepalive-timeout'
        } else if (hadError === true) {
          reason = 'transport-error'
        } else {
          reason = 'normal'
        }
        this.emit('closed', { reason, hadError: hadError === true })
      })

      this.conn.connect(config)
    })
  }

  openShell(cols: number, rows: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.conn) {
        reject(new Error('SSH 连接不存在'))
        return
      }

      this.conn.shell(
        {
          term: 'xterm-256color',
          cols,
          rows
        },
        (err: Error | undefined, stream: ClientChannel) => {
          if (err) {
            reject(err)
            return
          }

          this.stream = stream

          stream.on('data', (data: Buffer) => {
            this.outputBuffer.push(data.toString())
            if (this.outputBuffer.length > this.maxBufferLines) {
              this.outputBuffer = this.outputBuffer.slice(-this.maxBufferLines)
            }
            this.emit('data', data)
          })

          stream.on('close', () => {
            this.connected = false
            // 诊断：区分是 SSH 连接层先断（connHadError）还是 shell channel 独立关闭
            const reason = this.connHadError
              ? 'shell channel closed after SSH transport error'
              : 'shell channel closed (SSH transport still up or normal close)'
            this.emit('shell-closed', { reason })
          })

          stream.on('error', (err: Error) => {
            this.connected = false
            this.emit('error', err, 'ssh-shell')
          })

          resolve()
        }
      )
    })
  }

  write(data: string): void {
    if (this.stream && this.stream.writable) {
      this.stream.write(data)
    }
  }

  resize(cols: number, rows: number): void {
    if (this.stream) {
      this.stream.setWindow(rows, cols, 0, 0)
    }
  }

  getRecentOutput(lines: number): string {
    // 先 join 再按 \n split，确保按行截断而非按 buffer 元素截取
    const joined = this.outputBuffer.join('')
    const allLines = joined.split('\n')
    return allLines.slice(-lines).join('\n')
  }

  disconnect(): void {
    try {
      if (this.stream) {
        this.stream.end()
        this.stream.destroy()
        this.stream = null
      }
      if (this.conn) {
        this.conn.end()
        this.conn.destroy()
        this.conn = null
      }
    } catch {
      // ignore cleanup errors
    }
    this.connected = false
    this.currentHost = undefined
    this.sessionMeta = undefined
    this.outputBuffer = []
    // 主动断开时也要按 C1 统一签名发 object
    this.emit('closed', { reason: 'user-disconnect', hadError: false })
    this.removeAllListeners()
  }
}

/**
 * Manages multiple terminal sessions, each keyed by tabId.
 * Replaces the global single SshManager usage.
 */
export class TerminalSessionManager {
  private sessions = new Map<string, TerminalSession>()
  private generations = new Map<string, number>() // tabId -> generation counter

  createSession(tabId: string): TerminalSession {
    // If a session already exists for this tab, disconnect it first
    const existing = this.sessions.get(tabId)
    if (existing) {
      existing.disconnect()
    }

    // Increment generation for this tabId
    const gen = (this.generations.get(tabId) || 0) + 1
    this.generations.set(tabId, gen)

    const session = new TerminalSession(tabId, gen)
    this.sessions.set(tabId, session)
    return session
  }

  getSession(tabId: string): TerminalSession | undefined {
    return this.sessions.get(tabId)
  }

  getGeneration(tabId: string): number {
    return this.generations.get(tabId) || 0
  }

  removeSession(tabId: string): void {
    const session = this.sessions.get(tabId)
    if (session) {
      session.disconnect()
      this.sessions.delete(tabId)
    }
  }

  hasSession(tabId: string): boolean {
    return this.sessions.has(tabId)
  }

  getAllSessions(): TerminalSession[] {
    return Array.from(this.sessions.values())
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.disconnect()
    }
    this.sessions.clear()
    this.generations.clear()
  }
}
