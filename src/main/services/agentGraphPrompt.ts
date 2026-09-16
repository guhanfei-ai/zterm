/**
 * Prompt builders for Agent graph nodes.
 *
 * 2026-09-16 对话优先重构（作者决策：聊天一等公民，工具执行二等公民）：
 * 旧 think / observation / summary 三套提示词收敛为 reply 主循环一套。
 * 上下文主轴 = conversationHistory（用户 / 助手 / 工具结果三种回合），
 * steps 与 recentKeyOutputs 只做持久化审计，不再进入模型上下文（避免三重冗余）。
 */
import { AgentGraphState, PendingCommand } from './agentGraphState'

/** Terminal context passed from the bridge at invocation time */
export interface TerminalContext {
  hostName: string
  hostDetails?: string
  source?: 'direct' | 'jumpserver' | 'local'
  recentOutput: string
}

/** 单条对话回合在 prompt 中的最大长度 */
const TURN_MAX_CHARS = 1000
/** 工具结果（命令输出 / 拦截反馈）在 prompt 中的最大长度 */
const TOOL_TURN_MAX_CHARS = 2000
/** prompt 中保留的最近回合数（工具回合会消耗名额，取宽一点） */
const HISTORY_TURNS = 24

function clampText(text: string, max: number): string {
  if (!text) return ''
  if (text.length <= max) return text
  return text.slice(0, max) + '…[已截断]'
}

/**
 * 系统 prompt：reply 主循环 —— 对话优先，命令是取证工具而非任务目标。
 */
export function buildReplySystemPrompt(allowWrite: boolean): string {
  const writeMode = allowWrite ? '允许' : '禁止'
  return `你是一个运行在 Linux 终端旁的智能助手，用户会和你正常对话。

对话是默认工作方式：提问、闲聊、追问、解释，都直接自然回复，像坐在终端旁边的同事。
只有当需要了解机器的真实状态（排查、检查、看资源 / 服务 / 进程 / 端口 / 日志等）时，才执行命令取证。

需要执行命令时，在回复中用协议块给出（可以先写自然语言说明，两部分都会展示给用户）：
PLAN: 这条命令的目的（单行）
COMMAND: 单行 shell 命令
（可以给多组，按顺序逐条执行；每条都会独立做安全检查）

命令执行后，结果会以「工具结果」追加到对话里，你基于它继续回应用户。

规则：
- 大多数消息正常聊天就够了，不要为了"像在干活"而执行不必要的命令
- 用户要判断机器状态（进程 / 服务 / 端口 / 磁盘 / 内存 / 日志等）时，必须先执行只读命令拿真实证据再下结论，禁止只凭登录信息或残留输出猜测
- 当前模式${writeMode}写操作。${allowWrite ? '写操作需要谨慎规划。' : '只能使用读操作命令（如 ls, cat, grep, find, df, free, top, ps, systemctl status, journalctl 等）。'}
- 不要执行可能造成数据丢失的命令
- 命令被安全策略拦截时对话里会有「工具结果」反馈：换个思路，或向用户解释需要什么权限，不要原样重试
- 回复就是回复：不要输出 DONE 之类的收尾标记；没有 COMMAND 块，本轮就自然结束`
}

/**
 * 用户 prompt：话题 + 本轮请求 + 对话历史（含工具结果）+ 环境上下文。
 * conversationHistory 是唯一上下文主轴。
 */
