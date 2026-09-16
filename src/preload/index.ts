import { contextBridge, ipcRenderer } from 'electron'
import type { KeyRecord } from '../main/ipc/keys'
import type { HostRecord } from '../main/ipc/hosts'
import type { JumpserverConfig, JumpserverQuickAccessItem, JumpserverAccountPreference } from '../main/ipc/jumpserver'
import type { JumpserverTestResult, JumpserverAssetsResult, JumpserverNodesResult, JumpserverAccountsResult, JumpserverSessionParamsResult, JumpserverExchangeResult } from '../main/services/jumpserverClient'
import type { ProviderConfig } from '../main/model/contracts'
import type { ChatMessage } from '../main/application/chat/chatApplication'
import type { ChatStreamEvent } from '../main/harness/chat/chatHarness'
import type { AgentMessage, AgentStatus, SetAllowWriteResult } from '../main/services/agentController'
import type { AgentContextSnapshot } from '../main/services/agentContextStore'
import type { WorkspaceSnapshotV1 } from '../main/model/workspace'
import type { SshHostTrustRequiredEvent, SshHostTrustResponse } from '../main/model/sshHostTrust'
import type { ChatHistoryV1 } from '../main/model/chatHistory'

const api = {
  keys: {
    list: (): Promise<KeyRecord[]> => ipcRenderer.invoke('keys:list'),
    get: (id: string): Promise<KeyRecord | null> => ipcRenderer.invoke('keys:get', id),
    create: (data: { name: string; privateKey: string; passphrase?: string }): Promise<KeyRecord> =>
      ipcRenderer.invoke('keys:create', data),
    update: (
      id: string,
      data: { name?: string; privateKey?: string; passphrase?: string }
    ): Promise<KeyRecord | null> => ipcRenderer.invoke('keys:update', id, data),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('keys:delete', id)
  },

  hosts: {
    list: (): Promise<HostRecord[]> => ipcRenderer.invoke('hosts:list'),
    get: (id: string): Promise<HostRecord | null> => ipcRenderer.invoke('hosts:get', id),
    create: (data: {
      name: string
      host: string
      port?: number
      username: string
      authType: 'password' | 'key' | 'privateKeyFile'
      password?: string
      keyId?: string
      privateKeyFilePath?: string
      privateKeyFilePassphrase?: string
      description?: string
    }): Promise<HostRecord> => ipcRenderer.invoke('hosts:create', data),
    update: (
      id: string,
      data: {
        name?: string
        host?: string
        port?: number
        username?: string
        authType?: 'password' | 'key' | 'privateKeyFile'
        password?: string
        keyId?: string
        privateKeyFilePath?: string
        privateKeyFilePassphrase?: string
        description?: string
      }
    ): Promise<HostRecord | null> => ipcRenderer.invoke('hosts:update', id, data),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('hosts:delete', id),
    pickPrivateKeyFile: (): Promise<{ canceled: boolean; filePath?: string; fileName?: string; error?: string }> =>
      ipcRenderer.invoke('hosts:pickPrivateKeyFile'),
    exportSshConfig: (): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('hosts:exportSshConfig')
  },

  ai: {
    getProviderConfig: (): Promise<ProviderConfig | null> =>
      ipcRenderer.invoke('ai:getProviderConfig'),
    saveProviderConfig: (
      config: Omit<ProviderConfig, 'providerType'>
    ): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('ai:saveProviderConfig', config),
    validateProviderConfig: (config: ProviderConfig): Promise<{ valid: boolean; error?: string }> =>
      ipcRenderer.invoke('ai:validateProviderConfig', config),
    setModel: (model: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('ai:setModel', model),
    chatStream: (opts: {
      chatTabId: string
      messages: ChatMessage[]
      includeTerminalContext?: boolean
      terminalTabId?: string
    }): Promise<void> => ipcRenderer.invoke('ai:chatStream', opts),
    abort: (data?: { chatTabId?: string }): Promise<{ success: boolean }> => ipcRenderer.invoke('ai:abort', data),
    onStreamChunk: (callback: (chunk: ChatStreamEvent) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, chunk: ChatStreamEvent): void => callback(chunk)
      ipcRenderer.on('ai:streamChunk', handler)
      return () => {
        ipcRenderer.removeListener('ai:streamChunk', handler)
      }
    },
    onStreamError: (callback: (data: { error: string; chatTabId?: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { error: string; chatTabId?: string }): void => callback(data)
      ipcRenderer.on('ai:streamError', handler)
      return () => {
        ipcRenderer.removeListener('ai:streamError', handler)
      }
    }
  },

  platform: process.platform,

  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChange: (callback: (isMaximized: boolean) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, v: boolean): void => callback(v)
      ipcRenderer.on('window:maximizeChange', handler)
      return () => {
        ipcRenderer.removeListener('window:maximizeChange', handler)
      }
    }
  },

  agent: {
    startTask: (data: { chatTabId: string; description: string; maxSteps?: number; isNewTask?: boolean }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('agent:startTask', data),
    stop: (data?: { chatTabId?: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agent:stop', data),
    confirmCommand: (approved: boolean, data?: { chatTabId?: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agent:confirmCommand', approved, data),
    getStatus: (data?: { chatTabId?: string }): Promise<AgentStatus> => ipcRenderer.invoke('agent:getStatus', data),
    reset: (data?: { chatTabId?: string }): Promise<{ success: boolean }> => ipcRenderer.invoke('agent:reset', data),
    fullReset: (data?: { chatTabId?: string }): Promise<{ success: boolean }> => ipcRenderer.invoke('agent:fullReset', data),
    destroy: (data?: { chatTabId?: string }): Promise<{ success: boolean }> => ipcRenderer.invoke('agent:destroy', data),
    setAutoExecute: (enabled: boolean, data?: { chatTabId?: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agent:setAutoExecute', enabled, data),
    setAllowWrite: (enabled: boolean, data?: { chatTabId?: string }): Promise<SetAllowWriteResult> =>
      ipcRenderer.invoke('agent:setAllowWrite', enabled, data),
    continueTask: (additionalSteps?: number, data?: { chatTabId?: string }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('agent:continueTask', additionalSteps, data),
    bind: (data: { chatTabId: string; terminalTabId: string }): Promise<{ success: boolean; boundHost?: string; error?: string }> =>
      ipcRenderer.invoke('agent:bind', data),
    saveConclusion: (data: { content: string }): Promise<{ success: boolean; filePath?: string; error?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('agent:saveConclusion', data),
    onMessage: (callback: (msg: AgentMessage & { chatTabId?: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, msg: AgentMessage & { chatTabId?: string }): void => callback(msg)
      ipcRenderer.on('agent:message', handler)
      return () => {
        ipcRenderer.removeListener('agent:message', handler)
      }
    },
    onStateChange: (callback: (data: { state: string; chatTabId?: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { state: string; chatTabId?: string }): void => callback(data)
      ipcRenderer.on('agent:stateChange', handler)
      return () => {
        ipcRenderer.removeListener('agent:stateChange', handler)
      }
    },
    onConfirmRequest: (callback: (data: { message: string; chatTabId?: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { message: string; chatTabId?: string }): void => callback(data)
      ipcRenderer.on('agent:confirmRequest', handler)
      return () => {
        ipcRenderer.removeListener('agent:confirmRequest', handler)
      }
    },
    onBindingCleared: (callback: (data: { chatTabId?: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { chatTabId?: string }): void => callback(data)
      ipcRenderer.on('agent:bindingCleared', handler)
      return () => {
        ipcRenderer.removeListener('agent:bindingCleared', handler)
      }
    },
    getContext: (data: { chatTabId: string }): Promise<{ success: boolean; hasContext?: boolean; context?: AgentContextSnapshot | null; error?: string }> =>
      ipcRenderer.invoke('agent:getContext', data),
    hasPendingContext: (data: { chatTabId: string }): Promise<{ success: boolean; hasPending: boolean; resumeType?: 'continue' | 'replan' | 'none'; error?: string }> =>
      ipcRenderer.invoke('agent:hasPendingContext', data),
    discardContext: (data: { chatTabId: string }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('agent:discardContext', data),
    saveLastActiveTab: (data: { chatTabId: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agent:saveLastActiveTab', data)
  },

  terminal: {
    connect: (
      tabId: string,
      hostId: string,
      cols: number,
      rows: number
    ): Promise<{ success: boolean; generation?: number; error?: string }> =>
      ipcRenderer.invoke('terminal:connect', { tabId, hostId, cols, rows }),
    write: (tabId: string, data: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('terminal:write', { tabId, data }),
    resize: (tabId: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke('terminal:resize', tabId, cols, rows),
    disconnect: (tabId: string): Promise<{ success: boolean }> => ipcRenderer.invoke('terminal:disconnect', tabId),
    respondHostTrust: (data: SshHostTrustResponse): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('terminal:respondHostTrust', data),
    resetHostTrust: (hostId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('terminal:resetHostTrust', hostId),
    getRecentOutput: (tabId: string, lines?: number): Promise<string> =>
      ipcRenderer.invoke('terminal:getRecentOutput', tabId, lines),
    exportOutput: (data: { defaultFileName?: string; content: string }): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('terminal:exportOutput', data),
    getCurrentHost: (tabId: string): Promise<unknown> => ipcRenderer.invoke('terminal:getCurrentHost', tabId),
    isConnected: (tabId: string): Promise<boolean> => ipcRenderer.invoke('terminal:isConnected', tabId),
    connectLocal: (
      tabId: string,
      cols: number,
      rows: number
    ): Promise<{ success: boolean; generation?: number; error?: string }> =>
      ipcRenderer.invoke('terminal:connectLocal', { tabId, cols, rows }),
    connectJumpserver: (
      tabId: string,
      cols: number,
      rows: number,
      tokenId: string,
      clientUrl: string,
      assetName: string,
      accountName?: string
    ): Promise<{ success: boolean; generation?: number; error?: string }> =>
      ipcRenderer.invoke('terminal:connectJumpserver', { tabId, cols, rows, tokenId, clientUrl, assetName, accountName }),
    reconnect: (
      tabId: string,
      target: import('../main/model/workspace').ReconnectTarget,
      cols: number,
      rows: number
    ): Promise<{ success: boolean; generation?: number; error?: string }> =>
      ipcRenderer.invoke('terminal:reconnect', { tabId, target, cols, rows }),
    onData: (callback: (data: { tabId: string; data: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { tabId: string; data: string }): void => callback(data)
      ipcRenderer.on('terminal:onData', handler)
      return () => {
        ipcRenderer.removeListener('terminal:onData', handler)
      }
    },
    onConnecting: (callback: (data: { tabId: string; generation: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { tabId: string; generation: number }): void => callback(data)
      ipcRenderer.on('terminal:onConnecting', handler)
      return () => {
        ipcRenderer.removeListener('terminal:onConnecting', handler)
      }
    },
    onConnected: (callback: (data: { tabId: string; generation: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { tabId: string; generation: number }): void => callback(data)
      ipcRenderer.on('terminal:onConnected', handler)
      return () => {
        ipcRenderer.removeListener('terminal:onConnected', handler)
      }
    },
    onHostTrustRequired: (callback: (data: SshHostTrustRequiredEvent) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: SshHostTrustRequiredEvent): void => callback(data)
      ipcRenderer.on('terminal:onHostTrustRequired', handler)
      return () => {
        ipcRenderer.removeListener('terminal:onHostTrustRequired', handler)
      }
    },
    onClosed: (callback: (data: { tabId: string; generation: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { tabId: string; generation: number }): void => callback(data)
      ipcRenderer.on('terminal:onClosed', handler)
      return () => {
        ipcRenderer.removeListener('terminal:onClosed', handler)
      }
    },
    onShellClosed: (callback: (data: { tabId: string; generation: number; detail?: string; exitCode?: number; signal?: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { tabId: string; generation: number; detail?: string; exitCode?: number; signal?: number }): void => callback(data)
      ipcRenderer.on('terminal:onShellClosed', handler)
      return () => {
        ipcRenderer.removeListener('terminal:onShellClosed', handler)
      }
    },
    onError: (callback: (data: { tabId: string; generation: number; error: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { tabId: string; generation: number; error: string }): void => callback(data)
      ipcRenderer.on('terminal:onError', handler)
      return () => {
        ipcRenderer.removeListener('terminal:onError', handler)
      }
    },
    onReconnectTarget: (
      callback: (data: { tabId: string; target: import('../main/model/workspace').ReconnectTarget }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { tabId: string; target: import('../main/model/workspace').ReconnectTarget }
      ): void => callback(data)
      ipcRenderer.on('terminal:onReconnectTarget', handler)
      return () => {
        ipcRenderer.removeListener('terminal:onReconnectTarget', handler)
      }
    }
  },

  workspace: {
    load: (): Promise<
      | { found: false }
      | { recoverable: true; snapshot: WorkspaceSnapshotV1 }
      | { recoverable: false; reason: string }
    > => ipcRenderer.invoke('workspace:load'),
    save: (snapshot: WorkspaceSnapshotV1): Promise<
      | { success: true; snapshot: WorkspaceSnapshotV1 }
      | { success: false; error: string }
    > => ipcRenderer.invoke('workspace:save', snapshot),
    clear: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('workspace:clear')
  },

  chatHistory: {
    load: (): Promise<
      | { found: false }
      | { valid: true; history: ChatHistoryV1 }
      | { valid: false; reason: string }
    > => ipcRenderer.invoke('chatHistory:load'),
    save: (history: ChatHistoryV1): Promise<
      | { success: true; history: ChatHistoryV1 }
      | { success: false; error: string }
    > => ipcRenderer.invoke('chatHistory:save', history),
    clear: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('chatHistory:clear')
  },

  jumpserver: {
    getConfig: (): Promise<(JumpserverConfig & { hasCredential: boolean }) | null> =>
      ipcRenderer.invoke('jumpserver:getConfig'),
    getConfigs: (): Promise<Array<JumpserverConfig & { hasCredential: boolean }>> =>
      ipcRenderer.invoke('jumpserver:getConfigs'),
    getActiveConfigId: (): Promise<string | null> =>
      ipcRenderer.invoke('jumpserver:getActiveConfigId'),
    saveConfig: (
      data: {
        name: string
        baseUrl: string
        authMode: 'token' | 'password' | 'access_key'
        username?: string
        accessKeyId?: string
        accessKeySecret?: string
        verifyTls: boolean
        credential?: string
      },
      configId?: string | null
    ): Promise<(JumpserverConfig & { hasCredential: boolean }) | { success: false; error: string }> =>
      ipcRenderer.invoke('jumpserver:saveConfig', data, configId),
    setActiveConfig: (configId: string): Promise<JumpserverConfig | null> =>
      ipcRenderer.invoke('jumpserver:setActiveConfig', configId),
    deleteConfig: (configId?: string | null): Promise<boolean> =>
      ipcRenderer.invoke('jumpserver:deleteConfig', configId),
    testConfig: (configId?: string): Promise<JumpserverTestResult> => ipcRenderer.invoke('jumpserver:testConfig', configId),
    getSecret: (configId: string): Promise<string | null> => ipcRenderer.invoke('jumpserver:getSecret', configId),
    listAssets: (query?: { keyword?: string; limit?: number; offset?: number }): Promise<JumpserverAssetsResult> =>
      ipcRenderer.invoke('jumpserver:listAssets', query),
    listNodes: (parentKey?: string): Promise<JumpserverNodesResult> =>
      ipcRenderer.invoke('jumpserver:listNodes', parentKey),
    listNodeAssets: (nodeId: string, query?: { keyword?: string; limit?: number; offset?: number }): Promise<JumpserverAssetsResult> =>
      ipcRenderer.invoke('jumpserver:listNodeAssets', nodeId, query),
    listAccounts: (assetId: string): Promise<JumpserverAccountsResult> =>
      ipcRenderer.invoke('jumpserver:listAccounts', assetId),
    createToken: (assetId: string, accountId: string): Promise<JumpserverSessionParamsResult> =>
      ipcRenderer.invoke('jumpserver:createToken', assetId, accountId),
    getQuickAccess: (): Promise<{ favorites: JumpserverQuickAccessItem[]; recent: JumpserverQuickAccessItem[] }> =>
      ipcRenderer.invoke('jumpserver:getQuickAccess'),
    toggleFavorite: (asset: { assetId: string; name: string; address: string; platform: string; comment: string }): Promise<{ favorites: JumpserverQuickAccessItem[]; recent: JumpserverQuickAccessItem[] }> =>
      ipcRenderer.invoke('jumpserver:toggleFavorite', asset),
    recordRecent: (asset: { assetId: string; name: string; address: string; platform: string; comment: string }): Promise<{ favorites: JumpserverQuickAccessItem[]; recent: JumpserverQuickAccessItem[] }> =>
      ipcRenderer.invoke('jumpserver:recordRecent', asset),
    getAccountPreferences: (): Promise<Record<string, JumpserverAccountPreference>> =>
      ipcRenderer.invoke('jumpserver:getAccountPreferences'),
    saveAccountPreference: (assetId: string, accountId: string, accountName: string): Promise<Record<string, JumpserverAccountPreference>> =>
      ipcRenderer.invoke('jumpserver:saveAccountPreference', assetId, accountId, accountName)
  },

  update: {
    check: (): Promise<{
      success: boolean
      data?: { hasUpdate: boolean; latestVersion: string; notes: string; downloadUrl: string; sha256: string }
      error?: string
    }> => ipcRenderer.invoke('update:check'),
    download: (
      downloadUrl: string,
      sha256: string
    ): Promise<{ success: boolean; filePath?: string; error?: string }> =>
      ipcRenderer.invoke('update:download', downloadUrl, sha256),
    install: (filePath: string): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('update:install', filePath),
    getVersion: (): Promise<string> => ipcRenderer.invoke('update:getVersion'),
    onDownloadProgress: (
      callback: (progress: { downloaded: number; total: number }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: { downloaded: number; total: number }
      ): void => callback(progress)
      ipcRenderer.on('update:download-progress', handler)
      return () => {
        ipcRenderer.removeListener('update:download-progress', handler)
      }
    }
  },

  preferences: {
    get: (key: string): Promise<unknown> => ipcRenderer.invoke('preferences:get', key),
    set: (key: string, value: unknown): Promise<void> => ipcRenderer.invoke('preferences:set', key, value)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
