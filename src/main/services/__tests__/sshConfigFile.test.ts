import { describe, expect, it } from 'vitest'
import { parseSshConfig, serializeSshConfig, expandTildePath } from '../sshConfigFile'

const HOME = '/home/tester'

describe('parseSshConfig', () => {
  it('parses basic host blocks with keyword arguments', () => {
    const result = parseSshConfig(`
# 注释行
Host web1
    HostName 10.0.0.1
    Port 2222
    User root
    IdentityFile ~/.ssh/id_rsa

Host db
    hostname 10.0.0.2
    user deploy
    port = 22
`, HOME)

    expect(result.totalBlocks).toBe(2)
    expect(result.skippedBlocks).toBe(0)
    expect(result.hosts).toHaveLength(2)
    expect(result.hosts[0]).toEqual({
      alias: 'web1',
      host: '10.0.0.1',
      port: 2222,
      username: 'root',
      identityFile: '/home/tester/.ssh/id_rsa',
      ignoredKeywords: []
    })
    expect(result.hosts[1].host).toBe('10.0.0.2')
    expect(result.hosts[1].username).toBe('deploy')
    expect(result.hosts[1].port).toBe(22)
    expect(result.hosts[1].identityFile).toBeUndefined()
  })

  it('uses alias as host when HostName is missing', () => {
    const result = parseSshConfig('Host 192.168.1.5\n  User admin\n', HOME)
    expect(result.hosts[0].host).toBe('192.168.1.5')
  })

  it('skips wildcard and match blocks but counts them', () => {
    const result = parseSshConfig(`
Host *
    ServerAliveInterval 60

Match host *.internal
    User jump

Host real
    HostName 1.2.3.4
`, HOME)

    expect(result.totalBlocks).toBe(2) // Host * 与 Host real；Match 不计入 Host 块
    expect(result.hosts).toHaveLength(1)
    expect(result.hosts[0].alias).toBe('real')
    expect(result.skippedBlocks).toBe(1)
  })

  it('collects unsupported keywords instead of failing', () => {
    const result = parseSshConfig(`
Host web1
    HostName 10.0.0.1
    ProxyJump bastion
    ForwardAgent yes
    Include extra.conf
`, HOME)

    expect(result.hosts[0].ignoredKeywords).toEqual(['proxyjump', 'forwardagent', 'include'])
  })

  it('rejects invalid ports and keeps default 22', () => {
    const result = parseSshConfig('Host a\n  Port 99999\nHost b\n  Port abc\n', HOME)
    expect(result.hosts[0].port).toBe(22)
    expect(result.hosts[1].port).toBe(22)
  })

  it('picks the first concrete pattern from a multi-pattern Host line', () => {
    const result = parseSshConfig('Host web1 web1-* backup\n  HostName 10.0.0.9\n', HOME)
    expect(result.hosts).toHaveLength(1)
    expect(result.hosts[0].alias).toBe('web1')
    expect(result.skippedBlocks).toBe(0)
  })

  it('caps the number of imported hosts', () => {
    const text = Array.from({ length: 10 }, (_, i) => `Host h${i}\n  HostName 10.0.0.${i}\n`).join('\n')
    const result = parseSshConfig(text, HOME, 5)
    expect(result.hosts).toHaveLength(5)
  })
})

describe('expandTildePath', () => {
  it('expands ~ and ~/ prefixes only', () => {
    expect(expandTildePath('~', HOME)).toBe(HOME)
    expect(expandTildePath('~/.ssh/key', HOME)).toBe(`${HOME}/.ssh/key`)
    expect(expandTildePath('/opt/~/key', HOME)).toBe('/opt/~/key')
  })
})

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
