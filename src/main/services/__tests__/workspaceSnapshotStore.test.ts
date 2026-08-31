import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_SNAPSHOT_VERSION,
  normalizeReconnectTarget,
  normalizeWorkspaceSnapshot
} from '../../model/workspace'

describe('workspace snapshot schema', () => {
  it('keeps only allowlisted metadata and drops sensitive unknown fields', () => {
    const result = normalizeWorkspaceSnapshot({
      version: WORKSPACE_SNAPSHOT_VERSION,
      savedAt: '2026-08-27T15:00:00.000Z',
      activeMode: 'direct',
      terminalTabs: [{
        id: 'terminal-1',
        title: '生产主机',
        defaultTitle: '终端 1',
        mode: 'direct',
        hostId: 'host-1',
        hostName: '生产主机',
        reconnectTarget: { kind: 'direct', hostId: 'host-1', password: 'secret-password' },
        recentOutput: 'super secret terminal output',
        generation: 99,
        token: 'jumpserver-token'
      }],
      activeTerminalTabIds: { direct: 'terminal-1', jumpserver: '', local: '' },
      chatTabs: [{
        id: 'chat-1',
        title: '对话',
        mode: 'agent',
        includeTerminalContext: true,
        linkedTerminalTabId: 'terminal-1',
        messages: [{ text: 'private chat message' }],
        agentState: 'running',
        apiKey: 'api-key'
      }],
      activeChatTabId: 'chat-1',
      accessKeySecret: 'access-key-secret'
    })

    expect(result.recoverable).toBe(true)
    if (!result.recoverable) return
    expect(result.snapshot.terminalTabs[0].reconnectTarget).toEqual({ kind: 'direct', hostId: 'host-1' })
    expect(result.snapshot.chatTabs[0]).toEqual({
      id: 'chat-1',
      title: '对话',
      mode: 'agent',
      includeTerminalContext: true,
      linkedTerminalTabId: 'terminal-1'
    })
    const serialized = JSON.stringify(result.snapshot)
    expect(serialized).not.toContain('secret-password')
    expect(serialized).not.toContain('super secret terminal output')
    expect(serialized).not.toContain('private chat message')
    expect(serialized).not.toContain('jumpserver-token')
    expect(serialized).not.toContain('access-key-secret')
  })

  it('rejects an unsupported schema version without mutating stored input', () => {
    const result = normalizeWorkspaceSnapshot({ version: 2 })
    expect(result).toEqual({ recoverable: false, reason: '保存的工作区版本不受支持' })
  })

  it('rejects malformed reconnect targets', () => {
    expect(normalizeReconnectTarget({ kind: 'direct', hostId: '' })).toBeNull()
    expect(normalizeReconnectTarget({ kind: 'jumpserver', configId: 'c', assetId: 'a' })).toBeNull()
    expect(normalizeReconnectTarget({ kind: 'local', clientUrl: 'https://private.example' })).toEqual({ kind: 'local' })
  })
})
