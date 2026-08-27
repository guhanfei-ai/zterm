import type { ThemeDefinition } from './types'

const tokens: Record<string, string> = {
  '--chrome-bar-bg': '#202224',
  '--chrome-rail-bg': '#222426',
  '--chrome-rail-border': '#303236',
  '--bg': '#25272A',
  '--surface-muted': '#2B2D31',
  '--surface': '#313337',
  '--surface-alt': '#383B3F',
  '--surface-high': '#42464B',

  '--workbench-panel-bg': '#2D2F33',
  '--workbench-panel-muted-bg': '#292B2F',
  '--workbench-terminal-bg': '#25272A',
  '--workbench-tabbar-bg': '#292B2F',
  '--workbench-tab-active-bg': '#323539',
  '--workbench-tab-hover-bg': 'rgba(255, 255, 255, 0.045)',
  '--workbench-border': '#36393D',
  '--workbench-border-soft': '#303337',
  '--workbench-resize-hover': '#3A4E68',
  '--workbench-rail-active-bg': '#33415A',
  '--workbench-rail-hover-bg': 'rgba(255, 255, 255, 0.04)',
  '--workbench-close-hover-bg': '#3E3032',

  '--accent': '#467FF0',
  '--accent-soft': '#6B9BD2',
  '--accent-muted': '#2F4568',
  '--accent-hover': '#5A93F5',
  '--accent-pressed': '#3A6DD8',

  '--text-primary': '#D6D8DB',
  '--text-secondary': '#A5AAB0',
  '--text-tertiary': '#7A8088',
  '--text-disabled': '#565C63',

  '--divider': '#393C40',
  '--divider-soft': '#323539',
  '--border-soft': '#45494E',

  '--danger': '#E06C75',
  '--danger-hover': '#F0767F',
  '--danger-muted': '#3D2E2F',
  '--success': '#6AAB73',
  '--success-muted': '#2A3D2E',
  '--warning': '#C9A14A',
  '--warning-muted': '#3D3628',

  '--input-shell-bg': '#3B3E42',
  '--input-shell-border': '#474A4F',
  '--input-shell-focus-border': '#585C62',
  '--input-shell-hover-bg': '#3F4246',
  '--input-send-bg': '#52555A',
  '--input-send-hover-bg': '#5E6268',
  '--input-send-disabled-bg': '#42454A',
  '--input-toolbar-divider': 'rgba(255, 255, 255, 0.06)',

  '--shadow-dialog': '0 4px 24px rgba(0, 0, 0, 0.5)',
  '--shadow-card': '0 2px 8px rgba(0, 0, 0, 0.35)',
  '--shadow-capsule': '0 1px 3px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(255, 255, 255, 0.02)',
  '--shadow-subtle': '0 1px 2px rgba(0, 0, 0, 0.2)',

  '--hover-overlay': 'rgba(255, 255, 255, 0.045)',
  '--ambient-glow': 'transparent'
}

export const defaultDark: ThemeDefinition = {
  id: 'default-dark',
  name: '默认暗色',
  group: 'default',
  kind: 'dark',
  desc: 'JetBrains 风格石墨灰底，长时间使用更舒适',
  preview: {
    chrome: '#202224',
    surface: '#313337',
    surfaceAlt: '#383B3F',
    text: '#D6D8DB',
    accent: '#467FF0'
  },
  tokens,
  xterm: {
    background: '#252729',
    foreground: '#D6D8DB',
    cursor: '#467FF0',
    selectionBackground: '#2F4568',
    black: '#313336',
    red: '#E06C75',
    green: '#6AAB73',
    yellow: '#C9A14A',
    blue: '#467FF0',
    magenta: '#B07CD8',
    cyan: '#5BA4D4',
    white: '#D6D8DB',
    brightBlack: '#7A8088',
    brightRed: '#F0767F',
    brightGreen: '#88C990',
    brightYellow: '#E6CD82',
    brightBlue: '#5A93F5',
    brightMagenta: '#C9A0E6',
    brightCyan: '#7CBEE6',
    brightWhite: '#E8EAED'
  }
}
