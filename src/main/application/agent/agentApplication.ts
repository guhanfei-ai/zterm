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
  saveLastActiveChatTabId,
  updateContext
} from '../../services/agentContextStore'

export interface AgentEventSink {
  send(channel: 'agent:message' | 'agent:stateChange' | 'agent:bindingCleared', payload: unknown): void
}

interface AgentTabState {
  controller: AgentController
  chatTabId: string
  terminalTabId: string | null
  /** 精确到连接实例；同 tabId 重连也不能继承原授权。 */
  boundSession: AnyTerminalSession | null
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
      if (typeof command?.chatTabId !== 'string' || typeof command.description !== 'string' || !command.chatTabId || !command.description.trim()) {
        return { success: false, error: '缺少对话标签或任务描述' }
      }
      if (command.maxSteps !== undefined && (!Number.isSafeInteger(command.maxSteps) || command.maxSteps < 1 || command.maxSteps > 1000)) {
        return { success: false, error: '命令预算必须是 1～1000 的整数' }
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

      // 不凭 tabId 或展示名自动认领新连接：同一标签重连也须重新绑定。
      if (!tab.terminalTabId || !tab.boundSession) {
        releaseLock()
        return { success: false, error: '请先绑定终端：点击“绑定当前终端”按钮，确认当前连接' }
      }
      const session = this.resolveAnySession(tab.terminalTabId)
      if (!session?.connected || session !== tab.boundSession) {
        this.handleTerminalUnavailable(command.chatTabId, '终端会话已更换或断开')
        releaseLock()
        return { success: false, error: '绑定的终端连接已更换，请重新绑定终端并确认权限' }
      }

      const terminalStates = ['idle', 'completed', 'failed', 'stopped', 'stepLimitReached']
      if (!terminalStates.includes(tab.controller.state)) {
        releaseLock()
        return { success: false, error: 'Agent 正忙' }
      }

      const bridge = new TerminalBridge(session)
      const persisted = loadContext(command.chatTabId)
      if (!command.isNewTask && persisted?.taskDescription && persisted.boundTargetId !== bridge.getBoundTargetId()) {
        releaseLock()
        return { success: false, error: persisted.boundTargetId
          ? '当前终端与历史任务的目标不一致，请重新绑定原终端或开启新任务'
          : '旧历史缺少可验证的终端身份，不能自动续跑；请开启新任务，历史记录仍可查看' }
      }
      this.bindControllerEvents(tab)
      this.registerTerminalEventListeners(tab, session)
      tab.controller.init(this.aiClient, bridge, config)
      tab.controller.state = 'starting'
      // 立即通知渲染层进入 starting：
      // 否则在 graph 首个状态回调（planning）到来之前，renderer 的 agentState
      // 仍是上一个终态，用户重复提交会绕过前端防重直接打进主进程
      this.send(tab, 'agent:stateChange', { state: 'starting', chatTabId: tab.chatTabId })

      // Controller 的发起级校验现在同步 throw；执行期错误仍由回调上报。
      tab.controller.startTask(command.description, command.maxSteps || 25, { isNewTask: command.isNewTask === true })
      releaseLock()
      return { success: true }
    } catch (err: unknown) {
      const tab = command?.chatTabId ? this.tabs.get(command.chatTabId) : undefined
      if (tab) {
        tab.startTaskLock = false
        if (tab.controller.state === 'starting') {
          tab.controller.state = 'failed'
          this.send(tab, 'agent:stateChange', { state: 'failed', chatTabId: tab.chatTabId })
        }
      }
      return { success: false, error: err instanceof Error ? err.message : '启动 Agent 失败' }
    }
  }

  stop(chatTabId?: string): { success: true } {
    if (chatTabId) this.tabs.get(chatTabId)?.controller.stop()
    return { success: true }
  }

  getStatus(chatTabId?: string): AgentStatus | { state: 'idle'; maxSteps: number; elapsedSteps: number; allowWrite: boolean; steps: []; error: string } {
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
    tab.boundSession = null
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
    tab.boundSession = null
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
    tab.controller.dispose()
    this.tabs.delete(chatTabId)
    return { success: true }
  }

  setAllowWrite(enabled: boolean, chatTabId?: string): SetAllowWriteResult {
    if (!chatTabId) return { success: false, error: '未指定对话标签' }
    const tab = this.tabs.get(chatTabId)
    if (!tab) return { success: false, error: 'Agent 会话不存在' }
    if (!enabled) return tab.controller.setAllowWrite(false)
    if (!tab.terminalTabId || !tab.boundSession) return { success: false, error: '未绑定终端，请先绑定一台已连接的主机' }
    const session = this.resolveAnySession(tab.terminalTabId)
    if (!session?.connected || session !== tab.boundSession) {
      this.handleTerminalUnavailable(chatTabId, '终端会话已更换或断开')
      return { success: false, error: '绑定的终端连接已更换，请重新绑定后再授权写入' }
    }
    return tab.controller.setAllowWrite(true)
  }

  continueTask(additionalSteps?: number, chatTabId?: string): { success: boolean; error?: string } {
    if (additionalSteps !== undefined && (!Number.isSafeInteger(additionalSteps) || additionalSteps < 1 || additionalSteps > 1000)) {
      return { success: false, error: '命令预算必须是 1～1000 的整数' }
    }
    const tab = chatTabId ? this.tabs.get(chatTabId) : undefined
    if (!tab) return { success: false, error: '未找到 Agent 会话' }
    try {
      if (!tab.terminalTabId || !tab.boundSession) {
        return { success: false, error: '终端未绑定，请先确认当前终端连接' }
      }
      const session = this.resolveAnySession(tab.terminalTabId)
      if (!session?.connected || session !== tab.boundSession) {
        this.handleTerminalUnavailable(tab.chatTabId, '终端会话已更换或断开')
        return { success: false, error: '绑定的终端连接已更换，请重新绑定后继续' }
      }
      // I04:与 startTask 同一标准 —— 模型配置被清空/禁用时拒绝继续,
      // 不静默沿用旧密钥/旧模型续跑。
      const config = this.getProviderConfig()
      if (!config) return { success: false, error: '模型未配置' }
      // G02:点"继续"同样是人类介入开启下一轮 —— 重读当前设置,
      // 经 controller.init 同步给 runtime(updateConfig),Runtime 按配置
      // 指纹决定沿用会话或重建,下一请求用当前配置。
      // H02:配置刷新与终端重绑定职责分离 —— 继续只同步配置,**不换 bridge**:
      // 传 controller 当前持有的同一 bridge(init 只在 bridge 变化时 dispose),
      // Runtime 侧的绑定保持有效;终端真正重绑(用户重新 bind)才换 bridge,
      // 且那时 startTask 会把新绑定写入 runtime 的 tab.bridge。
      if (this.aiClient) {
        const currentBridge = tab.controller.getBridge()
        if (currentBridge) {
          tab.controller.init(this.aiClient, currentBridge, config)
        }
      }
      // 同步点火契约（与 startTask 对齐）：controller 同步完成校验与后台点火，
      // 发起级错误在此捕获返回渲染进程；执行期错误走事件流，不再占用本返回
      tab.controller.continueTask(additionalSteps)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : '续跑失败' }
    }
  }

  bind(command: BindAgentCommand, sink: AgentEventSink): { success: boolean; boundHost?: string; error?: string } {
    if (!command?.chatTabId || !command.terminalTabId) return { success: false, error: '缺少对话标签或终端标签' }
    const tab = this.getOrCreateTab(command.chatTabId)
    // 运行中不能只替换 Controller 的 bridge：旧 Pi 轮次仍可能继续输出，
    // 导致界面显示新主机却呈现旧主机的回复。要求先明确停止旧轮。
    if (tab.startTaskLock ||
        !['idle', 'completed', 'failed', 'stopped', 'stepLimitReached'].includes(tab.controller.state) ||
        tab.controller.getRuntime()?.isRunning(command.chatTabId)) {
      return { success: false, error: 'Agent 正在运行，请先停止任务再重新绑定终端' }
    }
    tab.sink = sink
    tab.controller.setChatTabId(command.chatTabId)
    const session = this.resolveAnySession(command.terminalTabId)
    if (!session?.connected) return { success: false, error: '终端未连接，无法绑定' }
    if (process.platform === 'win32' && session.sessionMeta?.source === 'local') {
      return { success: false, error: 'Windows 本地终端暂不支持 Agent 完成协议；请绑定具有 POSIX Shell 的 SSH 或 Jumpserver 终端' }
    }
    const config = this.getProviderConfig()
    if (!this.aiClient || !config) return { success: false, error: 'Agent 服务未初始化或模型未配置' }

    const bridge = new TerminalBridge(session)
    const identity = bridge.getDisplayIdentity()
    if (!bridge.getBoundTargetId() || !identity) {
      return { success: false, error: '无法验证终端目标身份或 Shell 尚未就绪，请检查连接后重新绑定' }
    }
    tab.controller.init(this.aiClient, bridge, config)
    // 重启后的恢复从 bind → continueTask 发起，不经过 startTask。
    this.bindControllerEvents(tab)
    const host = tab.controller.bind() ?? identity.displayDetail
    tab.controller.setBoundHost(host)
    tab.controller.setBoundTerminalTabId(command.terminalTabId)
    tab.boundHost = host
    tab.terminalTabId = command.terminalTabId
    this.cleanupTerminalListeners(tab)
    tab.boundSession = session
    this.registerTerminalEventListeners(tab, session)
    tab.controller.setAllowWrite(false)
    updateContext(command.chatTabId, { allowWrite: false })
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
        boundSession: null,
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
    tab.controller.on('message', (message: AgentMessage) => {
      this.send(tab, 'agent:message', { ...message, chatTabId: tab.chatTabId })
    })
    tab.controller.on('state-change', (state: string) => {
      this.send(tab, 'agent:stateChange', { state, chatTabId: tab.chatTabId })
    })
  }

  private registerTerminalEventListeners(tab: AgentTabState, session: AnyTerminalSession): void {
    const key = `term:${session.tabId}`
    if (tab.registeredTerminalEventKeys.has(key)) return
    tab.registeredTerminalEventKeys.add(key)

    const unavailable = (reason: string): void => {
      if (tab.boundSession === session) this.handleTerminalUnavailable(tab.chatTabId, reason)
    }
    const onClosed = (info?: { reason?: string }): void => {
      tab.registeredTerminalEventKeys.delete(key)
      // 主动断开也必须撤销绑定与写权限，否则同 tabId 重连继承旧授权。
      unavailable(info?.reason === 'user-disconnect' ? '终端已主动断开' : '终端已断开')
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
    tab.boundSession = null
    updateContext(chatTabId, { allowWrite: false })

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
    return { state: 'idle' as const, maxSteps: 25, elapsedSteps: 0, allowWrite: false, steps: [], error }
  }
}
