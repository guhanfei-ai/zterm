import { AgentController, type AgentMessage, type AgentStatus, type SetAllowWriteResult } from '../../services/agentController'
import { TerminalBridge, type AnyTerminalSession } from '../../services/terminalBridge'
import { AiClient, type ProviderConfig } from '../../services/aiClient'
import { getStore } from '../../services/store'
import { getSecret } from '../../services/secretVault'
import { terminalSessionManager, getLocalSession } from '../../data/terminal/terminalSessionRegistry'
import {
  clearContext,
  loadContext,
  getResumeType,
  adoptOrphanedContext,
  saveLastActiveChatTabId
} from '../../services/agentContextStore'

export interface AgentEventSink {
  send(channel: 'agent:message' | 'agent:stateChange' | 'agent:confirmRequest' | 'agent:bindingCleared', payload: unknown): void
}

interface AgentTabState {
  controller: AgentController
  chatTabId: string
  terminalTabId: string | null
  boundHost: string
  sink: AgentEventSink | null
  registeredTerminalEventKeys: Set<string>
  cleanupTerminalEventListeners: Array<() => void>
  startTaskLock: boolean
}

export interface StartAgentTaskCommand {
  chatTabId: string
  description: string
  maxSteps?: number
  isNewTask?: boolean
}

export interface BindAgentCommand {
  chatTabId: string
  terminalTabId: string
}

/**
 * Agent 产品用例。
 * 这里决定 Agent 何时可启动、绑定哪个正式终端、是否允许写入以及如何恢复任务；
 * Electron IPC 只负责转发命令和事件。
 */
export class AgentApplication {
  private readonly tabs = new Map<string, AgentTabState>()
  private aiClient: AiClient | null = null

  setAiClient(client: AiClient): void {
    this.aiClient = client
  }

  disposeAll(): void {
    for (const [chatTabId, tab] of this.tabs) {
      try {
        tab.controller.stop()
        tab.controller.getRuntime()?.removeTab(chatTabId)
        this.cleanupTerminalListeners(tab)
        tab.controller.removeAllListeners('message')
        tab.controller.removeAllListeners('state-change')
        tab.controller.removeAllListeners('confirm-request')
        tab.controller.dispose()
        tab.sink = null
      } catch {
        // 退出清理不阻塞应用关闭。
      }
    }
    this.tabs.clear()
  }

