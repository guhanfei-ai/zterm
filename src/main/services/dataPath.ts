import { homedir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

const DATA_ROOT = join(homedir(), '.zterm')

let ensured = false

/**
 * 返回 ~/.zterm/ 绝对路径，首次调用时自动创建目录。
 * 所有持久化数据统一存放在此目录下。
 */
export function getDataRoot(): string {
  if (!ensured) {
    if (!existsSync(DATA_ROOT)) {
      mkdirSync(DATA_ROOT, { recursive: true })
    }
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
