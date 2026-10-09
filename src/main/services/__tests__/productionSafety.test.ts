import { describe, expect, it } from 'vitest'
import { checkCommand } from '../safetyGuard'

describe('生产命令边界：只做分类，不执行命令', () => {
  it.each([
    'printf harmless > "/tmp/example"',
    "printf harmless >> '/tmp/example'",
    'git branch new-branch', 'git tag new-tag', 'git remote add x https://example.invalid',
    'kill -TERM 12345', 'mount /dev/example /mnt/example', 'hostname renamed',
    'find . -delete', 'sort -o output input', 'uniq input output',
    'ss --kill',
  ])('只读模式拒绝写操作：%s', (command) => {
    expect(checkCommand(command, false)).toMatchObject({ blocked: true, isWrite: true })
  })
  it.each([
    'env sh -c "printf harmless"',
    "find . -exec sh -c 'printf harmless' \\;",
    "sed -n '1e printf harmless' /dev/null",
    "awk 'BEGIN { print 1 }'",
    "touch /tmp/example && sh -c 'printf harmless'",
    'git status --output=/tmp/example',
    'rg --pre=sh example', 'sort --compress-program=sh example',
    'echo $(printf harmless)', 'cat <(printf harmless)',
    'rg "$PRE" example', 'export PATH=/tmp/example && ls',
  ])('读写模式也不能放行解释器旁路：%s', (command) => {
    expect(checkCommand(command, true).blocked).toBe(true)
  })
  it.each([
    "rm '-rf' /tmp/example", "r'm' -r -f /tmp/example",
    'printf harmless > "/etc/example"', 'printf harmless > /tmp/../etc/example',
    'printf harmless > "/dev/sda"', 'chmod "777" "/example"',
    'printf harmless | tee "/etc/example"', 'cp example /tmp/../etc/example',
    'cp -t/etc/example input',
  ])('引号不能隐藏危险参数：%s', (command) => {
    expect(checkCommand(command, true).blocked).toBe(true)
  })
  it.each([
    'ls -la', 'cat "$HOME/.config/example"', 'ps aux | head -20',
    'git status && git diff', 'find . -name "*.log"',
    'grep "rm -rf" example', 'echo "a > b"', 'docker ps -a',
    'uname -a; free -h', 'systemctl list-units',
  ])('普通查询保持可用：%s', (command) => {
    expect(checkCommand(command, false).safe).toBe(true)
  })
  it('不能把换行后的程序当成 echo 参数', () => {
    expect(checkCommand('echo harmless\nsh -c "printf harmless"', true).blocked).toBe(true)
  })
  it('允许明确授权的普通文件写入', () => {
    expect(checkCommand('printf harmless > "/tmp/example"', true)).toMatchObject({ safe: true, isWrite: true })
  })
})
