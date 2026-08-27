import { app } from 'electron'
import { createWriteStream, existsSync, readdirSync, rmSync, mkdirSync, writeFileSync, openSync, closeSync, writeSync, realpathSync, readFileSync } from 'fs'
import { join, dirname, basename, extname } from 'path'
import { get as httpsGet } from 'https'
import type { IncomingMessage } from 'http'
import { createHash } from 'crypto'
import { execFileSync, spawn } from 'child_process'

const UPDATE_BASE_URL = process.env.ZTERM_UPDATE_BASE_URL?.trim() || ''

/** 配置的更新源 hostname，用于限制更新包下载来源 */
const UPDATE_ALLOWED_HOST = (() => {
  if (!UPDATE_BASE_URL) return ''
  try {
    const parsed = new URL(UPDATE_BASE_URL)
    return parsed.protocol === 'https:' ? parsed.hostname : ''
  } catch {
    return ''
  }
})()

/**
 * 信任边界：更新包下载 URL 必须指向配置的更新源。
 * renderer 是不可信输入，若直接放行任意 URL，被攻陷的渲染进程可诱导
 * 主进程下载任意内容（配合自带 SHA 通过校验）以管理员权限安装。
 */
export function isAllowedUpdateDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return Boolean(UPDATE_ALLOWED_HOST) && parsed.protocol === 'https:' && parsed.hostname === UPDATE_ALLOWED_HOST
  } catch {
    return false
  }
}

/**
 * 信任边界：允许安装的更新包路径必须位于系统临时目录、且文件名符合
 * 本进程 downloadUpdate 的命名模式（zterm-update-<ts>.<ext>），
 * 拒绝 renderer 传入的任意路径（installUpdate 会以管理员权限执行安装）。
 */
export function isAllowedInstallerPath(filePath: string): boolean {
  try {
    if (dirname(filePath) !== app.getPath('temp')) return false
    return /^zterm-update-\d+\.(dmg|exe|bin)$/.test(basename(filePath))
  } catch {
    return false
  }
}

interface UpdateManifest {
  version: string
  notes: string
  published_at: string
  url: string
  sha256: string
}

interface UpdateCheckResult {
  hasUpdate: boolean
  latestVersion: string
  notes: string
  downloadUrl: string
  sha256: string
}

interface DownloadResult {
  success: boolean
  filePath: string
  error?: string
}

interface InstallResult {
  success: boolean
  message: string
}

let downloading = false
let lastDownloadedFile: string | null = null

// ==================== 状态持久化（防强杀） ====================

interface UpdatePersistState {
  downloading: boolean
  filePath: string | null
  updatedAt: string
}

function getStateFile(): string {
  return join(app.getPath('userData'), 'update-state.json')
}

function persistState(state: UpdatePersistState): void {
  try {
    writeFileSync(getStateFile(), JSON.stringify(state), 'utf-8')
  } catch { /* ignore */ }
}

function clearPersistedState(): void {
  try {
    rmSync(getStateFile(), { force: true })
  } catch { /* ignore */ }
}

/**
 * 启动时检查上次是否在下载中崩溃。
 * 若发现残留状态，清理可能不完整的临时文件，避免下次安装时 SHA 不匹配。
 */
export function restoreOnBoot(): void {
  let raw: string
  try {
    raw = readFileSync(getStateFile(), 'utf-8')
  } catch {
    return
  }
  try {
    const parsed: UpdatePersistState = JSON.parse(raw)
    if (parsed.filePath && existsSync(parsed.filePath)) {
      // 上次下载未完成，文件可能不完整：直接清理
      try { rmSync(parsed.filePath, { force: true }) } catch { /* ignore */ }
    }
    clearPersistedState()
  } catch {
    clearPersistedState()
  }
}

/** before-quit 时如果有未完成的下载，给前端一个机会提示 */
export function getPendingDownloadInfo(): { downloading: boolean; filePath: string | null } {
  return { downloading, filePath: lastDownloadedFile }
}

// ==================== 平台解析 ====================

function getPlatformKey(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macos-arm64'
    case 'win32':
      return 'windows-x64'
    default:
      return 'unknown'
  }
}

function getManifestUrl(): string {
  const key = getPlatformKey()
  return UPDATE_BASE_URL ? `${UPDATE_BASE_URL.replace(/\/$/, '')}/update-manifest-${key}.json` : ''
}

function getUpdateFileExt(): string {
  switch (process.platform) {
    case 'darwin':
      return '.dmg'
    case 'win32':
      return '.exe'
    default:
      return '.bin'
  }
}

function isSupportedPlatform(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32'
}

// ==================== 版本工具 ====================

