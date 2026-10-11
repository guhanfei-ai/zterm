import type { EventEmitter } from 'node:events'

/** 模拟接收握手与传输解码，只供组合测试记录命令，绝不执行脚本。 */
export function createFakeAgentReceiver(events: EventEmitter) {
  let nonce: string | undefined
  return (input: string): { command: string; nonce: string } | null => {
    const bootstrap = input.match(/'__ZTERM_AGENT_END_' '([a-f0-9]{32})__'/)
    if (bootstrap) {
      nonce = bootstrap[1]
      events.emit('data', Buffer.from(`\r\n__ZTERM_AGENT_INPUT_${nonce}__\r\n`))
      return null
    }
    if (!nonce || !input.endsWith(`\n__ZTERM_AGENT_SEND_${nonce}__\n`)) return null
    const token = nonce
    nonce = undefined
    const encoded = input.slice(0, input.lastIndexOf('\n__ZTERM_AGENT_SEND_')).replace(/\n/g, '')
    const bytes = encoded.replace(/\\(?:0([0-7]{3})|(\\))/g,
      (_, octal: string | undefined, slash: string | undefined) => slash ?? String.fromCharCode(parseInt(octal!, 8)))
    return { command: Buffer.from(bytes, 'latin1').toString('utf8'), nonce: token }
  }
}
