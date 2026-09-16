/** OpenSSH 配置序列化（纯函数，供 IPC 层调用）。 */

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
