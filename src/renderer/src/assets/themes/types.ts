import type { ITheme } from '@xterm/xterm'

export type ThemeKind = 'light' | 'dark'

export type ThemeGroup =
  | 'default'
  | 'aurum'
  | 'graphite'
  | 'amber'
  | 'coming-soon'

export interface ThemePreview {
  chrome: string
  surface: string
  surfaceAlt: string
  text: string
  accent: string
}

export type ThemeTokenMap = Record<string, string>

export interface ThemeDefinition {
  id: string
  name: string
  group: ThemeGroup
  kind: ThemeKind
  desc: string
  preview: ThemePreview
  tokens: ThemeTokenMap
  xterm: ITheme
  isPlaceholder?: boolean
}