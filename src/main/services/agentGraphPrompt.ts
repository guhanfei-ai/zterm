/**
 * Prompt builders for Agent graph nodes.
 * Extracted from the old AgentController to keep graph nodes clean.
 */
import { AgentGraphState, SystemInfo } from './agentGraphState'

/** Terminal context passed from the bridge at invocation time */
export interface TerminalContext {
  hostName: string
  hostDetails?: string
  source?: 'direct' | 'jumpserver' | 'local'
  recentOutput: string
}

/** System prompt for the Agent model */
export function buildAgentSystemPrompt(allowWrite: boolean): string {
  const writeMode = allowWrite ? '允许' : '禁止'
  return `你是一个 Linux 运维 Agent。你运行在一个连接到真实服务器的终端旁边。
你的工作是：
1. 分析用户的任务
2. 制定排查步骤
3. 生成可执行的 shell 命令
4. 根据命令输出判断下一步

重要规则：
- 每次只规划一步，不要一次规划太多
- 当前模式${writeMode}写操作。${allowWrite ? '写操作需要谨慎规划。' : '只能使用读操作命令（如 ls, cat, grep, find, df, free, top, ps, systemctl status, journalctl 等）。不要规划任何修改、安装、创建、删除、重启服务类的命令。'}
- 不要执行可能造成数据丢失的命令
- 如果问题已定位，输出 "DONE: 你的结论"
- 如果认为不需要进一步操作，输出 "DONE: 原因"

输出格式：
PLAN: 当前步骤的计划说明
COMMAND: 单行 shell 命令（可选，如不需要则留空）
OBSERVATION: 对上一步输出的判断（执行命令时必填）
DONE: 最终结论（仅在任务完成时使用）`
}

/** Build the planning prompt for a specific step */
export function buildPlanningPrompt(
  state: AgentGraphState,
  terminalCtx: TerminalContext | null
): string {
  const previousSteps = state.steps
    .filter((s) => s.status === 'done' || s.status === 'blocked' || s.status === 'skipped')
    .map((s) => `步骤 ${s.stepNumber}：执行 \`${s.command || '(无命令)'}\`，结果：${s.observation}`)
    .join('\n')

  const systemInfoSection = state.systemDetected && state.systemInfo.distroName
    ? `\n系统环境：${state.systemInfo.distroName} ${state.systemInfo.distroVersion}（内核 ${state.systemInfo.kernel}）${state.systemInfo.packageManager ? `，包管理器 ${state.systemInfo.packageManager}` : ''}\n`
    : state.systemInfo.rawOutput
      ? `\n已探测系统环境：\n\`\`\`\n${state.systemInfo.rawOutput}\n\`\`\`\n`
      : ''

  const sourceLabel = terminalCtx?.source === 'jumpserver' ? '（Jumpserver 跳板机）' : terminalCtx?.source === 'direct' ? '（直连）' : ''

  return `当前任务：${state.taskDescription}
这是第 ${state.currentStep}/${state.maxSteps} 步。
${systemInfoSection}
当前服务器：${terminalCtx?.hostName || '未知'}${sourceLabel}
最近终端输出：
\`\`\`
${terminalCtx?.recentOutput || '(无)'}
\`\`\`

${previousSteps ? `已完成步骤：\n${previousSteps}\n` : ''}
请按照格式返回下一步计划。
如果任务已完成，输出 DONE: 结论。`
}

/** Build the observation prompt after a command execution */
export function buildObservationPrompt(
  stepNum: number,
  command: string,
  output: string,
  taskDescription: string
): string {
  return `步骤 ${stepNum} 执行命令：\`${command}\`
命令输出：
\`\`\`
${output.slice(0, 2000)}
\`\`\`

当前任务：${taskDescription}

请判断：
1. 这个输出说明了什么？
2. 下一步应该做什么？
3. 如果问题已定位，输出 DONE: 结论。

格式：OBSERVATION: 观察判断，然后 PLAN: 下一步计划（如果需要继续）。`
}

/** Build the summary prompt for final conclusion */
export function buildSummaryPrompt(
  taskDescription: string,
  steps: AgentGraphState['steps']
): string {
  const stepLog = steps
    .map(
      (s) =>
        `步骤 ${s.stepNumber}: ${s.plan}\n  执行: \`${s.command || '(无)'}\`\n  结果: ${s.observation}`
    )
    .join('\n\n')

  return `任务已完成或达到最大步数：${taskDescription}

执行记录：
${stepLog}

请给出最终总结：
1. 发现了什么？
2. 根本原因是什么？
3. 建议的处理方案？
4. 风险提示？

输出 DONE: 你的完整结论（使用 Markdown 格式，包含标题、列表、粗体等）。`
}

