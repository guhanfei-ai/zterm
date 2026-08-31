/**
 * OpenSSH ssh_config 解析与序列化（纯函数，供 IPC 层调用）。
 *
 * 安全边界：
 * - 解析只读取文件内容，不做任何网络操作；
 * - 序列化永远不输出密码、私钥内容或口令，密钥仅输出文件路径。
 */

export interface ParsedSshConfigHost {
  /** Host 别名（写入 zTerm 的主机名称） */
  alias: string
  /** 实际连接地址：HostName 值，缺省时为别名本身 */
  host: string
  port: number
  username: string
  /** 展开后的私钥文件绝对路径（~ 已替换为用户主目录） */
  identityFile?: string
  /** 该块中被忽略的 ssh_config 关键字（预览时提示用户哪些字段不会导入） */
  ignoredKeywords: string[]
}

export interface SshConfigParseResult {
  hosts: ParsedSshConfigHost[]
  /** 因通配符模式等原因被跳过的 Host 块数量 */
  skippedBlocks: number
  /** 文件中出现的 Host 块总数 */
  totalBlocks: number
}

/** 别名含通配符或元字符的块不导入（它们是匹配规则，不是具体主机） */
function isConcretePattern(pattern: string): boolean {
  return pattern.length > 0 && !/[*?!"']/.test(pattern)
}

/** 展开 IdentityFile 中的 ~ 前缀 */
export function expandTildePath(path: string, homeDir: string): string {
  if (path === '~') return homeDir
  if (path.startsWith('~/')) return `${homeDir}/${path.slice(2)}`
  return path
}

interface RawBlock {
  patterns: string[]
  hostName?: string
  port?: number
  username?: string
  identityFile?: string
  ignoredKeywords: string[]
}

/**
 * 解析 OpenSSH ssh_config 文本。不支持的语义（Include、Match、通配符块、
 * ProxyJump 等）不报错，而是跳过并记录在 ignoredKeywords / skippedBlocks 中，
 * 保证导入永远产生可预览的结果而不是半途失败。
 */
export function parseSshConfig(
  text: string,
  homeDir: string,
  maxHosts = 200
): SshConfigParseResult {
  const blocks: RawBlock[] = []
  let current: RawBlock | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    // 去注释（不支持行内转义的 #，OpenSSH 实际同样在空白后的 # 才算注释）
    const withoutComment = rawLine.replace(/(^|\s)#.*$/, '')
    const trimmed = withoutComment.trim()
    if (!trimmed) continue

    // 关键字与参数之间允许 = 或空白分隔（OpenSSH 兼容写法）
    const separatorMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9]*)\s*[=\s]\s*(.*)$/)
    if (!separatorMatch) continue
    const keyword = separatorMatch[1].toLowerCase()
    const value = separatorMatch[2].trim()

    if (keyword === 'host') {
      current = {
        patterns: value.split(/\s+/).filter(Boolean),
        ignoredKeywords: []
      }
      blocks.push(current)
      continue
    }

    if (keyword === 'match') {
      // Match 块的条件语义无法安全映射到 zTerm，整个块跳过：
      // 后续关键字仍会挂到它上面直到下一个 Host/Match
      current = { patterns: [], ignoredKeywords: [] }
      blocks.push(current)
      continue
    }

    if (!current) continue

    switch (keyword) {
      case 'hostname':
        if (value && !current.hostName) current.hostName = value
        break
      case 'port': {
        const port = Number.parseInt(value, 10)
        if (!current.port && Number.isSafeInteger(port) && port >= 1 && port <= 65535) {
          current.port = port
        }
        break
      }
      case 'user':
        if (value && !current.username) current.username = value
        break
      case 'identityfile':
        if (value && !current.identityFile) {
          current.identityFile = expandTildePath(value, homeDir)
        }
        break
      default:
        if (!current.ignoredKeywords.includes(keyword)) {
          current.ignoredKeywords.push(keyword)
        }
    }
  }

  const totalBlocks = blocks.filter((block) => block.patterns.length > 0).length
  const hosts: ParsedSshConfigHost[] = []

  for (const block of blocks) {
    const concrete = block.patterns.find(isConcretePattern)
    if (!concrete) continue
    if (hosts.length >= maxHosts) break
    hosts.push({
      alias: concrete,
      host: block.hostName || concrete,
      port: block.port || 22,
      username: block.username || '',
      identityFile: block.identityFile,
      ignoredKeywords: block.ignoredKeywords
    })
  }

  return {
    hosts,
    skippedBlocks: totalBlocks - hosts.length,
    totalBlocks
  }
}

export interface ExportableHost {
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'key' | 'privateKeyFile'
  privateKeyFilePath?: string
}

/** 引用参数含空白时用双引号包裹，与 OpenSSH 解析规则兼容 */
function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

/**
 * 将 zTerm 主机序列化为 ssh_config 文本。
 * 密码、应用内托管的私钥内容、私钥口令一律不输出；
 * 密码认证与内置密钥的主机以注释说明认证方式。
 */
export function serializeSshConfig(hosts: ExportableHost[]): string {
  const lines: string[] = [
    '# 由 zTerm 导出的 OpenSSH 客户端配置',
    `# 生成时间: ${new Date().toISOString()}`,
    '# 注意: 密码与应用内托管的私钥内容不会导出；密码认证主机导入后需重新填写密码',
    ''
  ]

  for (const host of hosts) {
    lines.push(`Host ${quoteIfNeeded(host.name)}`)
    lines.push(`    HostName ${quoteIfNeeded(host.host)}`)
    lines.push(`    Port ${host.port}`)
    if (host.username) {
      lines.push(`    User ${quoteIfNeeded(host.username)}`)
    }
    if (host.authType === 'privateKeyFile' && host.privateKeyFilePath) {
      lines.push(`    IdentityFile ${quoteIfNeeded(host.privateKeyFilePath)}`)
    } else if (host.authType === 'password') {
      lines.push('    # 密码认证：密码不会导出，导入后请在 zTerm 中为主机重新填写密码')
    } else if (host.authType === 'key') {
      lines.push('    # 该主机使用 zTerm 内置密钥认证，密钥内容不会导出')
    }
    lines.push('')
  }

  return lines.join('\n')
}
