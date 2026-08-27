import { useChatStore } from '@/stores/chat'
import { AgentStatusGuard } from '@/utils/agentStatusGuard'

/**
 * 应用级 Agent 全局事件监听。
 *
 * 修复说明（此前的问题）：
 * 全局 Agent 监听器（onMessage / onStateChange / onConfirmRequest / onBindingCleared）
 * 原先注册在 ChatPanel 组件内，随右侧面板 v-if 卸载而注销，且重新显示时不会重建。
 * 任务在后台执行期间隐藏面板会导致消息与状态事件永久丢失且无重放机制。
 * 现改为在 App.vue 挂载一次、应用存活期内常驻，事件按 chatTabId 路由写入 store，
 * 面板重新显示时时间线自然完整。
 */

/** 状态防乱序 guard：跨 ChatPanel 挂载/卸载共享同一实例，保证版本号语义连续 */
export const agentStatusGuard = new AgentStatusGuard()

/** ChatPanel 挂载时注册的"消息到达时自动滚动"回调；面板隐藏时置 null（不滚动即可） */
let onMessageArrivedHook: ((chatTabId: string) => void) | null = null

export function setAgentMessageArrivedHook(hook: ((chatTabId: string) => void) | null): void {
  onMessageArrivedHook = hook
}

const globalUnsubs: Array<() => void> = []

/** 全局状态刷新：只写 store（不涉及组件级 UI ref），供 onStateChange 与组件复用 */
export async function refreshAgentStatusByTabId(tabId: string): Promise<void> {
  const chatStore = useChatStore()
  // 发起请求前记录当时的版本号与请求序号；响应回来时据此判断是否可写回 state 字段
  const request = agentStatusGuard.beginRefresh(tabId)
  try {
    const status = await window.electronAPI.agent.getStatus({ chatTabId: tabId })
    // 非状态字段（status / 步数 / 读写模式 / 绑定信息）可按最新请求正常刷新
    chatStore.setAgentStatusByTabId(tabId, status)
    chatStore.setAutoExecuteByTabId(tabId, status.autoExecute)
    chatStore.setAllowWriteByTabId(tabId, status.allowWrite)
    // state 字段受 guard 保护：只有当本次响应仍是该标签最新刷新请求，
    // 且请求期间未收到新的 stateChange 时，才允许写回；否则丢弃，避免旧快照回滚终态
    if (agentStatusGuard.shouldApplyState(tabId, request)) {
      chatStore.setAgentStateByTabId(tabId, status.state)
    }
  } catch { /* ignore */ }
}

/**
 * 注册全局 Agent 事件监听（幂等，应用级只注册一次，不随面板卸载注销）。
 * 在 App.vue 的 setup 中调用。
 */
export function setupAgentGlobalEvents(): void {
  if (globalUnsubs.length > 0) return // already registered

  const chatStore = useChatStore()

  globalUnsubs.push(
    window.electronAPI.agent.onMessage((msg) => {
      const chatTabId = msg.chatTabId
      if (!chatTabId) return
      const details = msg.details as Record<string, unknown> | undefined
      chatStore.addAgentMessageByTabId(chatTabId, {
        id: msg.id,
        type: msg.type,
        stepNumber: msg.stepNumber,
        content: msg.content,
        details: msg.details,
        createdAt: msg.createdAt,
        thinkingId: details?.thinkingId as string | undefined,
        streaming: details?.streaming as boolean | undefined
      })
      // 面板可见时才需要自动滚动（由 ChatPanel 注入回调）
      if (chatTabId === chatStore.activeTabId && onMessageArrivedHook) {
        onMessageArrivedHook(chatTabId)
      }
    })
  )

  globalUnsubs.push(
    window.electronAPI.agent.onStateChange((data) => {
      const chatTabId = data.chatTabId
      if (!chatTabId) return
      const state = data.state
      // P1-4：IPC 边界是 string，运行时用白名单校验
      // 拼写错误的状态会被忽略而不是静默接受
      const knownStates = ['starting', 'idle', 'planning', 'executing', 'observing', 'summarizing', 'completed', 'failed', 'stopped', 'stepLimitReached'] as const
      if (!(knownStates as readonly string[]).includes(state)) {
        console.warn('[agent] 收到未知 AgentState:', state)
        return
      }
      chatStore.setAgentStateByTabId(chatTabId, state as typeof knownStates[number])
      // 递增该标签的状态版本号：之后到达的旧 getStatus 响应将被丢弃 state 字段，
      // 避免旧的 summarizing 快照回滚较新的 completed 终态
      agentStatusGuard.bumpStateVersion(chatTabId)
      // 异步刷新补充步数/绑定等非状态字段；state 字段受 guard 保护
      void refreshAgentStatusByTabId(chatTabId)
      if (state === 'completed' || state === 'failed' || state === 'stopped') {
        chatStore.finalizeExecutionMessagesByTabId(chatTabId)
        chatStore.finalizeThinkingOnStopByTabId(chatTabId)
        chatStore.setConfirmRequestByTabId(chatTabId, null)
      }
    })
  )

  globalUnsubs.push(
    window.electronAPI.agent.onConfirmRequest((data) => {
      const chatTabId = data.chatTabId
      if (!chatTabId) return
      chatStore.setConfirmRequestByTabId(chatTabId, {
        message: data.message,
        pendingCommand: ''
      })
    })
  )

  globalUnsubs.push(
    window.electronAPI.agent.onBindingCleared((data) => {
      const chatTabId = data.chatTabId
      if (!chatTabId) return
      // Directly clear binding for the target tab — no activeTab switch needed
      chatStore.clearBindingByTabId(chatTabId)
    })
  )
}
