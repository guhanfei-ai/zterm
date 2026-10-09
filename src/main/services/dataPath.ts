import { homedir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, chmodSync } from 'fs'

// ZTERM_DATA_ROOT:测试注入专用(测试拥有唯一目录,不写用户真实 ~/.zterm;
// 亦是 H04 精神在 Controller 持久化层的落实——测试不触碰共享数据)。
// 生产不设置该变量,行为与原先完全一致。
const DATA_ROOT = process.env.ZTERM_DATA_ROOT ?? join(homedir(), '.zterm')

let ensured = false

/**
 * 返回数据根目录绝对路径，首次调用时自动创建目录。
 * 生产为 ~/.zterm/；测试可经 ZTERM_DATA_ROOT 注入独立目录。
 */
export function getDataRoot(): string {
  if (!ensured) {
    if (!existsSync(DATA_ROOT)) {
      mkdirSync(DATA_ROOT, { recursive: true, mode: 0o700 })
    }
    if (process.platform !== 'win32') chmodSync(DATA_ROOT, 0o700)
    ensured = true
  }
  return DATA_ROOT
}

/**
 * 拼接 ~/.zterm/ 下的子路径，首次调用时确保根目录存在。
 */
export function getDataPath(...segments: string[]): string {
  return join(getDataRoot(), ...segments)
}
