/**
 * 前端 Agent 状态防乱序 guard。
 *
 * 背景：ChatPanel 收到 `agent:stateChange` 后会立即写入事件状态，并异步发起
 * `agent:getStatus` 刷新。若较早的 `summarizing` 状态快照在较晚的 `completed`
 * 状态事件之后返回，它会将已完成状态回滚为 `summarizing`，导致输入框持续禁用。
 *
 * 策略：给每个 `chatTabId` 维护
 *   - `stateVersion`：每次收到 `stateChange` 时递增；
 *   - `latestSeq`：每次发起 `getStatus` 时递增。
 *
 * 当 `getStatus` 响应回来时，只有当：
 *   - 请求发起时记录的版本号 === 当前版本号（期间无新的 `stateChange`）；
 *   - 请求发起时记录的序号 === 该标签最新请求序号（不是过期请求）；
 *
 * 才允许用响应中的 `state` 字段写回 `agentState`；否则丢弃 `state` 字段，
 * 绝不让旧快照回滚较新的事件状态。
 *
 * 所有版本号、请求序号均按 `chatTabId` 隔离，避免跨标签状态污染。
 */

/** 发起一次 getStatus 刷新时记录的上下文 */
export interface RefreshRequest {
  /** 发起本次刷新时该标签的状态版本号 */
  version: number
  /** 本次刷新请求的序号（按标签自增） */
  seq: number
}

/**
 * 判断一个 getStatus 响应是否仍然可以写回 `state` 字段（纯函数，便于单测）。
 *
 * 规则：
 *   - 若该标签在请求发起后又收到新的 `stateChange`
 *     （`currentVersion !== requestVersion`）：事件权威，旧快照丢弃；
 *   - 若该标签在此期间又发起了新的 `getStatus` 请求
 *     （`requestSeq !== latestSeq`）：以最新请求为准，旧响应丢弃；
 *   - 否则允许写回。
 *
 * @param requestVersion 发起刷新时记录的状态版本号
 * @param requestSeq     发起刷新时记录的请求序号
 * @param currentVersion 该标签当前最新的状态版本号
 * @param latestSeq      该标签当前最新的刷新请求序号
 */
export function shouldApplyStatusState(
  requestVersion: number,
  requestSeq: number,
  currentVersion: number,
  latestSeq: number
): boolean {
  // 请求发起后又收到新的 stateChange：事件权威，旧快照丢弃
  if (requestVersion !== currentVersion) return false
  // 请求发起后又发起了新的 getStatus：以最新请求为准，旧响应丢弃
  if (requestSeq !== latestSeq) return false
  return true
}

/**
 * 按 `chatTabId` 维护状态版本号与刷新请求序号的有状态封装。
 * 每个 `chatTabId` 完全独立，避免跨标签污染。
 */
export class AgentStatusGuard {
  /** chatTabId → 状态版本号（每次 stateChange 递增） */
  private readonly stateVersion = new Map<string, number>()
  /** chatTabId → 最新刷新请求序号（每次 beginRefresh 递增） */
  private readonly latestSeq = new Map<string, number>()

  /** 收到 agent:stateChange 时调用：递增该标签的状态版本号 */
  bumpStateVersion(tabId: string): number {
    const next = (this.stateVersion.get(tabId) ?? 0) + 1
    this.stateVersion.set(tabId, next)
    return next
  }

  /**
   * 发起 agent:getStatus 时调用：记录当时的版本号，递增请求序号。
   * 返回的 request 应随响应一起回传给 shouldApplyState 做判定。
   */
  beginRefresh(tabId: string): RefreshRequest {
    const seq = (this.latestSeq.get(tabId) ?? 0) + 1
    this.latestSeq.set(tabId, seq)
    const version = this.stateVersion.get(tabId) ?? 0
    return { version, seq }
  }

  /**
   * getStatus 响应回来时调用：判断是否应写回响应中的 `state` 字段。
   * 需要传入 beginRefresh 返回的 request。
   */
  shouldApplyState(tabId: string, request: RefreshRequest): boolean {
    const currentVersion = this.stateVersion.get(tabId) ?? 0
    const latestSeq = this.latestSeq.get(tabId) ?? 0
    return shouldApplyStatusState(
      request.version,
      request.seq,
      currentVersion,
      latestSeq
    )
  }

  /** 清理某标签的所有记录（标签关闭时调用） */
  cleanup(tabId: string): void {
    this.stateVersion.delete(tabId)
    this.latestSeq.delete(tabId)
  }
}
