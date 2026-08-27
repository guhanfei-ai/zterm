import { LocalPtySession } from '../../services/localPtySession'
import { TerminalSessionManager } from '../../services/terminalSessionManager'

/**
 * 终端会话的运行时真相注册表。
 * IPC 仅负责事件与命令转发；Application、Projection 可经由数据读取适配访问既有会话事实。
 */
export const terminalSessionManager = new TerminalSessionManager()

const localSessions = new Map<string, LocalPtySession>()
const localGenerations = new Map<string, number>()

export function createLocalSession(tabId: string): LocalPtySession {
  const existing = localSessions.get(tabId)
  if (existing) existing.disconnect()

  const generation = (localGenerations.get(tabId) || 0) + 1
  localGenerations.set(tabId, generation)

  const session = new LocalPtySession(tabId, generation)
  localSessions.set(tabId, session)
  return session
}

export function removeLocalSession(tabId: string): void {
  const session = localSessions.get(tabId)
  if (session) {
    session.disconnect()
    localSessions.delete(tabId)
  }
}

export function getLocalSession(tabId: string): LocalPtySession | undefined {
  return localSessions.get(tabId)
}

export function getAllLocalSessions(): LocalPtySession[] {
  return Array.from(localSessions.values())
}

export function disposeAllLocalSessions(): void {
  for (const session of localSessions.values()) {
    try {
      session.disconnect()
    } catch {
      // 应用退出时忽略单一 PTY 会话的清理错误。
    }
  }
  localSessions.clear()
}

export function cleanupLocalSession(session: LocalPtySession): void {
  if (localSessions.get(session.tabId) === session) {
    localSessions.delete(session.tabId)
  }
}
