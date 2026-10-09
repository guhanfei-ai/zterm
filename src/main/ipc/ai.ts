import { registerIpcHandler } from '../services/ipcSecurity'
import { confirmSecretDisclosure } from '../services/ipcSecurity'
import { ProviderSettingsApplication } from '../application/ai/providerSettingsApplication'
import { ChatApplication, type ChatMessage } from '../application/chat/chatApplication'
import { readRecentTerminalOutput } from '../data/terminal/terminalContextRepository'
import { ChatHarness, type ChatStreamEvent } from '../harness/chat/chatHarness'
import { AiClient, type ProviderConfig } from '../services/aiClient'

export const aiClient = new AiClient()

const providerSettingsApplication = new ProviderSettingsApplication(aiClient)
const chatApplication = new ChatApplication(
  new ChatHarness(aiClient),
  { readRecentOutput: readRecentTerminalOutput }
)

/** Electron 传输适配：参数转发、事件转发与生命周期入口。 */
export function registerAiIpc(): void {
  try { providerSettingsApplication.initialize() }
  catch { console.warn('[ai] 凭据暂不可用，模型请求需重新配置或解锁系统钥匙串') }

  registerIpcHandler('ai:getProviderConfig', () => providerSettingsApplication.getPublicProviderConfig())
  registerIpcHandler('ai:revealApiKey', async (event) =>
    await confirmSecretDisclosure(event, '模型 API Key') ? providerSettingsApplication.revealApiKey() : null)

  registerIpcHandler(
    'ai:saveProviderConfig',
    (_event, config: Omit<ProviderConfig, 'providerType'>): { success: boolean; error?: string } =>
      providerSettingsApplication.saveProviderConfig(config)
  )

  registerIpcHandler('ai:setModel', (_event, model: string) => providerSettingsApplication.setModel(model))

  registerIpcHandler(
    'ai:validateProviderConfig',
    async (_event, config: ProviderConfig) => providerSettingsApplication.validateProviderConfig(config)
  )

  registerIpcHandler(
    'ai:chatStream',
    async (
      event,
      command: {
        chatTabId?: string
        messages: ChatMessage[]
        includeTerminalContext?: boolean
        terminalTabId?: string
      }
    ): Promise<void> => {
      const chatTabId = command.chatTabId || '__default__'
      await chatApplication.send(
        {
          chatTabId,
          messages: command.messages,
          includeTerminalContext: command.includeTerminalContext === true,
          terminalTabId: command.terminalTabId
        },
        (streamEvent: ChatStreamEvent) => {
          // 窗口中途关闭后不再投递，并中止该会话的流
          if (event.sender.isDestroyed()) {
            chatApplication.abort(chatTabId)
            return
          }
          event.sender.send('ai:streamChunk', streamEvent)
        }
      )
    }
  )

  registerIpcHandler('ai:abort', (_event, data?: { chatTabId?: string }) => {
    chatApplication.abort(data?.chatTabId || '__default__')
    return { success: true }
  })
}
