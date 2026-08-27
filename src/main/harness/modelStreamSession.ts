/**
 * 单次模型调用的可取消生命周期。
 * 它属于 Harness，不属于 Provider 协议适配器。
 */
export class ModelStreamSession {
  public readonly sessionId: string
  public readonly abortController = new AbortController()
  public active = true

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  abort(): void {
    this.active = false
    this.abortController.abort()
  }
}
