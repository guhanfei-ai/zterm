import { describe, expect, it } from 'vitest'
import { serializeSshConfig } from '../sshConfigFile'

// 说明：parseSshConfig / expandTildePath 已随"导入 OpenSSH config"功能移除；
// 本文件只恢复仍在线上路径（hosts:exportSshConfig）的导出序列化测试，
// 其中"never writes passwords or key contents"是导出不含敏感信息的安全承诺。
describe('serializeSshConfig', () => {
  it('never writes passwords or key contents', () => {
    const text = serializeSshConfig([
      {
        name: 'web1',
        host: '10.0.0.1',
        port: 22,
        username: 'root',
        authType: 'password',
        privateKeyFilePath: undefined
      },
      {
        name: 'bastion',
        host: '10.0.0.2',
        port: 2222,
        username: 'ops',
        authType: 'privateKeyFile',
        privateKeyFilePath: '/Users/tt/.ssh/bastion_key'
      }
    ] as const)

    expect(text).toContain('Host web1')
    expect(text).toContain('HostName 10.0.0.1')
    expect(text).toContain('Port 2222')
    expect(text).toContain('IdentityFile /Users/tt/.ssh/bastion_key')
    expect(text).toContain('密码不会导出')
    // 不应出现任何密钥内容字段
    expect(text).not.toContain('password =')
    expect(text).not.toContain('passphrase')
  })

  it('quotes values containing whitespace', () => {
    const text = serializeSshConfig([
      {
        name: 'my server',
        host: '10.0.0.3',
        port: 22,
        username: 'user name',
        authType: 'password'
      }
    ])
    expect(text).toContain('Host "my server"')
    expect(text).toContain('User "user name"')
  })
})
