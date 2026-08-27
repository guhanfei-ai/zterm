import { describe, it, expect } from 'vitest'
import { checkCommand } from '../safetyGuard'

describe('safetyGuard P0 永久阻断', () => {
  it('blocks overwrite redirect to /etc/', () => {
    const result = checkCommand('echo x > /etc/sysctl.conf')
    expect(result.blocked).toBe(true)
    expect(result.category).toBe('系统配置')
  })

  it('blocks append redirect to /etc/', () => {
    const result = checkCommand('echo x >> /etc/crontab')
    expect(result.blocked).toBe(true)
    expect(result.category).toBe('系统配置')
  })

  it('blocks redirect to /etc/ without space', () => {
    const result = checkCommand('echo x >/etc/hosts')
    expect(result.blocked).toBe(true)
  })

  it('blocks rm -fr variant', () => {
    const result = checkCommand('rm -fr /data')
    expect(result.blocked).toBe(true)
    expect(result.reason).toBe('禁止执行 rm -rf')
  })

  it('blocks rm -rf variant', () => {
    expect(checkCommand('rm -rf /data').blocked).toBe(true)
  })

  it('blocks rm -r -f split flags', () => {
    expect(checkCommand('rm -r -f /data').blocked).toBe(true)
  })

  it('blocks rm --recursive --force long flags', () => {
    expect(checkCommand('rm --recursive --force /data').blocked).toBe(true)
  })
})

describe('safetyGuard 不误伤正常用法', () => {
  it('plain rm without -r/-f combo is a write op, not P0 blocked', () => {
    const result = checkCommand('rm -r somedir', true)
    expect(result.blocked).toBe(false)
    expect(result.requiresConfirmation).toBe(true)
    expect(result.isWrite).toBe(true)
  })

  it('redirect to a normal file is a write op, not P0 blocked', () => {
    const result = checkCommand('echo hi > /tmp/file', true)
    expect(result.blocked).toBe(false)
    expect(result.requiresConfirmation).toBe(true)
    expect(result.isWrite).toBe(true)
  })

  it('redirect to a normal file is blocked in read-only mode', () => {
    const result = checkCommand('echo hi > /tmp/file', false)
    expect(result.blocked).toBe(true)
    expect(result.isWrite).toBe(true)
  })

  it('does not treat words containing "remember -rf" as rm', () => {
    // `remember -rf` 不含独立的 rm 词边界命令，应落入未识别而非 rm -rf 永久阻断
    const result = checkCommand('remember -rf')
    expect(result.reason).not.toBe('禁止执行 rm -rf')
  })

  it('read-only commands stay safe', () => {
    expect(checkCommand('ls -la').safe).toBe(true)
    expect(checkCommand('cat /etc/hosts').safe).toBe(true)
  })
})