function readLocalVersion(): string {
  return app.getVersion()
}

function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '')
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

// ==================== Manifest ====================

/** 重定向最大跟随跳数，防止异常服务端返回循环重定向导致无限递归 */
const MAX_REDIRECTS = 5

function fetchManifest(url: string, redirectCount = 0): Promise<UpdateManifest> {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error('Too many redirects'))
      return
    }
    const req = httpsGet(url, { timeout: 15000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // 丢弃旧响应体并释放连接，再跟随重定向。
        // 响应流同样必须挂 error 监听：3xx 响应体消费期间连接被重置时，
        // 无监听的 emit('error') 仍会抛 uncaughtException（req.on 覆盖不到响应阶段）
        res.on('error', reject)
        res.resume()
        fetchManifest(res.headers.location, redirectCount + 1).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error('Manifest JSON parse failed'))
        }
      })
      // 响应阶段错误必须监听，否则会抛 uncaughtException 导致主进程崩溃
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
  })
}

// ==================== 检查更新 ====================

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = normalizeVersion(readLocalVersion())

  const emptyResult: UpdateCheckResult = {
    hasUpdate: false,
    latestVersion: currentVersion,
    notes: '',
    downloadUrl: '',
    sha256: ''
  }

  if (!isSupportedPlatform()) {
    return emptyResult
  }

  let manifest: UpdateManifest
  try {
    manifest = await fetchManifest(getManifestUrl())
  } catch {
    return emptyResult
  }

  const manifestVersion = normalizeVersion(manifest.version)
  const cmp = compareSemver(manifestVersion, currentVersion)

  if (cmp <= 0) {
    return {
      hasUpdate: false,
      latestVersion: manifestVersion,
      notes: manifest.notes,
      downloadUrl: cmp === 0 ? manifest.url : '',
      sha256: cmp === 0 ? manifest.sha256 : ''
    }
  }

  return {
    hasUpdate: true,
    latestVersion: manifestVersion,
    notes: manifest.notes,
    downloadUrl: manifest.url,
    sha256: manifest.sha256
  }
}

// ==================== 下载更新 ====================

