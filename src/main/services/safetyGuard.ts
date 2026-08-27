// 命令安全分类：默认只允许读，未识别命令不允许直接放行

export interface SafetyCheck {
  safe: boolean
  blocked: boolean
  requiresConfirmation: boolean
  isWrite: boolean
  isUnknown: boolean
  reason?: string
  category?: string
}

// P0 永久禁止执行的命令模式
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

// 写操作命令模式 — 读操作下直接阻断，写操作下需二次确认
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

// P2 写操作下仍需二次确认的低风险命令（不属于写操作，但有一定影响）
const CONFIRM_PATTERNS: { pattern: RegExp; reason: string; category: string }[] = [
  { pattern: /\bkill\b/, reason: '该命令将终止进程', category: '进程控制' },
  { pattern: /\bvgcreate\b/, reason: '该命令将修改卷组', category: '磁盘操作' },
  { pattern: /\blvcreate\b/, reason: '该命令将创建逻辑卷', category: '磁盘操作' },
]

// 读操作白名单 — 只有明确匹配这些模式的命令才被视为安全的读操作命令
// 任何未命中白名单的命令一律不可自动放行
const READ_ONLY_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // 文件查看
  { pattern: /\bls\b/, reason: '列出文件' },
  { pattern: /\bll\b/, reason: '列出文件（长格式）' },
  { pattern: /\bcat\b/, reason: '查看文件内容' },
  { pattern: /\bless\b/, reason: '分页查看文件' },
  { pattern: /\bmore\b/, reason: '分页查看文件' },
  { pattern: /\bhead\b/, reason: '查看文件头部' },
  { pattern: /\btail\b/, reason: '查看文件尾部' },
  { pattern: /\bwc\b/, reason: '统计文件行数/字数' },
  { pattern: /\bfile\b/, reason: '查看文件类型' },
  { pattern: /\bstat\b/, reason: '查看文件状态' },
  { pattern: /\bmd5sum\b/, reason: '查看文件校验值' },
  { pattern: /\bsha256sum\b/, reason: '查看文件校验值' },
  // 搜索
  { pattern: /\bgrep\b/, reason: '搜索文本' },
  { pattern: /\begrep\b/, reason: '搜索文本（扩展正则）' },
  { pattern: /\bfgrep\b/, reason: '搜索文本（固定字符串）' },
  { pattern: /\bfind\b/, reason: '查找文件' },
  { pattern: /\bwhich\b/, reason: '查找命令路径' },
  { pattern: /\bwhereis\b/, reason: '查找命令位置' },
  { pattern: /\blocate\b/, reason: '查找文件' },
  // 系统信息
  { pattern: /\bps\b/, reason: '查看进程' },
  { pattern: /\btop\b/, reason: '查看进程状态' },
  { pattern: /\bhtop\b/, reason: '查看进程状态' },
  { pattern: /\bfree\b/, reason: '查看内存' },
  { pattern: /\bdf\b/, reason: '查看磁盘' },
  { pattern: /\bdu\b/, reason: '查看目录大小' },
  { pattern: /\buname\b/, reason: '查看系统信息' },
  { pattern: /\bhostname\b/, reason: '查看主机名' },
  { pattern: /\buptime\b/, reason: '查看运行时间' },
  { pattern: /\bw\b/, reason: '查看登录用户' },
  { pattern: /\bwho\b/, reason: '查看登录用户' },
  { pattern: /\bwhoami\b/, reason: '查看当前用户' },
  { pattern: /\bid\b/, reason: '查看用户身份' },
  { pattern: /\bdate\b/, reason: '查看日期' },
  { pattern: /\bcal\b/, reason: '查看日历' },
  { pattern: /\blscpu\b/, reason: '查看CPU信息' },
  { pattern: /\blsmem\b/, reason: '查看内存信息' },
  { pattern: /\blspci\b/, reason: '查看PCI设备' },
  { pattern: /\blsusb\b/, reason: '查看USB设备' },
  { pattern: /\blsblk\b/, reason: '查看块设备' },
  { pattern: /\bmount\b/, reason: '查看挂载信息' },
  // 网络查看
  { pattern: /\bifconfig\b/, reason: '查看网络接口' },
  { pattern: /\bip\s+(addr|address)\s+show\b/, reason: '查看网络地址' },
  { pattern: /\bip\s+link\s+show\b/, reason: '查看网络链路' },
  { pattern: /\bip\s+route\s+show\b/, reason: '查看路由表' },
  { pattern: /\bip\s+neigh\s+show\b/, reason: '查看邻居表' },
  { pattern: /\bnetstat\b/, reason: '查看网络连接' },
  { pattern: /\bss\b/, reason: '查看网络连接' },
  { pattern: /\bping\b/, reason: '网络连通性测试' },
  { pattern: /\btraceroute\b/, reason: '路由追踪' },
  { pattern: /\bdig\b/, reason: 'DNS查询' },
  { pattern: /\bnslookup\b/, reason: 'DNS查询' },
  { pattern: /\bhost\b/, reason: 'DNS查询' },
  // 服务查看
  { pattern: /\bsystemctl\s+status\b/, reason: '查看服务状态' },
  { pattern: /\bsystemctl\s+list\b/, reason: '查看服务列表' },
  { pattern: /\bsystemctl\s+is-(active|enabled|failed)\b/, reason: '查看服务状态' },
  { pattern: /\bservice\s+\w+\s+status\b/, reason: '查看服务状态' },
  // 日志查看
  { pattern: /\bjournalctl\b/, reason: '查看系统日志' },
  { pattern: /\bdmesg\b/, reason: '查看内核日志' },
  // 版本控制（读操作）
  { pattern: /\bgit\s+(status|log|diff|show|branch|tag|remote|blame|reflog|describe|shortlog|stash\s+list)\b/, reason: 'Git读操作' },
  { pattern: /\bgit\s+config\s+--(get|list)\b/, reason: 'Git配置查看' },
  // 环境查看
  { pattern: /\benv\b/, reason: '查看环境变量' },
  { pattern: /\bprintenv\b/, reason: '查看环境变量' },
  { pattern: /\bexport\b/, reason: '查看环境变量' },
  { pattern: /\becho\b/, reason: '输出文本' },
  { pattern: /\bprintf\b/, reason: '输出文本' },
  { pattern: /\btype\b/, reason: '查看命令类型' },
  { pattern: /\bcommand\s+-v\b/, reason: '查看命令路径' },
  { pattern: /\bapropos\b/, reason: '搜索手册' },
  { pattern: /\bman\b/, reason: '查看手册' },
  { pattern: /\binfo\b/, reason: '查看信息' },
  // 磁盘读操作
  { pattern: /\bfdisk\s+-l\b/, reason: '查看磁盘分区' },
  { pattern: /\bparted\s+-l\b/, reason: '查看分区表' },
  { pattern: /\bblkid\b/, reason: '查看块设备标识' },
  // 容器查看
  { pattern: /\bdocker\s+(ps|images|logs|inspect|top|stats|version|info|history|diff|port|compose\s+ps|compose\s+logs)\b/, reason: 'Docker读操作' },
  // 包信息查看
  { pattern: /\brpm\s+(-q|-qa)\b/, reason: '查看已安装RPM包' },
  { pattern: /\bdpkg\s+(-l|-s|-L)\b/, reason: '查看已安装DEB包' },
  { pattern: /\bapt(-get)?\s+(list|show|search)\b/, reason: '查看软件包信息' },
  { pattern: /\byum\s+(list|info|search|provides)\b/, reason: '查看软件包信息' },
  // 文本处理（读操作）
  { pattern: /\bsort\b/, reason: '排序输出' },
  { pattern: /\buniq\b/, reason: '去重输出' },
  { pattern: /\bcut\b/, reason: '截取字段' },
  { pattern: /\bawk\b/, reason: '文本处理' },
  { pattern: /\bsed\b(?!.*-i\b)/, reason: '文本处理（非原地修改）' },
  { pattern: /\btr\b/, reason: '字符替换' },
  { pattern: /\bxargs\b/, reason: '参数传递' },
  { pattern: /\bpaste\b/, reason: '合并行' },
  // 条件与控制
  { pattern: /\btest\b/, reason: '条件测试' },
  { pattern: /\b\[\b/, reason: '条件测试' },
  { pattern: /\btrue\b/, reason: '空操作' },
  { pattern: /\bfalse\b/, reason: '空操作' },
  // 其他读操作
  { pattern: /\bhistory\b/, reason: '查看命令历史' },
  { pattern: /\blsof\b/, reason: '查看打开文件' },
  { pattern: /\bstrace\b/, reason: '系统调用追踪' },
  { pattern: /\breadelf\b/, reason: '查看ELF文件' },
  { pattern: /\bobjdump\b/, reason: '查看目标文件' },
  { pattern: /\bnm\b/, reason: '查看符号表' },
  { pattern: /\bstrings\b/, reason: '查看字符串' },
  { pattern: /\bxxd\b/, reason: '查看十六进制' },
  { pattern: /\bod\b/, reason: '查看八进制' },
  { pattern: /\bhexdump\b/, reason: '查看十六进制' },
  { pattern: /\bpwd\b/, reason: '查看当前目录' },
  { pattern: /\brealpath\b/, reason: '查看真实路径' },
  { pattern: /\breadlink\b/, reason: '查看符号链接' },
]

