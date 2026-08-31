import { EventEmitter } from 'node:events'
import type { Client, ConnectConfig } from 'ssh2'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storeData = new Map<string, unknown>()

vi.mock('../store', () => ({
  getStore: () => ({
    get: (key: string): unknown => storeData.get(key),
    set: (key: string, value: unknown): void => {
      storeData.set(key, value)
    }
  })
}))

import { SSH_HOST_TRUST_STORE_KEY } from '../../model/sshHostTrust'
import {
  createSshHostFingerprint,
  createSshHostTrustCandidate,
  normalizeSshEndpoint,
  normalizeSshHost,
  normalizeSshPort,
  normalizeSshUsername,
  parseSshHostTrustRecords,
  resetSshHostTrustRecord,
  saveSshHostTrustRecord
} from '../sshHostTrust'
import { TerminalSession } from '../terminalSessionManager'

class FakeClient extends EventEmitter {
  config: ConnectConfig | null = null

  connect(config: ConnectConfig): void {
    this.config = config
  }

  end(): void {}

  destroy(): void {}
}

function createEd25519HostKey(byte = 1): Buffer {
  const algorithm = Buffer.from('ssh-ed25519')
  const algorithmLength = Buffer.alloc(4)
  algorithmLength.writeUInt32BE(algorithm.length)
  const keyLength = Buffer.alloc(4)
  keyLength.writeUInt32BE(32)
  return Buffer.concat([algorithmLength, algorithm, keyLength, Buffer.alloc(32, byte)])
}

function invokeHostVerifier(client: FakeClient, key: Buffer, verify: (allowed: boolean) => void): void {
  const verifier = client.config?.hostVerifier
  if (typeof verifier !== 'function') throw new Error('hostVerifier not configured')
  ;(verifier as (rawHostKey: Buffer, callback: (allowed: boolean) => void) => void)(key, verify)
}

function createTrustedSession(client: FakeClient): TerminalSession {
  const session = new TerminalSession('tab-1', 1, () => client as unknown as Client)
  session.on('error', () => {})
  return session
}

const connection = {
  host: 'Example.COM.',
  port: 22,
  username: 'Ops User',
  password: 'not-for-events',
  privateKey: 'not-for-events',
  passphrase: 'not-for-events',
  requireHostTrust: true
}

beforeEach(() => {
  storeData.clear()
})

