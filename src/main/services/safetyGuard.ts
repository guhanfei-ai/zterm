// 命令安全分类：默认只允许读，未识别命令不允许直接放行
//
// v2 判定架构（引号感知分段）：
//   1. 按 shell 语义把整条命令拆成"段"：; | && || 换行切分；
//      $(...) 与反引号内的内容递归提取为独立段（命令替换会被真实执行）。
//   2. 危险模式匹配基于"剥离引号内数据"后的段文本 —— 引号里的 "rm -rf"
//      只是数据，不再误杀；段内真实结构（重定向、flag 组合）仍然命中。
//   3. 读操作白名单只认"段首命令词"（^ 锚定）—— 复合命令中任何一个
//      非白名单段都会让整条命令落入未识别，不再因为包含 ls/echo 等词
//      而被整体放行。
//   4. 代码载体命令（awk/sed/xargs/find 等）的参数（含引号内）额外检查
//      危险执行模式与写操作词。
//
// MVP 简化（作者决策，2026-09-16）：移除人工确认通道 ——
//   - 只读模式：白名单命中即直接执行（含敏感路径读取）；
//   - 读写模式：写命令也直接执行；
//   - P0 危险命令仍然永久拦截。

export interface SafetyCheck {
  safe: boolean
  blocked: boolean
  isWrite: boolean
  isUnknown: boolean
  reason?: string
  category?: string
}

