import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { TEST_SANDBOX } from '../../../test/setup'

const transport = vi.hoisted(() => ({ responses: [] as Array<{ status?: number; location?: string; body: string | Buffer }>, calls: [] as string[], native: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: (key: string) => key === 'temp' ? TEST_SANDBOX.tmp : TEST_SANDBOX.electronUserData, getVersion: () => '0.4.0' } }))
vi.mock('child_process', () => ({ execFileSync: transport.native, spawn: transport.native }))
vi.mock('https', async () => {
  const { Readable } = await import('node:stream')
  const { EventEmitter } = await import('node:events')
  return { get: (url: string, _options: unknown, callback: (res: any) => void) => {
    transport.calls.push(url)
    const req = Object.assign(new EventEmitter(), { destroy: () => {} })
    queueMicrotask(() => {
      const fixture = transport.responses.shift()
      if (!fixture) { req.emit('error', new Error('Unexpected request')); return }
      const res = Object.assign(Readable.from([Buffer.from(fixture.body)]), {
        statusCode: fixture.status ?? 200,
        headers: { 'content-length': String(Buffer.byteLength(fixture.body)), location: fixture.location },
      })
      callback(res)
    })
    return req
  } }
})

let update: typeof import('../updateService')
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const architecture = Object.getOwnPropertyDescriptor(process, 'arch')!
const body = Buffer.from('synthetic installer; never executed')
const hash = createHash('sha256').update(body).digest('hex')
const manifest = { version: '0.4.2', notes: 'test', published_at: '2026-10-09T04:00:00Z', url: 'https://updates.example/installer.dmg', sha256: hash }

beforeEach(async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  Object.defineProperty(process, 'arch', { value: 'arm64' })
  vi.stubEnv('ZTERM_UPDATE_BASE_URL', 'https://updates.example')
  vi.resetModules()
  transport.responses.length = 0; transport.calls.length = 0; transport.native.mockReset()
  transport.native.mockImplementation(() => { throw new Error('Native installers are forbidden in tests') })
  update = await import('../updateService')
})
afterEach(() => { Object.defineProperty(process, 'platform', platform); Object.defineProperty(process, 'arch', architecture); vi.unstubAllEnvs() })

async function download(): Promise<string> {
  transport.responses.push({ body: JSON.stringify(manifest) }, { body })
  expect((await update.checkForUpdate()).hasUpdate).toBe(true)
  const result = await update.downloadUpdate(manifest.url, hash)
  expect(result.success).toBe(true)
  return result.filePath
}

describe('更新信任链（仅内存 HTTP 传输桩，无外部请求或安装）', () => {
  it('未配置更新源和不支持的平台明确返回手动更新状态，不发送请求', async () => {
    vi.stubEnv('ZTERM_UPDATE_BASE_URL', '')
    vi.resetModules()
    update = await import('../updateService')
    expect(await update.checkForUpdate()).toMatchObject({ status: 'unconfigured', hasUpdate: false })
    Object.defineProperty(process, 'platform', { value: 'linux' })
    expect(await update.checkForUpdate()).toMatchObject({ status: 'unsupported', hasUpdate: false })
    expect(transport.calls).toHaveLength(0)
  })
  it('404 和无效清单不能伪装成最新版，仅真实检查成功返回 up-to-date', async () => {
    transport.responses.push({ status: 404, body: '' })
    await expect(update.checkForUpdate()).rejects.toThrow('HTTP 404')
    transport.responses.push({ body: '{}' })
    await expect(update.checkForUpdate()).rejects.toThrow('检查更新失败')
    transport.responses.push({ body: JSON.stringify({ ...manifest, version: '0.4.0' }) })
    expect(await update.checkForUpdate()).toMatchObject({ status: 'up-to-date', hasUpdate: false })
  })
  it('清单拒绝跨来源、不同端口、嵌入凭据和坏哈希', () => {
    expect(update.parseUpdateManifest(manifest)).toEqual(manifest)
    for (const url of ['https://attacker.invalid/payload', 'https://updates.example:8443/payload', 'https://user:pass@updates.example/payload', 'http://updates.example/payload']) {
      expect(update.parseUpdateManifest({ ...manifest, url })).toBeNull()
    }
    expect(update.parseUpdateManifest({ ...manifest, sha256: 'bad' })).toBeNull()
    expect(update.parseUpdateManifest({ ...manifest, version: 'not-semver' })).toBeNull()
  })
  it('未经主进程清单确认不能开始下载，合规文件名也不能取得安装权', async () => {
    expect((await update.downloadUpdate(manifest.url, hash)).success).toBe(false)
    expect(update.isAllowedInstallerPath(join(TEST_SANDBOX.tmp, 'zterm-update-123.exe'))).toBe(false)
    expect(update.installUpdate(join(TEST_SANDBOX.tmp, 'zterm-update-123.exe')).success).toBe(false)
    expect(transport.calls).toHaveLength(0)
    expect(transport.native).not.toHaveBeenCalled()
  })
  it('逐跳拒绝跨来源清单和下载重定向', async () => {
    transport.responses.push({ status: 302, location: 'https://attacker.invalid/manifest', body: '' })
    await expect(update.checkForUpdate()).rejects.toThrow('非受信任')
    expect(transport.calls).toHaveLength(1)
    transport.calls.length = 0
    transport.responses.push({ body: JSON.stringify(manifest) })
    await update.checkForUpdate()
    transport.responses.push({ status: 302, location: 'https://attacker.invalid/installer', body: '' })
    await expect(update.downloadUpdate(manifest.url, hash)).rejects.toThrow('非受信任')
    expect(transport.calls.every((url) => url.startsWith('https://updates.example/'))).toBe(true)
  })
  it('下载到私有目录，安装前拒绝被篡改的文件', async () => {
    const path = await download()
    expect(update.isAllowedInstallerPath(path)).toBe(true)
    if (platform.value !== 'win32') {
      expect(statSync(dirname(path)).mode & 0o777).toBe(0o700)
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
    writeFileSync(path, 'tampered')
    expect(update.installUpdate(path)).toMatchObject({ success: false, message: expect.stringContaining('发生变化') })
    expect(update.isAllowedInstallerPath(path)).toBe(false)
    expect(transport.native).not.toHaveBeenCalled()
  })
  it('通过哈希仍须校验官方签名，失败不得请求管理员安装', async () => {
    const path = await download()
    transport.native.mockImplementation((name: string, args: string[]) => {
      if (name === 'hdiutil' && args[0] === 'attach') {
        const mount = args[args.indexOf('-mountpoint') + 1]
        mkdirSync(join(mount, 'zTerm.app'), { recursive: true })
        return `<key>mount-point</key>\n<string>${mount}</string>`
      }
      if (name === 'codesign') throw new Error('Untrusted publisher')
      return ''
    })
    expect(update.installUpdate(path)).toMatchObject({ success: false, message: expect.stringContaining('签名') })
    expect(transport.native.mock.calls.some(([name]) => name === 'osascript')).toBe(false)
    expect(transport.native.mock.calls.find(([name]) => name === 'codesign')?.[1]).toEqual(expect.arrayContaining(['--test-requirement', expect.stringContaining('5MWQ45Z9F7')]))
  })
})