describe('SSH 主机信任记录', () => {
  it('规范化域名、IP、端口和用户名，并拒绝无效输入', () => {
    expect(normalizeSshHost(' Example.COM. ')).toBe('example.com')
    expect(normalizeSshHost('[2001:0DB8:0:0:0:0:0:1]')).toBe('2001:db8::1')
    expect(normalizeSshHost('127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeSshEndpoint('example.com', '22')).toEqual({ host: 'example.com', port: 22, endpoint: 'example.com:22' })
    expect(normalizeSshPort(0)).toBeNull()
    expect(normalizeSshPort('022')).toBeNull()
    expect(normalizeSshUsername('  Admin  ')).toBe('Admin')
    expect(normalizeSshUsername('bad\nname')).toBeNull()
  })

  it('以完整 SHA-256 指纹和允许字段保存长期信任记录', () => {
    const rawHostKey = createEd25519HostKey()
    const fingerprint = createSshHostFingerprint(rawHostKey)
    expect(fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/)
    expect(fingerprint).not.toContain('=')

    const candidate = createSshHostTrustCandidate({
      host: 'example.com',
      port: 22,
      username: 'ops',
      algorithm: 'ssh-ed25519',
      fingerprint
    })
    expect(candidate).not.toBeNull()
    saveSshHostTrustRecord(candidate!)

    expect(storeData.get(SSH_HOST_TRUST_STORE_KEY)).toEqual([
      expect.objectContaining({
        endpoint: 'example.com:22',
        host: 'example.com',
        port: 22,
        username: 'ops',
        algorithm: 'ssh-ed25519',
        fingerprint
      })
    ])
    expect(JSON.stringify(storeData.get(SSH_HOST_TRUST_STORE_KEY))).not.toMatch(/password|privateKey|passphrase|token|vault/i)
  })

  it('忽略带未知字段、重复端点或无效序列化格式的记录', () => {
    const valid = {
      endpoint: 'example.com:22',
      host: 'example.com',
      port: 22,
      username: 'ops',
      algorithm: 'ssh-ed25519',
      fingerprint: 'SHA256:abcdefghijklmnopqrstuvwxyzABCDE1234567890+/',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const parsed = parseSshHostTrustRecords([
      { ...valid, password: 'must-not-accept' },
      valid,
      { ...valid, username: 'other' }
    ])
    expect(parsed).toEqual([])
  })
})

describe('SSH 主机密钥握手', () => {
  it('未知主机在用户决定前不进入 ready，且仅本次信任不落盘', async () => {
    const client = new FakeClient()
    const session = createTrustedSession(client)
    const events: unknown[] = []
    let verified: boolean | undefined
    session.on('host-trust-required', (event) => events.push(event))

    const connecting = session.connect(connection)
    expect(client.config?.hostHash).toBeUndefined()
    invokeHostVerifier(client, createEd25519HostKey(), (allowed) => {
      verified = allowed
    })
    expect(events).toHaveLength(1)
    expect(JSON.stringify(events[0])).not.toMatch(/password|privateKey|passphrase|token|vault/i)

    client.emit('ready')
    expect(session.connected).toBe(false)

    const event = events[0] as { requestId: string }
    expect(session.respondHostTrust({ tabId: 'tab-1', generation: 1, requestId: event.requestId, decision: 'trust-once' })).toEqual({ success: true })
    expect(verified).toBe(true)
    client.emit('ready')
    await expect(connecting).resolves.toBeUndefined()
    expect(storeData.get(SSH_HOST_TRUST_STORE_KEY)).toBeUndefined()
  })

  it('拒绝、取消和超时都不会保存信任记录', async () => {
    vi.useFakeTimers()
    try {
      const client = new FakeClient()
      const session = createTrustedSession(client)
      const events: Array<{ requestId: string }> = []
      let verified: boolean | undefined
      session.on('host-trust-required', (event) => events.push(event))
      const connecting = session.connect(connection)
      invokeHostVerifier(client, createEd25519HostKey(), (allowed) => {
        verified = allowed
      })
      expect(session.respondHostTrust({ tabId: 'tab-1', generation: 1, requestId: 'wrong', decision: 'reject' }).success).toBe(false)
      expect(session.respondHostTrust({ tabId: 'tab-1', generation: 1, requestId: events[0].requestId, decision: 'reject' })).toEqual({ success: true })
      expect(verified).toBe(false)
      expect(storeData.get(SSH_HOST_TRUST_STORE_KEY)).toBeUndefined()
      client.emit('error', new Error('Host verification failed'))
      await expect(connecting).rejects.toThrow('SSH 主机身份未获信任')

      const canceledClient = new FakeClient()
      const canceledSession = createTrustedSession(canceledClient)
      let canceled: boolean | undefined
      const canceledConnecting = canceledSession.connect(connection)
      invokeHostVerifier(canceledClient, createEd25519HostKey(4), (allowed) => {
        canceled = allowed
      })
      canceledSession.disconnect()
      expect(canceled).toBe(false)
      expect(storeData.get(SSH_HOST_TRUST_STORE_KEY)).toBeUndefined()
      await expect(canceledConnecting).rejects.toThrow('SSH 主机身份未确认，连接已阻断')

      const timeoutClient = new FakeClient()
      const timeoutSession = createTrustedSession(timeoutClient)
      let timedOut: boolean | undefined
      const timeoutConnecting = timeoutSession.connect(connection)
      invokeHostVerifier(timeoutClient, createEd25519HostKey(2), (allowed) => {
        timedOut = allowed
      })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(timedOut).toBe(false)
      expect(storeData.get(SSH_HOST_TRUST_STORE_KEY)).toBeUndefined()
      timeoutClient.emit('error', new Error('Host verification failed'))
      await expect(timeoutConnecting).rejects.toThrow('SSH 主机身份未确认，连接已超时')
    } finally {
      vi.useRealTimers()
    }
  })

  it('长期信任仅在验证后保存，匹配时放行，算法或指纹变化时硬阻断', async () => {
    const client = new FakeClient()
    const session = createTrustedSession(client)
    const events: Array<{ requestId: string }> = []
    let verified: boolean | undefined
    session.on('host-trust-required', (event) => events.push(event))
    const connecting = session.connect(connection)
    const initialKey = createEd25519HostKey()
    invokeHostVerifier(client, initialKey, (allowed) => {
      verified = allowed
    })
    expect(session.respondHostTrust({ tabId: 'tab-1', generation: 1, requestId: events[0].requestId, decision: 'trust-always' })).toEqual({ success: true })
    expect(verified).toBe(true)
    client.emit('ready')
    await expect(connecting).resolves.toBeUndefined()
    expect(storeData.get(SSH_HOST_TRUST_STORE_KEY)).toHaveLength(1)

    const matchingClient = new FakeClient()
    const matchingSession = createTrustedSession(matchingClient)
    const matchingConnect = matchingSession.connect(connection)
    let matched: boolean | undefined
    invokeHostVerifier(matchingClient, initialKey, (allowed) => {
      matched = allowed
    })
    expect(matched).toBe(true)
    matchingClient.emit('ready')
    await expect(matchingConnect).resolves.toBeUndefined()

    const changedClient = new FakeClient()
    const changedSession = createTrustedSession(changedClient)
    const changedEvents: Array<{ kind: string }> = []
    changedSession.on('host-trust-required', (event) => changedEvents.push(event))
    const changedConnect = changedSession.connect(connection)
    let changed: boolean | undefined
    invokeHostVerifier(changedClient, createEd25519HostKey(3), (allowed) => {
      changed = allowed
    })
    expect(changed).toBe(false)
    expect(changedEvents).toHaveLength(1)
    expect(changedEvents[0].kind).toBe('changed')
    expect(storeData.get(SSH_HOST_TRUST_STORE_KEY)).toHaveLength(1)
    changedClient.emit('error', new Error('Host verification failed'))
    await expect(changedConnect).rejects.toThrow('SSH 主机身份已变更，连接已阻断')

    const records = storeData.get(SSH_HOST_TRUST_STORE_KEY) as Array<{ algorithm: string }>
    records[0].algorithm = 'ssh-rsa'
    const algorithmChangedClient = new FakeClient()
    const algorithmChangedSession = createTrustedSession(algorithmChangedClient)
    const algorithmChangedEvents: Array<{ kind: string }> = []
    algorithmChangedSession.on('host-trust-required', (event) => algorithmChangedEvents.push(event))
    const algorithmChangedConnect = algorithmChangedSession.connect(connection)
    let algorithmChanged: boolean | undefined
    invokeHostVerifier(algorithmChangedClient, initialKey, (allowed) => {
      algorithmChanged = allowed
    })
    expect(algorithmChanged).toBe(false)
    expect(algorithmChangedEvents[0].kind).toBe('changed')
    algorithmChangedClient.emit('error', new Error('Host verification failed'))
    await expect(algorithmChangedConnect).rejects.toThrow('SSH 主机身份已变更，连接已阻断')

    expect(resetSshHostTrustRecord('example.com', 22)).toBe(true)
    expect(storeData.get(SSH_HOST_TRUST_STORE_KEY)).toEqual([])
  })
})