// P0 永久禁止执行的命令模式（匹配对象：剥离引号数据后的段文本）
const BLOCKED_PATTERNS: { pattern: RegExp; reason: string; category: string }[] = [
  { pattern: /\brm\s+(?:-[a-zA-Z]*(?:r[a-zA-Z]*f|f[a-zA-Z]*r)[a-zA-Z]*|-[a-zA-Z]*r[a-zA-Z]*\s+-[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*\s+-[a-zA-Z]*r[a-zA-Z]*|--recursive\b[^|&;]*--force|--force\b[^|&;]*--recursive)/, reason: '禁止执行 rm -rf', category: '数据删除' },
  { pattern: /\brm\s+-r\s+\//, reason: '禁止删除根目录', category: '数据删除' },
  { pattern: /\bmkfs\b/, reason: '禁止格式化文件系统', category: '磁盘操作' },
  { pattern: /\bshutdown\b/, reason: '禁止关机命令', category: '系统控制' },
  { pattern: /\breboot\b/, reason: '禁止重启命令', category: '系统控制' },
  { pattern: /\bhalt\b/, reason: '禁止关机命令', category: '系统控制' },
  { pattern: /\bpoweroff\b/, reason: '禁止关机命令', category: '系统控制' },
  { pattern: /\binit\s+[06]\b/, reason: '禁止切换运行级别', category: '系统控制' },
  { pattern: /\bdd\s+if=.*of=\/dev\//, reason: '禁止直接写磁盘', category: '磁盘操作' },
  { pattern: />+\s*\/etc\//, reason: '禁止覆盖系统配置', category: '系统配置' },
  { pattern: /\bchmod\s+777\s+\//, reason: '禁止修改根目录权限', category: '权限操作' },
]

// 写操作命令模式 — 读操作下直接阻断；写操作下直接执行（MVP：不再人工确认）
// （匹配对象：剥离引号数据后的段文本；对代码载体命令还会用原始文本复查）
const WRITE_PATTERNS: { pattern: RegExp; reason: string; category: string }[] = [
  // ---- 高危变体（优先级必须高于后面的读操作白名单） ----
  { pattern: /\bfind\b.*\s-delete\b/, reason: '高风险写操作：find -delete 会删除文件', category: '文件操作' },
  { pattern: /\bfind\b.*\s-exec\s+rm\b/, reason: '高风险写操作：find -exec rm 会删除文件', category: '文件操作' },
  { pattern: /\bgit\s+branch\s+-[a-zA-Z]*D/, reason: '写操作：强制删除 Git 分支', category: '版本控制' },
  { pattern: /\bgit\s+tag\s+-d\b/, reason: '写操作：删除 Git 标签', category: '版本控制' },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/, reason: '高风险写操作：git clean 会删除未跟踪文件', category: '版本控制' },
  // 覆盖式重定向 / 覆盖写入变体
  { pattern: /\btee\s+/, reason: '写操作：写入文件', category: '文件写入' },
  { pattern: />\s*\S/, reason: '写操作：输出重定向到文件', category: '文件写入' },
  { pattern: />>\s*\S/, reason: '写操作：追加写入文件', category: '文件写入' },
  { pattern: /\b\d+>\s*\S/, reason: '写操作：文件描述符重定向', category: '文件写入' },
  { pattern: /\b&>\s*\S/, reason: '写操作：合并重定向', category: '文件写入' },
  // 文件删除
  { pattern: /\brm\b/, reason: '写操作：删除文件', category: '文件操作' },
  // 文件操作
  { pattern: /\bmkdir\b/, reason: '写操作：创建目录', category: '文件操作' },
  { pattern: /\bcp\s+/, reason: '写操作：复制文件', category: '文件操作' },
  { pattern: /\bmv\s+/, reason: '写操作：移动文件', category: '文件操作' },
  { pattern: /\btouch\s+/, reason: '写操作：创建文件', category: '文件操作' },
  { pattern: /\bln\s+/, reason: '写操作：创建链接', category: '文件操作' },
  { pattern: /\binstall\b/, reason: '写操作：安装文件', category: '文件操作' },
  // 权限/所有者
  { pattern: /\bchmod\b/, reason: '写操作：修改权限', category: '权限操作' },
  { pattern: /\bchown\b/, reason: '写操作：修改所有者', category: '权限操作' },
  { pattern: /\bchgrp\b/, reason: '写操作：修改组', category: '权限操作' },
  // 用户管理
  { pattern: /\buseradd\b/, reason: '写操作：创建用户', category: '用户管理' },
  { pattern: /\busermod\b/, reason: '写操作：修改用户', category: '用户管理' },
  { pattern: /\buserdel\b/, reason: '写操作：删除用户', category: '用户管理' },
  { pattern: /\bgroupadd\b/, reason: '写操作：创建用户组', category: '用户管理' },
  { pattern: /\bgroupdel\b/, reason: '写操作：删除用户组', category: '用户管理' },
  { pattern: /\bpasswd\b/, reason: '写操作：修改密码', category: '用户管理' },
  // 进程控制
  { pattern: /\bkill\s+-9\b/, reason: '写操作：强制终止进程', category: '进程控制' },
  { pattern: /\bkillall\b/, reason: '写操作：批量终止进程', category: '进程控制' },
  { pattern: /\bpkill\b/, reason: '写操作：按名称终止进程', category: '进程控制' },
  // 服务控制
  { pattern: /\bsystemctl\s+(start|stop|restart|enable|disable|mask|unmask)\b/, reason: '写操作：控制服务', category: '服务控制' },
  { pattern: /\bservice\s+\w+\s+(start|stop|restart)\b/, reason: '写操作：控制服务', category: '服务控制' },
  // 包管理
  { pattern: /\bapt(-get)?\s+(install|remove|purge|upgrade|dist-upgrade)\b/, reason: '写操作：管理软件包', category: '包管理' },
  { pattern: /\byum\s+(install|remove|update)\b/, reason: '写操作：管理软件包', category: '包管理' },
  { pattern: /\bdnf\s+(install|remove|upgrade)\b/, reason: '写操作：管理软件包', category: '包管理' },
  { pattern: /\bpip\s+install\b/, reason: '写操作：安装 Python 包', category: '包管理' },
  { pattern: /\bpip\s+uninstall\b/, reason: '写操作：卸载 Python 包', category: '包管理' },
  { pattern: /\bnpm\s+install\b/, reason: '写操作：安装 npm 包', category: '包管理' },
  { pattern: /\bnpm\s+uninstall\b/, reason: '写操作：卸载 npm 包', category: '包管理' },
  // 配置修改
  { pattern: /\bsed\s+.*-i\b/, reason: '写操作：原地修改文件', category: '配置修改' },
  { pattern: /\bcrontab\b/, reason: '写操作：修改定时任务', category: '配置修改' },
  { pattern: /\bexport\s+\w+=/, reason: '写操作：设置环境变量', category: '配置修改' },
  { pattern: /\bunset\b/, reason: '写操作：删除环境变量', category: '配置修改' },
  { pattern: /\bsource\b/, reason: '写操作：执行脚本', category: '配置修改' },
  { pattern: /\b\.\s+\/\w/, reason: '写操作：执行脚本', category: '配置修改' },
  // 网络修改
  { pattern: /\bip\s+(addr|address|link|route|neigh|rule)\s+(add|del|set|replace|change|flush)\b/, reason: '写操作：修改网络配置', category: '网络配置' },
  { pattern: /\bip\s+route\s+flush\b/, reason: '写操作：清空路由表', category: '网络配置' },
  { pattern: /\bip\s+neigh\s+flush\b/, reason: '写操作：清空邻居表', category: '网络配置' },
  { pattern: /\biptables\b/, reason: '写操作：修改防火墙规则', category: '网络配置' },
  // 容器操作
  { pattern: /\bdocker\s+(rm|rmi|system\s+prune)\b/, reason: '写操作：删除 Docker 资源', category: '容器操作' },
  { pattern: /\bdocker\s+run\b/, reason: '写操作：运行 Docker 容器', category: '容器操作' },
  { pattern: /\bdocker\s+exec\b/, reason: '写操作：在容器中执行命令', category: '容器操作' },
  { pattern: /\bdocker\s+(start|stop|restart|pause|unpause|kill)\b/, reason: '写操作：控制 Docker 容器', category: '容器操作' },
  { pattern: /\bdocker\s+(build|push|pull|tag|save|load)\b/, reason: '写操作：Docker 镜像操作', category: '容器操作' },
  { pattern: /\bdocker\s+network\s+(create|rm|connect|disconnect)\b/, reason: '写操作：Docker 网络操作', category: '容器操作' },
  { pattern: /\bdocker\s+volume\s+(create|rm)\b/, reason: '写操作：Docker 卷操作', category: '容器操作' },
  // 版本控制
  { pattern: /\bgit\s+push\b/, reason: '写操作：推送到远端仓库', category: '版本控制' },
  { pattern: /\bgit\s+push\s+--force\b/, reason: '写操作：强制推送 Git', category: '版本控制' },
  { pattern: /\bgit\s+commit\b/, reason: '写操作：提交代码', category: '版本控制' },
  { pattern: /\bgit\s+(merge|rebase|reset|checkout|cherry-pick|stash\s+pop|stash\s+drop)\b/, reason: '写操作：修改 Git 仓库状态', category: '版本控制' },
]

// 读操作白名单 — 只匹配"段的首命令词"（^ 锚定）。
// 任何段只要不是以白名单命令开头，整条命令即落入未识别，
// 不允许进入确认执行阶段。
const READ_ONLY_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // 文件查看
  { pattern: /^ls\b/, reason: '列出文件' },
  { pattern: /^ll\b/, reason: '列出文件（长格式）' },
  { pattern: /^cat\b/, reason: '查看文件内容' },
  { pattern: /^less\b/, reason: '分页查看文件' },
  { pattern: /^more\b/, reason: '分页查看文件' },
  { pattern: /^head\b/, reason: '查看文件头部' },
  { pattern: /^tail\b/, reason: '查看文件尾部' },
  { pattern: /^wc\b/, reason: '统计文件行数/字数' },
  { pattern: /^file\b/, reason: '查看文件类型' },
  { pattern: /^stat\b/, reason: '查看文件状态' },
  { pattern: /^md5sum\b/, reason: '查看文件校验值' },
  { pattern: /^sha256sum\b/, reason: '查看文件校验值' },
  // 搜索
  { pattern: /^grep\b/, reason: '搜索文本' },
  { pattern: /^egrep\b/, reason: '搜索文本（扩展正则）' },
  { pattern: /^fgrep\b/, reason: '搜索文本（固定字符串）' },
  { pattern: /^find\b/, reason: '查找文件' },
  { pattern: /^which\b/, reason: '查找命令路径' },
  { pattern: /^whereis\b/, reason: '查找命令位置' },
  { pattern: /^locate\b/, reason: '查找文件' },
  // 系统信息
  { pattern: /^ps\b/, reason: '查看进程' },
  { pattern: /^top\b/, reason: '查看进程状态' },
  { pattern: /^htop\b/, reason: '查看进程状态' },
  { pattern: /^free\b/, reason: '查看内存' },
  { pattern: /^df\b/, reason: '查看磁盘' },
  { pattern: /^du\b/, reason: '查看目录大小' },
  { pattern: /^uname\b/, reason: '查看系统信息' },
  { pattern: /^hostname\b/, reason: '查看主机名' },
  { pattern: /^uptime\b/, reason: '查看运行时间' },
  { pattern: /^w\b/, reason: '查看登录用户' },
  { pattern: /^who\b/, reason: '查看登录用户' },
  { pattern: /^whoami\b/, reason: '查看当前用户' },
  { pattern: /^id\b/, reason: '查看用户身份' },
  { pattern: /^date\b/, reason: '查看日期' },
  { pattern: /^cal\b/, reason: '查看日历' },
  { pattern: /^lscpu\b/, reason: '查看CPU信息' },
  { pattern: /^lsmem\b/, reason: '查看内存信息' },
  { pattern: /^lspci\b/, reason: '查看PCI设备' },
  { pattern: /^lsusb\b/, reason: '查看USB设备' },
  { pattern: /^lsblk\b/, reason: '查看块设备' },
  { pattern: /^mount\b/, reason: '查看挂载信息' },
  // 网络查看
  { pattern: /^ifconfig\b/, reason: '查看网络接口' },
  { pattern: /^ip\s+(addr|address)\s+show\b/, reason: '查看网络地址' },
  { pattern: /^ip\s+link\s+show\b/, reason: '查看网络链路' },
  { pattern: /^ip\s+route\s+show\b/, reason: '查看路由表' },
  { pattern: /^ip\s+neigh\s+show\b/, reason: '查看邻居表' },
  { pattern: /^netstat\b/, reason: '查看网络连接' },
  { pattern: /^ss\b/, reason: '查看网络连接' },
  { pattern: /^ping\b/, reason: '网络连通性测试' },
  { pattern: /^traceroute\b/, reason: '路由追踪' },
  { pattern: /^dig\b/, reason: 'DNS查询' },
  { pattern: /^nslookup\b/, reason: 'DNS查询' },
  { pattern: /^host\b/, reason: 'DNS查询' },
  // 服务查看
  { pattern: /^systemctl\s+status\b/, reason: '查看服务状态' },
  { pattern: /^systemctl\s+list\b/, reason: '查看服务列表' },
  { pattern: /^systemctl\s+is-(active|enabled|failed)\b/, reason: '查看服务状态' },
  { pattern: /^service\s+\w+\s+status\b/, reason: '查看服务状态' },
  // 日志查看
  { pattern: /^journalctl\b/, reason: '查看系统日志' },
  { pattern: /^dmesg\b/, reason: '查看内核日志' },
  // 版本控制（读操作）
  { pattern: /^git\s+(status|log|diff|show|branch|tag|remote|blame|reflog|describe|shortlog|stash\s+list)\b/, reason: 'Git读操作' },
  { pattern: /^git\s+config\s+--(get|list)\b/, reason: 'Git配置查看' },
  // 环境查看
  { pattern: /^env\b/, reason: '查看环境变量' },
  { pattern: /^printenv\b/, reason: '查看环境变量' },
  { pattern: /^export\b/, reason: '查看环境变量' },
  { pattern: /^echo\b/, reason: '输出文本' },
  { pattern: /^printf\b/, reason: '输出文本' },
  { pattern: /^type\b/, reason: '查看命令类型' },
  { pattern: /^command\s+-v\b/, reason: '查看命令路径' },
  { pattern: /^apropos\b/, reason: '搜索手册' },
  { pattern: /^man\b/, reason: '查看手册' },
  { pattern: /^info\b/, reason: '查看信息' },
  // 磁盘读操作
  { pattern: /^fdisk\s+-l\b/, reason: '查看磁盘分区' },
  { pattern: /^parted\s+-l\b/, reason: '查看分区表' },
  { pattern: /^blkid\b/, reason: '查看块设备标识' },
  // 容器查看
  { pattern: /^docker\s+(ps|images|logs|inspect|top|stats|version|info|history|diff|port|compose\s+ps|compose\s+logs)\b/, reason: 'Docker读操作' },
  // 包信息查看
  { pattern: /^rpm\s+(-q|-qa)\b/, reason: '查看已安装RPM包' },
  { pattern: /^dpkg\s+(-l|-s|-L)\b/, reason: '查看已安装DEB包' },
  { pattern: /^apt(-get)?\s+(list|show|search)\b/, reason: '查看软件包信息' },
  { pattern: /^yum\s+(list|info|search|provides)\b/, reason: '查看软件包信息' },
  // 文本处理（读操作）
  { pattern: /^sort\b/, reason: '排序输出' },
  { pattern: /^uniq\b/, reason: '去重输出' },
  { pattern: /^cut\b/, reason: '截取字段' },
  { pattern: /^awk\b/, reason: '文本处理' },
  { pattern: /^sed\b(?!.*-i\b)/, reason: '文本处理（非原地修改）' },
  { pattern: /^tr\b/, reason: '字符替换' },
  { pattern: /^xargs\b/, reason: '参数传递' },
  { pattern: /^paste\b/, reason: '合并行' },
  // 条件与控制
  { pattern: /^test\b/, reason: '条件测试' },
  { pattern: /^\[\b/, reason: '条件测试' },
  { pattern: /^true\b/, reason: '空操作' },
  { pattern: /^false\b/, reason: '空操作' },
  // 其他读操作
  { pattern: /^history\b/, reason: '查看命令历史' },
  { pattern: /^lsof\b/, reason: '查看打开文件' },
  { pattern: /^strace\b/, reason: '系统调用追踪' },
  { pattern: /^readelf\b/, reason: '查看ELF文件' },
  { pattern: /^objdump\b/, reason: '查看目标文件' },
  { pattern: /^nm\b/, reason: '查看符号表' },
  { pattern: /^strings\b/, reason: '查看字符串' },
  { pattern: /^xxd\b/, reason: '查看十六进制' },
  { pattern: /^od\b/, reason: '查看八进制' },
  { pattern: /^hexdump\b/, reason: '查看十六进制' },
  { pattern: /^pwd\b/, reason: '查看当前目录' },
  { pattern: /^realpath\b/, reason: '查看真实路径' },
  { pattern: /^readlink\b/, reason: '查看符号链接' },
  // 原"低风险确认"命令（MVP 决策并入白名单，直接执行）：
  // kill -9 / killall / pkill 仍在 WRITE_PATTERNS，读写分级不受影响
  { pattern: /^kill\b/, reason: '终止进程' },
  { pattern: /^vgcreate\b/, reason: '创建卷组' },
  { pattern: /^lvcreate\b/, reason: '创建逻辑卷' },
]

// 代码载体命令：参数（含引号内）可能携带可执行代码，需用原始文本复查
const CODE_CARRIER_PATTERN = /^(awk|gawk|mawk|sed|perl|python3?|xargs|find)\b/

// 代码载体命令参数中的危险执行模式（在原始段文本上检查）
const CODE_DANGER_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bsystem\s*\(/, reason: '脚本内调用 system() 执行外部命令' },
  { pattern: /\bpopen\s*\(/, reason: '脚本内调用 popen() 执行外部命令' },
  { pattern: /\bos\.system\b/, reason: '脚本内调用 os.system 执行外部命令' },
  { pattern: /\bexec\s*\(/, reason: '脚本内调用 exec 执行外部命令' },
  { pattern: /\beval\b/, reason: '脚本内使用 eval 动态执行' },
  { pattern: /\bsubprocess\b/, reason: '脚本内使用 subprocess 执行外部命令' },
]

// ==================== 引号感知分段 ====================

export interface CommandSegment {
  /** 段的原始文本（保留引号），用于代码载体命令的复查 */
  raw: string
  /** 剥离引号内数据后的匹配文本（引号内容替换为空格），用于模式匹配 */
  matchable: string
}

/** $( 嵌套深度上限：超限按未识别处理（保守阻断） */
const MAX_SUBSTITUTION_DEPTH = 8

/** 从 openIndex（指向 '('）起找配对的 ')'，引号内的括号不计入；未闭合返回文本末尾 */
function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0
  let inSingle = false
  let inDouble = false
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]
    if (inSingle) {
      if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      if (ch === '\\') { i++; continue }
      if (ch === '"') inDouble = false
      continue
    }
    if (ch === "'") inSingle = true
    else if (ch === '"') inDouble = true
    else if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return text.length
}

/**
 * 把整条命令拆成段：
 * - normal 态遇到 ; | || && & 换行 → 段边界
 * - $(...) / 反引号内的内容递归提取为独立段（命令替换会被 shell 真实执行）
 * - 单引号内内容原样跳过（不切分、不参与匹配）
 * - 双引号内的 $(...)/反引号同样会被 shell 替换，因此其内容也递归提取
 */
export function splitCommandSegments(command: string, depth = 0): CommandSegment[] {
  const segments: CommandSegment[] = []
  let raw = ''
  let matchable = ''
  let i = 0

  const pushSegment = (): void => {
    const trimmedRaw = raw.trim()
    if (trimmedRaw) {
      segments.push({ raw: trimmedRaw, matchable: matchable.trim() })
    }
    raw = ''
    matchable = ''
  }

  while (i < command.length) {
    const ch = command[i]

    // 单引号：内容原样，不参与切分与匹配
    if (ch === "'") {
      let j = i + 1
      while (j < command.length && command[j] !== "'") j++
      raw += command.slice(i, Math.min(j + 1, command.length))
      matchable += ' '
      i = j + 1
      continue
    }

    // 双引号：内容不切分，但内部命令替换仍递归提取
    if (ch === '"') {
      let j = i + 1
      let content = ''
      while (j < command.length && command[j] !== '"') {
        if (command[j] === '\\' && j + 1 < command.length) {
          content += command[j] + command[j + 1]
          j += 2
          continue
        }
        content += command[j]
        j++
      }
      raw += command.slice(i, Math.min(j + 1, command.length))
      if (depth < MAX_SUBSTITUTION_DEPTH && (content.includes('$(') || content.includes('`'))) {
        segments.push(...splitCommandSegments(content, depth + 1))
      }
      matchable += ' '
      i = j + 1
      continue
    }

    // 反斜杠转义
    if (ch === '\\' && i + 1 < command.length) {
      raw += ch + command[i + 1]
      matchable += ch + command[i + 1]
      i += 2
      continue
    }

    // $(...) 命令替换：递归提取
    if (ch === '$' && command[i + 1] === '(') {
      const close = findMatchingParen(command, i + 1)
      const inner = command.slice(i + 2, close)
      raw += command.slice(i, Math.min(close + 1, command.length))
      matchable += ' '
      if (depth < MAX_SUBSTITUTION_DEPTH) {
        segments.push(...splitCommandSegments(inner, depth + 1))
      } else {
        // 深度超限：塞入一个空 matchable 段，外层将落入未识别（保守阻断）
        segments.push({ raw: inner, matchable: '' })
      }
      i = close + 1
      continue
    }

    // 反引号命令替换：递归提取
    if (ch === '`') {
      const close = command.indexOf('`', i + 1)
      const end = close === -1 ? command.length : close
      const inner = command.slice(i + 1, end)
      raw += command.slice(i, Math.min(end + 1, command.length))
      matchable += ' '
      if (depth < MAX_SUBSTITUTION_DEPTH) {
        segments.push(...splitCommandSegments(inner, depth + 1))
      } else {
        segments.push({ raw: inner, matchable: '' })
      }
      i = end + 1
      continue
    }

    // 命令分隔符：; | || && & 换行
    if (ch === ';' || ch === '\n' || ch === '|' || ch === '&') {
      pushSegment()
      if ((ch === '|' || ch === '&') && command[i + 1] === ch) i += 2
      else i += 1
      continue
    }

    raw += ch
    matchable += ch
    i += 1
  }

  pushSegment()
  return segments
}

// ==================== 主判定 ====================

interface WriteHit {
  reason: string
  category: string
}

export function checkCommand(command: string, allowWrite = false): SafetyCheck {
  const trimmed = command.trim()
  if (!trimmed) {
    return { safe: true, blocked: false, isWrite: false, isUnknown: false }
  }

  const segments = splitCommandSegments(trimmed)

  let sawWrite: WriteHit | null = null
  let sawUnknown = false

  for (const seg of segments) {
    const m = seg.matchable

    // 1. P0 永久禁止（引号内数据已剥离，不参与匹配）
    for (const { pattern, reason, category } of BLOCKED_PATTERNS) {
      if (m && pattern.test(m)) {
        return { safe: false, blocked: true, isWrite: false, isUnknown: false, reason, category }
      }
    }

    // 2. git clean dry-run 预演特例：该段视为安全（必须在写操作规则之前）
    if (m && /\bgit\s+clean\b/.test(m)) {
      const hasDryRun = /\bgit\s+clean\b[^|&;]*(?:--dry-run|\s-[^-]*n)/.test(m)
      if (hasDryRun) continue
    }

    // 3. 写操作（读模式阻断 / 写模式直接执行）
    for (const { pattern, reason, category } of WRITE_PATTERNS) {
      if (m && pattern.test(m)) {
        if (!sawWrite) sawWrite = { reason, category }
        break
      }
    }

    // 4. 段首白名单判定（深度超限段 matchable 为空 → 未识别）
    const isReadOnlySeg = !!m && READ_ONLY_PATTERNS.some(({ pattern }) => pattern.test(m))

    if (isReadOnlySeg) {
      // 4a. 代码载体命令：参数（含引号内）用原始文本复查
      if (CODE_CARRIER_PATTERN.test(m)) {
        let danger: string | null = null
        for (const { pattern, reason } of CODE_DANGER_PATTERNS) {
          if (pattern.test(seg.raw)) {
            danger = reason
            break
          }
        }
        if (danger) {
          return {
            safe: false,
            blocked: true,
            isWrite: false,
            isUnknown: false,
            reason: `禁止执行：${danger}`,
            category: '命令注入'
          }
        }
        // xargs/find/awk 等参数里携带的命令词（如 `xargs rm`、`find -exec rm`）
        // 用原始文本再查一遍写操作
        for (const { pattern, reason, category } of WRITE_PATTERNS) {
          if (pattern.test(seg.raw)) {
            if (!sawWrite) sawWrite = { reason, category }
            break
          }
        }
      }
    } else {
      sawUnknown = true
    }
  }

  // 合并优先级：blocked（已在段内返回）> write > unknown > safe
  if (sawWrite) {
    if (!allowWrite) {
      return { safe: false, blocked: true, isWrite: true, isUnknown: false, reason: sawWrite.reason, category: sawWrite.category }
    }
    // MVP：写模式直接执行，不再人工确认（isWrite 保留用于步骤记录展示）
    return { safe: true, blocked: false, isWrite: true, isUnknown: false, reason: sawWrite.reason, category: sawWrite.category }
  }

  if (sawUnknown) {
    return {
      safe: false,
      blocked: true,
      isWrite: false,
      isUnknown: true,
      reason: '未识别的命令，当前不允许执行',
      category: '权限控制'
    }
  }

  return { safe: true, blocked: false, isWrite: false, isUnknown: false }
}
