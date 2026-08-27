import type { ThemeDefinition, ThemeKind } from './types'
import { defaultLight } from './default-light'
import { defaultDark } from './default-dark'
import { aurumNocturne } from './aurum-nocturne'
import { codexGraphite } from './codex-graphite'
import { wangyiyunAmber } from './wangyiyun-amber'

export const THEMES: ReadonlyArray<ThemeDefinition> = [
  defaultLight,
  defaultDark,
  aurumNocturne,
  codexGraphite,
  wangyiyunAmber
]

const THEMES_BY_ID: Record<string, ThemeDefinition> = Object.fromEntries(
  THEMES.map(t => [t.id, t])
)

export function getTheme(id: string): ThemeDefinition | undefined {
  return THEMES_BY_ID[id]
}

export function findTheme(
  predicate: (t: ThemeDefinition) => boolean
): ThemeDefinition | undefined {
  return THEMES.find(predicate)
}

export function listThemesByGroup(): Record<string, ThemeDefinition[]> {
  const groups: Record<string, ThemeDefinition[]> = {}
  for (const t of THEMES) {
    if (!groups[t.group]) groups[t.group] = []
    groups[t.group].push(t)
  }
  return groups
}

export function getDefaultThemeForKind(kind: ThemeKind): ThemeDefinition {
  const sameKind = THEMES.filter(t => t.kind === kind && !t.isPlaceholder)
  if (sameKind.length > 0) return sameKind[0]
  const anyKind = THEMES.filter(t => t.kind === kind)
  if (anyKind.length > 0) return anyKind[0]
  return THEMES[0]
}

export const GROUP_LABELS: Record<string, string> = {
  default: '默认',
  aurum: '高级 · 暖金',
  graphite: '高级 · 石墨',
  amber: '高级 · 琥珀',
  'coming-soon': '即将推出'
}

export type { ThemeDefinition, ThemeKind, ThemeGroup, ThemePreview, ThemeTokenMap } from './types'