/** Parse raw probe output into structured system info */
export function parseSystemInfo(raw: string): SystemInfo {
  const info: SystemInfo = { kernel: '', distroName: '', distroVersion: '', packageManager: '', rawOutput: '' }

  const unameMatch = raw.match(/Linux\s+\S+\s+(\S+)/)
  if (unameMatch) info.kernel = unameMatch[1]

  const idMatch = raw.match(/^ID="?(\w+)"?$/m)
  const versionMatch = raw.match(/^VERSION_ID="?([^"\n]+)"?$/m)
  const nameMatch = raw.match(/^NAME="?([^"\n]+)"?$/m)

  if (nameMatch) {
    info.distroName = nameMatch[1]
  } else if (idMatch) {
    info.distroName = idMatch[1].charAt(0).toUpperCase() + idMatch[1].slice(1)
  }
  if (versionMatch) info.distroVersion = versionMatch[1]

  if (!info.distroName) {
    const lsbDistId = raw.match(/Distributor ID:\s*(.+)/)
    const lsbRelease = raw.match(/Release:\s*(.+)/)
    if (lsbDistId) info.distroName = lsbDistId[1].trim()
    if (lsbRelease) info.distroVersion = lsbRelease[1].trim()
  }

  if (!info.distroName) {
    const rhMatch = raw.match(/(CentOS|Red Hat Enterprise Linux|Rocky|AlmaLinux|Fedora)\s+(?:Linux\s+)?release\s+(\S+)/i)
    if (rhMatch) {
      info.distroName = rhMatch[1]
      info.distroVersion = rhMatch[2]
    }
  }

  const distroLower = info.distroName.toLowerCase()
  if (distroLower.includes('ubuntu') || distroLower.includes('debian') || distroLower.includes('linux mint') || distroLower.includes('pop')) {
    info.packageManager = 'apt'
  } else if (distroLower.includes('centos') || distroLower.includes('red hat') || distroLower.includes('rhel') || distroLower.includes('rocky') || distroLower.includes('alma') || distroLower.includes('fedora')) {
    info.packageManager = distroLower.includes('fedora') ? 'dnf' : 'yum'
  } else if (distroLower.includes('suse') || distroLower.includes('opensuse')) {
    info.packageManager = 'zypper'
  } else if (distroLower.includes('arch') || distroLower.includes('manjaro')) {
    info.packageManager = 'pacman'
  } else if (distroLower.includes('alpine')) {
    info.packageManager = 'apk'
  } else if (distroLower.includes('gentoo')) {
    info.packageManager = 'emerge'
  }

  return info
}

/**
 * 轻量"是否必须先执行只读命令"的判定。
 * 不追求完美 NLP，只覆盖高频运维动作词。
 * 用于"是否允许首轮 0 步 DONE / 聊天结束"这道硬 guard。
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

/** Parse AI model response into structured result */
export function parseAIResponse(text: string): {
  plan?: string
  command?: string
  observation?: string
  done?: boolean
} {
  const result: { plan?: string; command?: string; observation?: string; done?: boolean } = {}

  const doneMatch = text.match(/^DONE:\s*(.+)/im)
  if (doneMatch) {
    result.done = true
    return result
  }

  const planMatch = text.match(/^PLAN:\s*(.+)/im)
  if (planMatch) result.plan = planMatch[1].trim()

  const cmdMatch = text.match(/^COMMAND:\s*([\s\S]+)/im)
  if (cmdMatch) {
    let cmd = cmdMatch[1]
    const nextSection = cmd.match(/\n(?:PLAN|COMMAND|OBSERVATION|DONE):/i)
    if (nextSection && nextSection.index !== undefined) {
      cmd = cmd.slice(0, nextSection.index)
    }
    cmd = cmd.trim()
    if (cmd && cmd !== '(无命令)' && cmd !== '(无)') {
      result.command = cmd
    }
  }

  const obsMatch = text.match(/^OBSERVATION:\s*(.+)/im)
  if (obsMatch) result.observation = obsMatch[1].trim()

  return result
}

/**
 * 系统 prompt：思辨节点让模型自己决定是「聊」还是「干」。
 * 替代旧的 buildAgentSystemPrompt 强格式——think 节点同时承担"聊天"与"规划"两种输出。
 */
export function buildThinkSystemPrompt(allowWrite: boolean): string {
  const writeMode = allowWrite ? '允许' : '禁止'
  return `你是一个运行在 Linux 终端旁的智能助手。

你有两种工作方式，由你自己判断哪种更合适：

**方式一：直接回答（聊天）**
当用户的输入是提问、追问、闲聊、或要求解释时，直接用自然语言回答。
你不需要输出任何特殊格式，就像正常聊天一样。
如果用户说"继续"、"然后呢"、"详细说说"、"为什么会这样"，你应该回顾上下文并给分析建议。

**方式二：执行操作**
当用户请求需要实际操作（排查、部署、配置、监控等），使用以下格式：
  PLAN: 当前步骤的计划说明（单行）
  COMMAND: 单行 shell 命令
  DONE: 最终结论（任务完成时使用）

重要规则：
- 当前模式${writeMode}写操作。${allowWrite ? '写操作需要谨慎规划。' : '只能使用读操作命令（如 ls, cat, grep, find, df, free, top, ps, systemctl status, journalctl 等）。'}
- 不要执行可能造成数据丢失的命令
- 只有当你判断"确实需要执行操作"时才出 PLAN/COMMAND
- 如果用户的话不需要操作，自然回复就好
- 如果你已经完成任务或无需进一步操作，输出 DONE: 结论

强制约束（关键）：
- 当用户请求是"检查 / 观察 / 排查 / 状态 / 资源 / 服务 / 进程 / 端口 / 日志"类问题时，
  **不能只凭登录欢迎信息、shell prompt、残留终端输出就直接下结论**。
- 对这类问题，必须先通过至少一条只读命令（如 ps aux、systemctl status、ss -tlnp、
  journalctl、df -h、free -h、uptime 等）获取真实证据，再给结论。
- 禁止"零步执行"直接给排查结论。如果你不确定要跑什么，至少跑一个系统概览命令
  （如 \`ps aux --sort=-%cpu | head -20\` 或 \`uptime\` 或 \`systemctl list-units --type=service --state=running\`）。
- "只读模式"仅禁止"写操作"，不禁止执行只读命令 —— 排查问题本来就要看真实状态。`
}

