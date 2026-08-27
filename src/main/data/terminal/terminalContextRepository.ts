import { getLocalSession, terminalSessionManager } from './terminalSessionRegistry'

/** 数据真相读取适配：只读取已存在的终端输出，不构造模型材料。 */
export function readRecentTerminalOutput(terminalTabId: string, lines: number): string {
  const sshSession = terminalSessionManager.getSession(terminalTabId)
  if (sshSession) return sshSession.getRecentOutput(lines)

  const localSession = getLocalSession(terminalTabId)
  return localSession?.getRecentOutput(lines) ?? ''
}
