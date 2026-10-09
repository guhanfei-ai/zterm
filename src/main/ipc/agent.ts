import { registerIpcHandler } from '../services/ipcSecurity'
import { BrowserWindow, dialog } from 'electron'
import { writeFileSync } from 'fs'
import {
  AgentApplication,
  type AgentEventSink,
  type BindAgentCommand,
  type StartAgentTaskCommand
} from '../application/agent/agentApplication'
import { AiClient } from '../services/aiClient'

const agentApplication = new AgentApplication()

function buildConclusionFilename(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('')
  const time = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('')
  return `zterm-${date}-${time}-结论.md`
}

function createEventSink(sender: Electron.WebContents): AgentEventSink {
  return {
    send(channel, payload): void {
      if (!sender.isDestroyed()) sender.send(channel, payload)
    }
  }
}

export function setAiClient(client: AiClient): void {
  agentApplication.setAiClient(client)
}

/** 应用退出时中止所有 Agent 任务并释放生命周期资源。 */
export function disposeAllAgentTabs(): void {
  agentApplication.disposeAll()
}

/** Electron 传输适配：参数转发、事件转发与系统保存对话框。 */
export function registerAgentIpc(): void {
  registerIpcHandler('agent:startTask', (event, data: StartAgentTaskCommand) =>
    agentApplication.startTask(data, createEventSink(event.sender))
  )

  registerIpcHandler('agent:stop', (_event, data?: { chatTabId?: string }) =>
    agentApplication.stop(data?.chatTabId)
  )

  registerIpcHandler('agent:getStatus', (_event, data?: { chatTabId?: string }) =>
    agentApplication.getStatus(data?.chatTabId)
  )

  registerIpcHandler('agent:reset', (_event, data?: { chatTabId?: string }) =>
    agentApplication.reset(data?.chatTabId)
  )

  registerIpcHandler('agent:fullReset', (_event, data?: { chatTabId?: string }) =>
    agentApplication.fullReset(data?.chatTabId)
  )

  registerIpcHandler('agent:destroy', (_event, data?: { chatTabId?: string }) =>
    agentApplication.destroy(data?.chatTabId)
  )

  registerIpcHandler('agent:setAllowWrite', (_event, enabled: boolean, data?: { chatTabId?: string }) =>
    agentApplication.setAllowWrite(enabled, data?.chatTabId)
  )

  registerIpcHandler('agent:continueTask', (_event, additionalSteps?: number, data?: { chatTabId?: string }) =>
    agentApplication.continueTask(additionalSteps, data?.chatTabId)
  )

  registerIpcHandler('agent:bind', (event, data: BindAgentCommand) =>
    agentApplication.bind(data, createEventSink(event.sender))
  )

  registerIpcHandler('agent:saveConclusion', async (_event, data: { content: string }) => {
    try {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      if (!win) return { success: false, error: '无可用窗口' }
      const result = await dialog.showSaveDialog(win, {
        defaultPath: buildConclusionFilename(),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        title: '保存结论为 Markdown'
      })
      if (result.canceled || !result.filePath) return { success: false, canceled: true }
      writeFileSync(result.filePath, data.content, 'utf-8')
      return { success: true, filePath: result.filePath }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : '保存失败' }
    }
  })

  registerIpcHandler('agent:getContext', (_event, data: { chatTabId: string }) =>
    agentApplication.getContext(data?.chatTabId)
  )

  registerIpcHandler('agent:hasPendingContext', (_event, data: { chatTabId: string }) =>
    agentApplication.hasPendingContext(data?.chatTabId)
  )

  registerIpcHandler('agent:discardContext', (_event, data: { chatTabId: string }) =>
    agentApplication.discardContext(data?.chatTabId)
  )

  registerIpcHandler('agent:saveLastActiveTab', (_event, data: { chatTabId: string }) =>
    agentApplication.saveLastActiveTab(data?.chatTabId)
  )
}