/**
 * 用户 prompt：把上下文、已完成步骤、终端输出、当前服务器信息打包给模型。
 * 区分首次交互和循环回 think——首次强调"先判断意图"，循环回强调"决定继续 / 完成 / 沟通"。
 */
export function buildThinkUserPrompt(
  state: AgentGraphState,
  userMessage: string,
  terminalCtx: TerminalContext | null
): string {
  // think 现在是 START 的直接下一节点，不再有 probe_system 塞 step 0。
  // 但稳妥起见仍按"业务步骤"判定，避免历史 checkpoint 里残留 step 0 时误判。
  const isFirstInteraction = state.steps.filter(s => s.stepNumber > 0).length === 0

  const parts: string[] = []

  // 当前任务目标（无论是否首次都要带上，避免模型遗忘）
  if (state.taskDescription) {
    parts.push(`当前任务：${state.taskDescription}`)
  }

  if (isFirstInteraction) {
    parts.push(`\n用户说：${userMessage}`)

    // 首轮 + 检查型请求 → 显式强约束（修复 Agent "会聊不会干"）
    if (shouldRequireInspection(userMessage, terminalCtx)) {
      parts.push('')
      parts.push('【执行意图硬约束】本条请求被识别为"检查 / 观察 / 排查 / 状态"类问题。')
      parts.push('- 禁止只凭登录 banner / shell prompt / 残留输出 直接给结论。')
      parts.push('- 必须先落至少一条只读命令获取真实证据（进程 / 服务 / 端口 / 资源 / 日志）。')
      parts.push('- 只读模式 = 禁止写，不等于禁止执行只读命令。')
      parts.push('- 此刻不允许 DONE，必须出 PLAN + COMMAND。')
    }
  }

  // 自然对话历史（最近 N 轮）—— 让"你刚才说的"这类追问能接上
  if (state.conversationHistory && state.conversationHistory.length > 0) {
    parts.push('\n对话历史（最近的发言）：')
    const recent = state.conversationHistory.slice(-8)
    for (const turn of recent) {
      const tag = turn.role === 'user' ? '用户' : '助手'
      const text = turn.content.length > 400 ? turn.content.slice(0, 400) + '…' : turn.content
      parts.push(`- ${tag}：${text}`)
    }
  }

  // 已完成步骤
  const completedSteps = state.steps.filter(s => s.status !== 'pending')
  if (completedSteps.length > 0) {
    parts.push('\n已完成步骤回顾：')
    for (const s of completedSteps.slice(-10)) {
      parts.push(`- 步骤 ${s.stepNumber}：${s.plan || '(无计划)'}`)
      if (s.command) parts.push(`  命令：\`${s.command}\``)
      if (s.observation) parts.push(`  结果：${s.observation.slice(0, 300)}`)
      parts.push(`  状态：${s.status}`)
    }
  }

  // 系统环境
  if (state.systemDetected && state.systemInfo.distroName) {
    parts.push(`\n系统环境：${state.systemInfo.distroName} ${state.systemInfo.distroVersion}（内核 ${state.systemInfo.kernel}）${state.systemInfo.packageManager ? `，包管理器 ${state.systemInfo.packageManager}` : ''}`)
  } else if (state.systemInfo.rawOutput) {
    parts.push(`\n已探测系统环境：\n\`\`\`\n${state.systemInfo.rawOutput.slice(0, 800)}\n\`\`\``)
  }

  // 最近命令输出（执行流水线回归 think 时）
  if (state.commandOutput) {
    parts.push(`\n上一步命令输出：\n\`\`\`\n${state.commandOutput.slice(0, 2000)}\n\`\`\``)
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

  if (!isFirstInteraction) {
    parts.push(`\n你刚执行完步骤 ${state.currentStep}，请判断：`)
    parts.push('1. 是否需要继续执行下一步？如果需要，出 PLAN + COMMAND')
    parts.push('2. 是否任务已完成？如果完成，出 DONE: 结论')
    parts.push('3. 是否需要跟用户沟通（比如解释结果、询问方向）？如果是，直接聊天回复')
  } else {
    parts.push('\n请判断用户意图：如果只是聊天/提问，直接回复；如果需要执行操作，出 PLAN + COMMAND')
  }

  return parts.join('\n')
}
