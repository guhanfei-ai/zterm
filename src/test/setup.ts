/**
 * I02:全局测试隔离 setup。
 *
 * vitest 在导入每个测试文件之前执行本文件 —— 环境变量先于
 * dataPath.ts(ZTERM_DATA_ROOT/HOME)与 piModelAdapter.ts(PI_AGENT_DIR)
 * 的模块级求值生效。
 *
 * 隔离范围(全部指向测试拥有目录,不触碰真实 home / 共享 /tmp):
 * - HOME → 每个 worker 进程唯一的假 home(dataPath/store/electron-store
 *   的默认根全部落在其中);
 * - ZTERM_DATA_ROOT → 同一目录下的 .zterm(Controller 持久化);
 * - PI_AGENT_DIR → 同一目录下的 pi-agent(Pi SDK loader/session 目录);
 * - TMPDIR → 同一目录下的 tmp(共享 /tmp 不再被测试写;同时封死
 *   agentContextStore 的 legacy 迁移入口 —— 该入口读 app.getPath('userData'),
 *   各测试文件的 electron mock 统一指向这里的 electron-userdata 目录)。
 *
 * afterAll 仅清理本 worker 创建的目录(测试拥有的路径)。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

// J03:保存原始 env —— afterAll 恢复,避免跨用例继承已删路径
const SAVED_ENV = {
  HOME: process.env.HOME,
  ZTERM_DATA_ROOT: process.env.ZTERM_DATA_ROOT,
  PI_AGENT_DIR: process.env.PI_AGENT_DIR,
  TMPDIR: process.env.TMPDIR,
}

// worker 唯一沙箱根:真实 tmpdir 下的一层,其内再分 HOME/.zterm/pi-agent/tmp
const SANDBOX = mkdtempSync(join(tmpdir(), 'zterm-test-sandbox-'))
const FAKE_HOME = join(SANDBOX, 'home')
const DATA_ROOT = join(FAKE_HOME, '.zterm')
const PI_DIR = join(SANDBOX, 'pi-agent')
const TEST_TMP = join(SANDBOX, 'tmp')

// 各子目录显式创建(os.tmpdir()/getDataRoot() 等只保证根存在)
mkdirSync(FAKE_HOME, { recursive: true })
mkdirSync(TEST_TMP, { recursive: true })
mkdirSync(join(SANDBOX, 'electron-userdata'), { recursive: true })

process.env.HOME = FAKE_HOME
process.env.ZTERM_DATA_ROOT = DATA_ROOT
process.env.PI_AGENT_DIR = PI_DIR
process.env.TMPDIR = TEST_TMP

// 导出给需要断言/清理的测试使用
export const TEST_SANDBOX = {
  root: SANDBOX,
  home: FAKE_HOME,
  dataRoot: DATA_ROOT,
  piAgentDir: PI_DIR,
  tmp: TEST_TMP,
  /** Electron app.getPath('userData') 的测试目录(各文件 electron mock 使用)。 */
  electronUserData: join(SANDBOX, 'electron-userdata'),
}

/** J03:恢复原始 env(未设过的键删除)。 */
function restoreEnv(): void {
  for (const key of ['HOME', 'ZTERM_DATA_ROOT', 'PI_AGENT_DIR', 'TMPDIR'] as const) {
    const saved = SAVED_ENV[key]
    if (saved === undefined) delete process.env[key]
    else process.env[key] = saved
  }
}

afterAll(() => {
  // J03:先恢复 env(即使清理失败,后续用例也不继承已删路径)
  restoreEnv()
  // 清理本 worker 拥有的沙箱;失败时如实报告(console.error),
  // 不吞错 —— 残留路径为测试拥有的 tmp 子目录,无数据安全影响
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch (err) {
    console.error('[test-setup] 沙箱清理失败(测试拥有路径,可安全残留):', err)
  }
})