export function buildReplyUserPrompt(
  state: AgentGraphState,
  userMessage: string,
  terminalCtx: TerminalContext | null
): string {
  const isFirstInteraction = state.steps.filter(s => s.stepNumber > 0).length === 0

  const parts: string[] = []

  if (state.taskDescription) {
    parts.push(`当前话题：${state.taskDescription}`)
  }
  if (userMessage) {
    parts.push(`用户本轮请求：${userMessage}`)
  }

  // 首轮 + 检查型请求 → 显式强约束（执行纪律：先取证再结论，优先级高于聊天）
  if (isFirstInteraction && shouldRequireInspection(userMessage, terminalCtx)) {
    parts.push('')
    parts.push('【执行意图硬约束】本条请求被识别为"检查 / 观察 / 排查 / 状态"类问题。')
    parts.push('- 禁止只凭登录 banner / shell prompt / 残留输出 直接给结论。')
    parts.push('- 必须先落至少一条只读命令获取真实证据（进程 / 服务 / 端口 / 资源 / 日志）。')
    parts.push('- 只读模式 = 禁止写，不等于禁止执行只读命令。')
    parts.push('- 此刻不允许只聊天收尾，必须出 PLAN + COMMAND。')
  }

  // 对话与工具结果 —— 上下文主轴
  if (state.conversationHistory && state.conversationHistory.length > 0) {
    parts.push('\n对话与工具结果（时间序）：')
    const recent = state.conversationHistory.slice(-HISTORY_TURNS)
    for (const turn of recent) {
      if (turn.role === 'user') {
        parts.push(`- 用户：${clampText(turn.content, TURN_MAX_CHARS)}`)
      } else if (turn.role === 'assistant') {
        parts.push(`- 助手：${clampText(turn.content, TURN_MAX_CHARS)}`)
      } else {
        parts.push(`- 工具结果${turn.command ? `（\`${turn.command}\`）` : ''}：${clampText(turn.content, TOOL_TURN_MAX_CHARS)}`)
      }
    }
  }

  // 系统环境
  if (state.systemDetected && state.systemInfo.distroName) {
    parts.push(`\n系统环境：${state.systemInfo.distroName} ${state.systemInfo.distroVersion}（内核 ${state.systemInfo.kernel}）${state.systemInfo.packageManager ? `，包管理器 ${state.systemInfo.packageManager}` : ''}`)
  } else if (state.systemInfo.rawOutput) {
    parts.push(`\n已探测系统环境：\n\`\`\`\n${state.systemInfo.rawOutput.slice(0, 800)}\n\`\`\``)
  }

  // 终端上下文
  if (terminalCtx) {
    const sourceLabel = terminalCtx.source === 'jumpserver' ? '（Jumpserver 跳板机）' : terminalCtx.source === 'direct' ? '（直连）' : ''
    parts.push(`\n当前服务器：${terminalCtx.hostName}${sourceLabel}`)
    if (terminalCtx.hostDetails) {
      parts.push(`服务器详情：${terminalCtx.hostDetails}`)
    }
    if (terminalCtx.recentOutput) {
      parts.push(`最近终端输出：\n\`\`\`\n${terminalCtx.recentOutput.slice(0, 800)}\n\`\`\``)
    }
  }

  parts.push('\n请继续对话：基于已有工具结果回应用户；还需要更多证据就给 PLAN + COMMAND；本轮要收尾就直接自然回复。')

  return parts.join('\n')
}

/**
 * 轻量"是否必须先执行只读命令"的判定。
 * 不追求完美 NLP，只覆盖高频运维动作词。
 * 用于首轮零命令回复的强制取证 guard（repair 节点）。
 */
const INSPECTION_KEYWORDS = [
  '看看', '检查', '排查', '确认', '列出', '查看',
  '运行了什么', '跑了什么', '在跑什么', '在运行什么', '启动了哪些',
  '进程', '服务', '端口', '监听', '日志',
  'cpu', '内存', '磁盘', '网络', '负载', '状态',
  '资源', '占用',
  '有没有', '是否存在', '是否在', '是否正常', '是否运行', '是否启动',
  'systemctl', 'journalctl', 'netstat', 'lsof', 'uptime', 'uname',
  'nginx', 'mysql', 'redis', 'mongo', 'docker', 'k8s', 'kubernetes',
  'system', 'service', 'process', 'memory', 'disk', 'port', 'log',
  'show', 'list', 'check', 'inspect', 'running', 'status'
]

export function shouldRequireInspection(taskDescription: string, _terminalCtx: TerminalContext | null = null): boolean {
  if (!taskDescription) return false
  const text = taskDescription.toLowerCase()
  for (const kw of INSPECTION_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) return true
  }
  return false
}

/**
 * Parse AI model response into structured result.
 *
 * 协议契约（reply 主循环输出）：
 *   - 自由自然语言（聊天 / 解释），可与命令混排
 *   - 一个或多个 PLAN + COMMAND 对；COMMAND 块可跨行，到下一个协议行或文末结束
 *   - DONE: 结论 —— 新协议已不需要；仅为兼容模型旧习惯保留解析，
 *     reply 节点会剥掉前缀按普通收尾回复处理（出现即视为无命令）
 *
 * `commands` 始终是数组（可能为空）；`plan`/`command` 保留为第一条命令的别名，
 * 兼容只看单命令的旧调用方。
 */
export function parseAIResponse(text: string): {
  plan?: string
  command?: string
  observation?: string
  done?: boolean
  commands: PendingCommand[]
} {
  const result: {
    plan?: string
    command?: string
    observation?: string
    done?: boolean
    commands: PendingCommand[]
  } = { commands: [] }

  const doneMatch = text.match(/^DONE:\s*(.+)/im)
  if (doneMatch) {
    result.done = true
    return result
  }

  // 逐行扫描：PLAN 记为"最近计划"，COMMAND 块与之配对；
  // 命令体持续到下一个协议行（PLAN/COMMAND/OBSERVATION/DONE）或文末
  const lines = text.split('\n')
  let currentPlan: string | undefined
  let i = 0
  while (i < lines.length) {
    const planMatch = lines[i].match(/^PLAN:\s*(.*)$/i)
    if (planMatch) {
      currentPlan = planMatch[1].trim() || undefined
      i++
      continue
    }
    const cmdMatch = lines[i].match(/^COMMAND:\s*(.*)$/i)
    if (cmdMatch) {
      const buf: string[] = []
      if (cmdMatch[1].trim()) buf.push(cmdMatch[1])
      i++
      while (i < lines.length && !/^(?:PLAN|COMMAND|OBSERVATION|DONE):/i.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      const cmd = buf.join('\n').trim()
      if (cmd && cmd !== '(无命令)' && cmd !== '(无)') {
        result.commands.push({ plan: currentPlan, command: cmd })
      }
      continue
    }
    i++
  }

  if (result.commands.length > 0) {
    result.plan = result.commands[0].plan
    result.command = result.commands[0].command
  }

  const obsMatch = text.match(/^OBSERVATION:\s*(.+)/im)
  if (obsMatch) result.observation = obsMatch[1].trim()

  return result
}

/**
 * 剔除 PLAN/COMMAND/OBSERVATION/DONE 协议块，返回纯自然语言部分。
 * 用于"边聊边干"场景：reply 输出中的解释文字投进聊天气泡，协议行不外显。
 */
export function stripProtocolLines(text: string): string {
  const kept: string[] = []
  // COMMAND/DONE 块可跨行，直到下一个协议行；PLAN/OBSERVATION 只有单行
  let skippingBlock = false
  for (const line of text.split('\n')) {
    if (/^(?:PLAN|COMMAND|OBSERVATION|DONE):/i.test(line)) {
      skippingBlock = /^(?:COMMAND|DONE):/i.test(line)
      continue
    }
    if (skippingBlock) continue
    kept.push(line)
  }
  return kept.join('\n').trim()
}