export function checkCommand(command: string, allowWrite = false): SafetyCheck {
  const trimmed = command.trim()
  if (!trimmed) return { safe: true, blocked: false, requiresConfirmation: false, isWrite: false, isUnknown: false }

  // 1. 永久禁止的命令
  for (const { pattern, reason, category } of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safe: false, blocked: true, requiresConfirmation: false, isWrite: false, isUnknown: false, reason, category }
    }
  }

  // 2. git clean dry-run 预演检查（必须在写操作规则之前判断，避免被 -f 规则误伤）
  if (/\bgit\s+clean\b/.test(trimmed)) {
    const hasDryRun = /\bgit\s+clean\b[^|&;]*(?:--dry-run|\s-[^-]*n)/.test(trimmed)
    if (hasDryRun) {
      return { safe: true, blocked: false, requiresConfirmation: false, isWrite: false, isUnknown: false }
    }
  }

  // 3. 写操作命令
  for (const { pattern, reason, category } of WRITE_PATTERNS) {
    if (pattern.test(trimmed)) {
      if (!allowWrite) {
        // 读操作：直接阻断
        return { safe: false, blocked: true, requiresConfirmation: false, isWrite: true, isUnknown: false, reason, category }
      } else {
        // 写操作：需要二次确认
        return { safe: false, blocked: false, requiresConfirmation: true, isWrite: true, isUnknown: false, reason, category }
      }
    }
  }

  // 4. 需确认的低风险命令
  for (const { pattern, reason, category } of CONFIRM_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safe: false, blocked: false, requiresConfirmation: true, isWrite: false, isUnknown: false, reason, category }
    }
  }

  // 5. 读操作白名单
  const isReadOnly = READ_ONLY_PATTERNS.some(({ pattern }) => pattern.test(trimmed))
  if (isReadOnly) {
    return { safe: true, blocked: false, requiresConfirmation: false, isWrite: false, isUnknown: false }
  }

  // 6. 未识别命令：任何模式下都阻断，不允许进入确认执行阶段
  return {
    safe: false,
    blocked: true,
    requiresConfirmation: false,
    isWrite: false,
    isUnknown: true,
    reason: '未识别的命令，当前不允许执行',
    category: '权限控制'
  }
}