  async startTask(command: StartAgentTaskCommand, sink: AgentEventSink): Promise<{ success: boolean; error?: string }> {
    try {
      if (!command?.chatTabId || !command.description) {
        return { success: false, error: '缺少对话标签或任务描述' }
      }
      if (!this.aiClient) return { success: false, error: 'Agent 服务未初始化' }

      const config = this.getProviderConfig()
      if (!config) return { success: false, error: '模型未配置' }

      const tab = this.getOrCreateTab(command.chatTabId)
      if (tab.startTaskLock) return { success: false, error: 'Agent 正在启动中' }

      tab.startTaskLock = true
      tab.sink = sink
      tab.controller.setChatTabId(command.chatTabId)
      const releaseLock = (): void => { tab.startTaskLock = false }

      if (!tab.terminalTabId) {
        const status = tab.controller.getStatus()
        if (status.boundTerminalTabId) {
          const recovered = this.resolveAnySession(status.boundTerminalTabId)
          if (recovered?.connected) tab.terminalTabId = status.boundTerminalTabId
        }
        if (!tab.terminalTabId && status.boundHost) {
          for (const session of terminalSessionManager.getAllSessions()) {
            if (!session.connected || !session.currentHost) continue
            const host = `${session.currentHost.username}@${session.currentHost.host}`
            if (host === status.boundHost) {
              tab.terminalTabId = session.tabId
              break
            }
          }
        }
        if (!tab.terminalTabId) {
          releaseLock()
          return { success: false, error: '请先绑定终端：点击“绑定当前终端”按钮，将 Agent 关联到一台已连接的主机' }
        }
      }

      const session = this.resolveAnySession(tab.terminalTabId)
      if (!session?.connected) {
        tab.terminalTabId = null
        tab.boundHost = ''
        releaseLock()
        return { success: false, error: '绑定的终端已断开，请重新绑定终端' }
      }

      const terminalStates = ['idle', 'completed', 'failed', 'stopped', 'stepLimitReached']
      if (!terminalStates.includes(tab.controller.state)) {
        releaseLock()
        return { success: false, error: 'Agent 正忙' }
      }

      const bridge = new TerminalBridge(session)
      this.bindControllerEvents(tab)
      this.registerTerminalEventListeners(tab, session)
      tab.controller.init(this.aiClient, bridge, config)
      tab.controller.state = 'starting'
      // 立即通知渲染层进入 starting：
      // 否则在 graph 首个状态回调（planning）到来之前，renderer 的 agentState
      // 仍是上一个终态，用户重复提交会绕过前端防重直接打进主进程
      this.send(tab, 'agent:stateChange', { state: 'starting', chatTabId: tab.chatTabId })

      void tab.controller.startTask(command.description, command.maxSteps || 25, { isNewTask: command.isNewTask === true })
        .catch((err: Error) => {
          tab.controller.state = 'failed'
          this.send(tab, 'agent:stateChange', { state: 'failed', chatTabId: tab.chatTabId })
          this.send(tab, 'agent:message', {
            id: `${Date.now()}`,
            type: 'error',
            content: `Agent 执行异常：${err.message}`,
            createdAt: new Date().toISOString(),
            chatTabId: tab.chatTabId
          })
        })
        .finally(releaseLock)

      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : '启动 Agent 失败' }
    }
  }

  stop(chatTabId?: string): { success: true } {
    if (chatTabId) this.tabs.get(chatTabId)?.controller.stop()
    return { success: true }
  }

  confirmCommand(approved: boolean, chatTabId?: string): { success: true } {
    if (chatTabId) this.tabs.get(chatTabId)?.controller.approveCommand(approved)
    return { success: true }
  }

  getStatus(chatTabId?: string): AgentStatus | { state: 'idle'; maxSteps: number; elapsedSteps: number; autoExecute: boolean; allowWrite: boolean; steps: []; error: string } {
    if (!chatTabId) return this.emptyStatus('未指定对话标签')
    return this.tabs.get(chatTabId)?.controller.getStatus() ?? this.emptyStatus('未找到 Agent 会话')
  }

  reset(chatTabId?: string): { success: true } {
    if (!chatTabId) return { success: true }
    const tab = this.tabs.get(chatTabId)
    if (!tab) return { success: true }
    this.cleanupTerminalListeners(tab)
    tab.controller.reset()
    tab.boundHost = ''
    tab.terminalTabId = null
    return { success: true }
  }

  fullReset(chatTabId?: string): { success: true } {
    if (!chatTabId) return { success: true }
    const tab = this.tabs.get(chatTabId)
    if (!tab) return { success: true }
    this.cleanupTerminalListeners(tab)
    tab.controller.fullReset()
    tab.boundHost = ''
    tab.terminalTabId = null
    clearContext(chatTabId)
    return { success: true }
  }

  destroy(chatTabId?: string): { success: true } {
    if (!chatTabId) return { success: true }
    const tab = this.tabs.get(chatTabId)
    if (!tab) return { success: true }
    this.cleanupTerminalListeners(tab)
    tab.controller.fullReset()
    tab.controller.getRuntime()?.removeTab(chatTabId)
    tab.controller.removeAllListeners('message')
    tab.controller.removeAllListeners('state-change')
    tab.controller.removeAllListeners('confirm-request')
    tab.controller.dispose()
    this.tabs.delete(chatTabId)
    return { success: true }
  }

  setAutoExecute(enabled: boolean, chatTabId?: string): { success: true } {
    if (chatTabId) this.tabs.get(chatTabId)?.controller.setAutoExecute(enabled)
    return { success: true }
  }

  setAllowWrite(enabled: boolean, chatTabId?: string): SetAllowWriteResult {
    if (!chatTabId) return { success: false, error: '未指定对话标签' }
    const tab = this.tabs.get(chatTabId)
    if (!tab) return { success: false, error: 'Agent 会话不存在' }
    if (!enabled) return tab.controller.setAllowWrite(false)
    if (!tab.terminalTabId) return { success: false, error: '未绑定终端，请先绑定一台已连接的主机' }
    const session = this.resolveAnySession(tab.terminalTabId)
    if (!session?.connected) return { success: false, error: '绑定的终端已断开，请重新绑定终端' }
    return tab.controller.setAllowWrite(true)
  }

  async continueTask(additionalSteps?: number, chatTabId?: string): Promise<{ success: boolean; error?: string }> {
    const tab = chatTabId ? this.tabs.get(chatTabId) : undefined
    if (!tab) return { success: false, error: '未找到 Agent 会话' }
    try {
      await tab.controller.continueTask(additionalSteps)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : '续跑失败' }
    }
  }

  bind(command: BindAgentCommand, sink: AgentEventSink): { success: boolean; boundHost?: string; error?: string } {
    if (!command?.chatTabId || !command.terminalTabId) return { success: false, error: '缺少对话标签或终端标签' }
    const tab = this.getOrCreateTab(command.chatTabId)
    tab.sink = sink
    tab.controller.setChatTabId(command.chatTabId)
    const session = this.resolveAnySession(command.terminalTabId)
    if (!session?.connected) return { success: false, error: '终端未连接，无法绑定' }
    const config = this.getProviderConfig()
    if (!this.aiClient || !config) return { success: false, error: 'Agent 服务未初始化或模型未配置' }

    const bridge = new TerminalBridge(session)
    tab.controller.init(this.aiClient, bridge, config)
    const boundHost = tab.controller.bind()
    if (boundHost) {
      tab.boundHost = boundHost
      tab.terminalTabId = command.terminalTabId
      tab.controller.setBoundTerminalTabId(command.terminalTabId)
      this.registerTerminalEventListeners(tab, session)
      tab.controller.setAllowWrite(false)
      return { success: true, boundHost }
    }

    const identity = bridge.getDisplayIdentity()
    if (!identity) return { success: false, error: '终端未连接，无法绑定' }
    const host = identity.displayDetail
    tab.controller.setBoundHost(host)
    tab.controller.setBoundTerminalTabId(command.terminalTabId)
    tab.boundHost = host
    tab.terminalTabId = command.terminalTabId
    this.registerTerminalEventListeners(tab, session)
    tab.controller.setAllowWrite(false)
    return { success: true, boundHost: host }
  }

  getContext(chatTabId: string): { success: boolean; hasContext?: boolean; context?: unknown; error?: string } {
    if (!chatTabId) return { success: false, error: '缺少 chatTabId' }
    let context = loadContext(chatTabId)
    if (context) return { success: true, hasContext: true, context }
    context = adoptOrphanedContext(chatTabId)
    return context ? { success: true, hasContext: true, context } : { success: true, hasContext: false, context: null }
  }

  hasPendingContext(chatTabId: string): { success: boolean; hasPending: boolean; resumeType: ReturnType<typeof getResumeType> } {
    if (!chatTabId) return { success: false, hasPending: false, resumeType: 'none' }
    const resumeType = getResumeType(chatTabId)
    return { success: true, hasPending: resumeType !== 'none', resumeType }
  }

  discardContext(chatTabId: string): { success: boolean; error?: string } {
    if (!chatTabId) return { success: false, error: '缺少 chatTabId' }
    clearContext(chatTabId)
    return { success: true }
  }

  saveLastActiveTab(chatTabId: string): { success: boolean } {
    if (!chatTabId) return { success: false }
    saveLastActiveChatTabId(chatTabId)
    return { success: true }
  }

  private getOrCreateTab(chatTabId: string): AgentTabState {
    let tab = this.tabs.get(chatTabId)
    if (!tab) {
      tab = {
        controller: new AgentController(),
        chatTabId,
        terminalTabId: null,
        boundHost: '',
        sink: null,
        registeredTerminalEventKeys: new Set(),
        cleanupTerminalEventListeners: [],
        startTaskLock: false
      }
      this.tabs.set(chatTabId, tab)
    }
    return tab
  }

  private getProviderConfig(): ProviderConfig | null {
    const raw = getStore().get('provider_config')
    if (!raw || typeof raw !== 'object') return null
    const config = { ...(raw as ProviderConfig) }
    const apiKey = getSecret('provider_api_key')
    if (apiKey) config.apiKey = apiKey
    return config
  }

  private resolveAnySession(tabId: string): AnyTerminalSession | undefined {
    return terminalSessionManager.getSession(tabId) || getLocalSession(tabId)
  }

  private bindControllerEvents(tab: AgentTabState): void {
    tab.controller.removeAllListeners('message')
    tab.controller.removeAllListeners('state-change')
    tab.controller.removeAllListeners('confirm-request')
    tab.controller.on('message', (message: AgentMessage) => {
      this.send(tab, 'agent:message', { ...message, chatTabId: tab.chatTabId })
    })
    tab.controller.on('state-change', (state: string) => {
      this.send(tab, 'agent:stateChange', { state, chatTabId: tab.chatTabId })
    })
    tab.controller.on('confirm-request', (data: { message: string }) => {
      this.send(tab, 'agent:confirmRequest', { ...data, chatTabId: tab.chatTabId })
    })
  }

  private registerTerminalEventListeners(tab: AgentTabState, session: AnyTerminalSession): void {
    const key = `term:${session.tabId}`
    if (tab.registeredTerminalEventKeys.has(key)) return
    tab.registeredTerminalEventKeys.add(key)

    const unavailable = (reason: string): void => this.handleTerminalUnavailable(tab.chatTabId, reason)
    const onClosed = (info?: { reason?: string }): void => {
      if (info?.reason === 'user-disconnect') {
        // 用户主动断开不告警，但需清除注册标记，否则重连后新 session 不会再注册监听
        tab.registeredTerminalEventKeys.delete(key)
        return
      }
      tab.registeredTerminalEventKeys.delete(key)
      unavailable('终端已断开')
    }
    const onError = (): void => unavailable('终端发生错误')
    const onShellClosed = (): void => unavailable('终端 Shell 已关闭')

    session.on('closed', onClosed)
    session.on('error', onError)
    session.on('shell-closed', onShellClosed)
    tab.cleanupTerminalEventListeners.push(() => {
      session.removeListener('closed', onClosed)
      session.removeListener('error', onError)
      session.removeListener('shell-closed', onShellClosed)
      tab.registeredTerminalEventKeys.delete(key)
    })
  }

  private handleTerminalUnavailable(chatTabId: string, reason: string): void {
    const tab = this.tabs.get(chatTabId)
    if (!tab) return
    tab.controller.clearBinding()
    this.cleanupTerminalListeners(tab)
    tab.boundHost = ''
    tab.terminalTabId = null

    const status = tab.controller.getStatus()
    if (!['idle', 'completed', 'failed', 'stopped'].includes(status.state)) {
      tab.controller.stop()
      this.send(tab, 'agent:message', {
        id: `${Date.now()}`,
        type: 'error',
        content: `${reason}，Agent 已停止`,
        createdAt: new Date().toISOString(),
        chatTabId
      })
    }
    this.send(tab, 'agent:bindingCleared', { chatTabId })
  }

  private cleanupTerminalListeners(tab: AgentTabState): void {
    tab.cleanupTerminalEventListeners.forEach((cleanup) => cleanup())
    tab.cleanupTerminalEventListeners = []
    tab.registeredTerminalEventKeys.clear()
  }

  private send(tab: AgentTabState, channel: Parameters<AgentEventSink['send']>[0], payload: unknown): void {
    try {
      tab.sink?.send(channel, payload)
    } catch {
      // 渲染端已关闭时忽略事件投递失败。
    }
  }

  private emptyStatus(error: string) {
    return { state: 'idle' as const, maxSteps: 25, elapsedSteps: 0, autoExecute: false, allowWrite: false, steps: [], error }
  }
}