export async function downloadUpdate(
  downloadUrl: string,
  expectedSha256: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<DownloadResult> {
  if (downloading) {
    return { success: false, filePath: '', error: 'Already downloading' }
  }
  downloading = true
  lastDownloadedFile = null

  try {
    const tmpDir = app.getPath('temp')
  const fileName = `zterm-update-${Date.now()}${getUpdateFileExt()}`
    const filePath = join(tmpDir, fileName)
    lastDownloadedFile = filePath
    // 落盘：进程被强杀时也能在下次启动时识别出残留文件
    persistState({ downloading: true, filePath, updatedAt: new Date().toISOString() })

    const { stream, total } = await downloadFile(downloadUrl)

    const file = createWriteStream(filePath)
    const hasher = createHash('sha256')
    let downloaded = 0
    let lastReport = 0

    return await new Promise<DownloadResult>((resolve) => {
      let settled = false

      const finish = (result: DownloadResult): void => {
        if (settled) {
          return
        }
        settled = true
        resolve(result)
      }

      const cleanupFailedDownload = (error: string): void => {
        file.destroy()
        try { rmSync(filePath, { force: true }) } catch { /* ignore */ }
        finish({ success: false, filePath: '', error })
      }

      stream.on('data', (chunk: Buffer) => {
        hasher.update(chunk)
        const canContinue = file.write(chunk)
        downloaded += chunk.length
        const now = Date.now()
        if (now - lastReport > 200 || downloaded === total) {
          lastReport = now
          onProgress?.(downloaded, total)
        }
        if (!canContinue) {
          stream.pause()
          file.once('drain', () => {
            stream.resume()
          })
        }
      })

      stream.on('end', () => {
        file.end(() => {
          const actualHash = hasher.digest('hex')
          if (actualHash !== expectedSha256.toLowerCase()) {
            try { rmSync(filePath, { force: true }) } catch { /* ignore */ }
            finish({
              success: false,
              filePath: '',
              error: `SHA256 mismatch: expected ${expectedSha256}, got ${actualHash}`
            })
            return
          }
          finish({ success: true, filePath })
        })
      })

      stream.on('aborted', () => {
        cleanupFailedDownload('Download aborted')
      })

      stream.on('error', (err) => {
        cleanupFailedDownload(err.message)
      })

      file.on('error', (err) => {
        cleanupFailedDownload(err.message)
      })
    })
  } finally {
    downloading = false
    lastDownloadedFile = null
    // 任何退出路径都清持久化：成功 / 失败 / 异常 / before-quit 后的强杀都安全
    clearPersistedState()
  }
}

function downloadFile(url: string, redirectCount = 0): Promise<{ stream: IncomingMessage; total: number }> {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error('Too many redirects'))
      return
    }
    const req = httpsGet(url, { timeout: 3600000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // 丢弃旧响应体并释放连接，再跟随重定向（error 监听理由同 fetchManifest）
        res.on('error', reject)
        res.resume()
        downloadFile(res.headers.location, redirectCount + 1).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download HTTP ${res.statusCode}`))
        return
      }
      const total = parseInt(res.headers['content-length'] || '0', 10)
      resolve({ stream: res, total })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('Request timeout')) })
  })
}

// ==================== 安装更新（Dispatcher） ====================

export function installUpdate(filePath: string): InstallResult {
  if (!existsSync(filePath)) {
    return { success: false, message: `安装包不存在: ${filePath}` }
  }

  switch (process.platform) {
    case 'darwin':
      return installMacUpdate(filePath)
    case 'win32':
      return installWindowsUpdate(filePath)
    default:
      return { success: false, message: '当前平台不支持自动安装' }
  }
}

// ==================== mac 安装实现 ====================

function installMacUpdate(dmgPath: string): InstallResult {
  const pid = process.pid
  const mountDir = join(app.getPath('temp'), `zterm-update-mount-${pid}`)

  if (existsSync(mountDir)) {
    try { rmSync(mountDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  try {
    mkdirSync(mountDir, { recursive: true })
  } catch (e: any) {
    appendLog(`创建 DMG 临时挂载目录失败: ${e.message}`)
    return { success: false, message: `创建 DMG 临时挂载目录失败: ${e.message}` }
  }

  appendLog(`挂载 DMG: ${dmgPath} -> ${mountDir}`)

  let mountPoint = ''
  try {
    const attachOutput = execFileSync(
      'hdiutil',
      ['attach', '-nobrowse', '-readonly', '-mountpoint', mountDir, '-plist', dmgPath],
      { encoding: 'utf8', timeout: 30000 }
    )
    mountPoint = parseHdiutilMountPoint(attachOutput)
    if (!mountPoint) {
      appendLog('无法解析 DMG 挂载点')
      cleanupMount(mountDir)
      return { success: false, message: '无法解析 DMG 挂载点' }
    }
    if (!sameMountPath(mountPoint, mountDir)) {
      appendLog(`DMG 挂载点异常，期望 ${mountDir}，实际 ${mountPoint}`)
      detachDmg(mountPoint)
      cleanupMount(mountDir)
      return { success: false, message: `DMG 挂载点异常，期望 ${mountDir}，实际 ${mountPoint}` }
    }
    appendLog(`DMG 挂载成功: ${mountPoint}`)
  } catch (e: any) {
    const stderr = e.stderr?.toString().trim()
    const message = stderr ? `挂载 DMG 失败: ${stderr}` : `挂载 DMG 失败: ${e.message}`
    appendLog(message)
    cleanupMount(mountDir)
    return { success: false, message }
  }

  const appBundles = findAppBundles(mountPoint)
  if (appBundles.length === 0) {
    appendLog('DMG 中未找到 .app')
    detachDmg(mountPoint)
    cleanupMount(mountDir)
    return { success: false, message: 'DMG 中未找到 .app bundle' }
  }

  const appName = appBundles[0]
  const srcApp = join(mountPoint, appName)

  const installParent = resolveInstallParentDir()
  const relaunchTarget = join(installParent, appName)

  const stagingName = `.${appName}.updating.${pid}`
  const stagingPath = join(installParent, stagingName)

  const updaterLog = join(app.getPath('temp'), 'zterm-update-install.log')
  const updaterScript = join(app.getPath('temp'), `zterm-update-${pid}.sh`)

  const script = buildMacUpdateScript(pid, srcApp, installParent, relaunchTarget, stagingPath, mountPoint)

  try {
    writeFileSync(updaterScript, script, { encoding: 'utf8' })
  } catch (e: any) {
    appendLog(`写入安装脚本失败: ${e.message}`)
    detachDmg(mountPoint)
    cleanupMount(mountDir)
    return { success: false, message: `写入安装脚本失败: ${e.message}` }
  }

  appendLog(`启动后台安装器，目标: ${relaunchTarget}`)

  const launchCmd = `/bin/sh ${shellSingleQuote(updaterScript)} > ${shellSingleQuote(updaterLog)} 2>&1 < /dev/null &`
  const appleScript = `do shell script "${escapeAppleScriptText(launchCmd)}" with administrator privileges`

  try {
    execFileSync('osascript', ['-e', appleScript], {
      encoding: 'utf8',
      timeout: 30000
    })
    appendLog(`后台安装器已启动，日志: ${updaterLog}`)
    setTimeout(() => {
      app.quit()
    }, 500)
    return { success: true, message: '应用正在退出以完成安装' }
  } catch (e: any) {
    const stderr = e.stderr?.toString().trim() || ''
    const message = stderr ? `启动后台安装器失败: ${stderr}` : '启动后台安装器失败，可能已取消系统授权'
    appendLog(message)
    detachDmg(mountPoint)
    cleanupMount(mountDir)
    return { success: false, message }
  }
}

function buildMacUpdateScript(
  pid: number,
  srcApp: string,
  installParent: string,
  relaunchTarget: string,
  stagingPath: string,
  mountPoint: string
): string {
  return `set -eu
PID=${pid}
SRC=${shellSingleQuote(srcApp)}
PARENT=${shellSingleQuote(installParent)}
DEST=${shellSingleQuote(relaunchTarget)}
STAGING=${shellSingleQuote(stagingPath)}
MOUNT=${shellSingleQuote(mountPoint)}

while kill -0 "$PID" 2>/dev/null; do
  sleep 0.2
done

mkdir -p "$PARENT"
rm -rf "$STAGING"
ditto "$SRC" "$STAGING"
xattr -dr com.apple.quarantine "$STAGING" 2>/dev/null || true
rm -rf "$DEST"
mv "$STAGING" "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
# P2-4：DMG 卸载失败不再吞错。失败时输出 stderr 到主进程日志，
# 提示用户手动执行 hdiutil detach MOUNT -force 清理，下次安装才不会因挂载点 busy 失败。
hdiutil detach "$MOUNT" >/dev/null 2>&1 || {
  echo "[update] WARN: 卸载 DMG 挂载点失败：$MOUNT。请手动执行 hdiutil detach 清理。" >&2
}
rmdir "$MOUNT" >/dev/null 2>&1 || {
  echo "[update] WARN: 移除挂载点目录失败：$MOUNT" >&2
}
open -n "$DEST"
`
}

function resolveInstallParentDir(): string {
  const currentExe = process.execPath
  const bundle = findAppBundle(currentExe)
  if (bundle && isSafeInstallLocation(bundle)) {
    return dirname(bundle)
  }
  return '/Applications'
}

function findAppBundle(exePath: string): string | null {
  const parts = exePath.split('/')
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].endsWith('.app')) {
      return parts.slice(0, i + 1).join('/')
    }
  }
  return null
}

function isSafeInstallLocation(bundlePath: string): boolean {
  return !bundlePath.startsWith('/Volumes/')
    && !bundlePath.includes('/AppTranslocation/')
    && !bundlePath.includes('/.Trash/')
}

function findAppBundles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.app'))
  } catch {
    return []
  }
}

function detachDmg(mountPoint: string): void {
  try {
    execFileSync('hdiutil', ['detach', mountPoint], { timeout: 10000 })
  } catch { /* ignore */ }
}

function cleanupMount(mountDir: string): void {
  if (!existsSync(mountDir)) {
    return
  }
  try {
    rmSync(mountDir, { recursive: true, force: true })
  } catch { /* ignore */ }
}

function sameMountPath(actual: string, expected: string): boolean {
  if (actual === expected) {
    return true
  }
  try {
    return realpathSync(actual) === realpathSync(expected)
  } catch {
    return false
  }
}

function parseHdiutilMountPoint(plist: string): string {
  let nextStringIsMountPoint = false
  for (const line of plist.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('<key>mount-point</key>')) {
      nextStringIsMountPoint = true
      continue
    }
    if (nextStringIsMountPoint && trimmed.startsWith('<string>') && trimmed.endsWith('</string>')) {
      return trimmed.slice('<string>'.length, -'</string>'.length)
    }
  }
  return ''
}

// ==================== Windows 安装实现 ====================

function installWindowsUpdate(exePath: string): InstallResult {
  const pid = process.pid
  const relaunchTarget = process.execPath
  const updaterLog = join(app.getPath('temp'), 'zterm-update-install.log')
  const updaterScript = join(app.getPath('temp'), `zterm-update-${pid}.ps1`)
  const vbsScript = join(app.getPath('temp'), `zterm-update-${pid}.vbs`)

  appendLog(`Preparing Windows background install, installer: ${exePath}`)
  appendLog(`Old PID: ${pid}`)
  appendLog(`Relaunch target: ${relaunchTarget}`)

  const script = buildWindowsUpdateScript(pid, exePath, relaunchTarget, updaterLog)

  try {
    writeFileSync(updaterScript, script, { encoding: 'utf8' })
  } catch (e: any) {
    appendLog(`Failed to write PowerShell script: ${e.message}`)
    return { success: false, message: `Failed to write install script: ${e.message}` }
  }

  // VBS script: launch an independent PowerShell process via wscript.exe
  // Direct spawn of powershell.exe gets killed when parent exits.
  // wscript.exe creates a truly independent process.
  // Note: VBS requires double quotes inside strings to be escaped as ""
  const escapedScript = updaterScript.replace(/"/g, '""')
  const vbsContent = `Set objShell = CreateObject("WScript.Shell")
objShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${escapedScript}""", 0, False
`
  try {
    writeFileSync(vbsScript, vbsContent, { encoding: 'ascii' })
  } catch (e: any) {
    appendLog(`Failed to write VBS script: ${e.message}`)
    return { success: false, message: `Failed to write VBS script: ${e.message}` }
  }

  try {
    const child = spawn(
      'wscript.exe',
      [vbsScript],
      {
        detached: true,
        windowsHide: true,
        stdio: 'ignore'
      }
    )
    child.unref()
    appendLog(`Background installer launched via wscript, log: ${updaterLog}`)
    // Give wscript time to launch PowerShell, then quit the app
    setTimeout(() => {
      app.quit()
    }, 1500)
    return { success: true, message: 'App is quitting to complete installation' }
  } catch (e: any) {
    const message = `Failed to launch background installer: ${e.message}`
    appendLog(message)
    return { success: false, message }
  }
}

function psSingleQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'"
}

function buildWindowsUpdateScript(
  pid: number,
  installerPath: string,
  relaunchTarget: string,
  logPath: string
): string {
  // PowerShell script: wait for old process -> silent install (with retry) -> launch new version
  const log = psSingleQuote(logPath)
  const installer = psSingleQuote(installerPath)
  const relaunch = psSingleQuote(relaunchTarget)
  return `# zTerm Windows Update Helper
$ErrorActionPreference = "Stop"

$LogPath = ${log}
function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"
    "$ts $msg" | Out-File -FilePath $LogPath -Append -Encoding utf8
}

Write-Log "=== Windows Update Helper Started ==="
Write-Log "Old PID: ${pid}"
Write-Log "Installer: ${installer}"
Write-Log "Relaunch: ${relaunch}"

try {
    # Wait for old process to exit
    Write-Log "Waiting for old process (${pid}) to exit..."
    $oldProcess = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
    if ($oldProcess) {
        while (-not $oldProcess.HasExited) {
            Start-Sleep -Milliseconds 500
        }
    }
    # Extra wait to ensure file locks are fully released
    Start-Sleep -Seconds 2
    Write-Log "Old process has exited."

    # Run NSIS installer silently (with retry)
    Write-Log "Running installer silently..."
    $installer = ${installer}
    $maxRetries = 3
    $retryCount = 0
    $success = $false
    while ($retryCount -lt $maxRetries -and -not $success) {
        try {
            $proc = Start-Process -FilePath $installer -ArgumentList "/S" -Wait -PassThru -ErrorAction Stop
            Write-Log "Installer exited with code: $($proc.ExitCode)"
            if ($proc.ExitCode -eq 0) {
                $success = $true
            } else {
                Write-Log "Installer returned non-zero exit code: $($proc.ExitCode)"
                $retryCount++
                if ($retryCount -lt $maxRetries) {
                    Write-Log "Retrying in 3 seconds... (attempt $retryCount/$maxRetries)"
                    Start-Sleep -Seconds 3
                }
            }
        } catch {
            Write-Log "Installer failed: $($_.Exception.Message)"
            $retryCount++
            if ($retryCount -lt $maxRetries) {
                Write-Log "Retrying in 3 seconds... (attempt $retryCount/$maxRetries)"
                Start-Sleep -Seconds 3
            }
        }
    }

    if (-not $success) {
        Write-Log "ERROR: Installer failed after $maxRetries attempts."
        exit 1
    }

    # Launch new version
    Write-Log "Launching new version..."
    $relaunch = ${relaunch}
    Start-Process -FilePath $relaunch
    Write-Log "New version launched successfully."
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
`
}

// ==================== 通用工具 ====================

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function escapeAppleScriptText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function appendLog(message: string): void {
  const logPath = join(app.getPath('temp'), 'zterm-update-install.log')
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${message}\n`
  try {
    const fd = openSync(logPath, 'a')
    writeSync(fd, line)
    closeSync(fd)
  } catch { /* ignore */ }
}
