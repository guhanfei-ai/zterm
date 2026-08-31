import { describe, expect, it } from 'vitest'
import { normalizeReconnectTarget } from '../../model/workspace'

describe('terminal reconnect targets', () => {
  it('only permits non-sensitive identifiers for Jumpserver reconnects', () => {
    const target = normalizeReconnectTarget({
      kind: 'jumpserver',
      configId: 'config-1',
      assetId: 'asset-1',
      accountId: 'account-1',
      assetName: '应用服务器',
      accountName: 'ops',
      token: 'must-not-persist',
      clientUrl: 'https://private.example'
    })

    expect(target).toEqual({
      kind: 'jumpserver',
      configId: 'config-1',
      assetId: 'asset-1',
      accountId: 'account-1',
      assetName: '应用服务器',
      accountName: 'ops'
    })
  })
})
