import type { ThemeDefinition } from './types'

const tokens: Record<string, string> = {
  '--chrome-bar-bg': '#181A21',
  '--chrome-rail-bg': '#16181F',
  '--chrome-rail-border': 'rgba(255, 255, 255, 0.08)',
  '--bg': '#131419',
  '--surface-muted': '#1B1E26',
  '--surface': '#21242E',
  '--surface-alt': '#282C38',
  '--surface-high': '#323848',

  '--workbench-panel-bg': '#1B1E26',
  '--workbench-panel-muted-bg': '#16181F',
  '--workbench-terminal-bg': '#131419',
  '--workbench-tabbar-bg': '#16181F',
  '--workbench-tab-active-bg': '#21242E',
  '--workbench-tab-hover-bg': 'rgba(255, 255, 255, 0.06)',
  '--workbench-border': 'rgba(255, 255, 255, 0.08)',
  '--workbench-border-soft': 'rgba(255, 255, 255, 0.05)',
  '--workbench-resize-hover': '#6E93F7',
  '--workbench-rail-active-bg': 'rgba(110, 147, 247, 0.16)',
  '--workbench-rail-hover-bg': 'rgba(255, 255, 255, 0.06)',
  '--workbench-close-hover-bg': 'rgba(236, 116, 132, 0.16)',

  '--accent': '#6E93F7',
  '--accent-contrast': '#FFFFFF',
  '--accent-soft': '#93B0FF',
  '--accent-muted': 'rgba(110, 147, 247, 0.16)',
  '--accent-hover': '#83A3FF',
  '--accent-pressed': '#5A7FE3',

  '--text-primary': '#E8EBF2',
  '--text-secondary': '#A2AAC0',
  '--text-tertiary': '#6E7790',
  '--text-disabled': '#4A5163',

  '--divider': 'rgba(255, 255, 255, 0.08)',
  '--divider-soft': 'rgba(255, 255, 255, 0.05)',
  '--border-soft': 'rgba(255, 255, 255, 0.12)',

  '--danger': '#EC7484',
  '--danger-hover': '#F4949E',
  '--danger-muted': 'rgba(236, 116, 132, 0.14)',
  '--success': '#57C28B',
  '--success-muted': 'rgba(87, 194, 139, 0.14)',
  '--warning': '#E0B25C',
  '--warning-muted': 'rgba(224, 178, 92, 0.14)',

  '--input-shell-bg': '#21242E',
  '--input-shell-border': 'rgba(255, 255, 255, 0.08)',
  '--input-shell-focus-border': '#6E93F7',
  '--input-shell-hover-bg': '#262A36',
  '--input-send-bg': '#6E93F7',
  '--input-send-hover-bg': '#83A3FF',
  '--input-send-disabled-bg': '#323848',
  '--input-toolbar-divider': 'rgba(255, 255, 255, 0.07)',

  '--shadow-dialog': '0 16px 48px -12px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.25)',
  '--shadow-card': '0 2px 8px rgba(0, 0, 0, 0.22)',
  '--shadow-capsule': '0 4px 16px rgba(0, 0, 0, 0.28)',
  '--shadow-subtle': '0 1px 2px rgba(0, 0, 0, 0.20)',

  '--hover-overlay': 'rgba(255, 255, 255, 0.05)',
  '--ambient-glow': 'transparent'
}

export const defaultDark: ThemeDefinition = {
  id: 'default-dark',
  name: '默认暗色',
  group: 'default',
  kind: 'dark',
  desc: 'Dusk 深靛灰工作台，单一柔和靛蓝强调，安静而清晰',
  preview: {
    chrome: '#181A21',
    surface: '#21242E',
    surfaceAlt: '#282C38',
    text: '#E8EBF2',
    accent: '#6E93F7'
  },
  tokens,
  xterm: {
    background: '#131419',
    foreground: '#D7DCE6',
    cursor: '#6E93F7',
    selectionBackground: 'rgba(110, 147, 247, 0.22)',
    black: '#262A33',
    red: '#EC7A86',
    green: '#5FC88F',
    yellow: '#E3BC66',
    blue: '#6E93F7',
    magenta: '#B794F4',
    cyan: '#5EC2D6',
    white: '#D7DCE6',
    brightBlack: '#747D92',
    brightRed: '#F4949E',
    brightGreen: '#7FD9AA',
    brightYellow: '#F0CD82',
    brightBlue: '#93B0FF',
    brightMagenta: '#CBAEFF',
    brightCyan: '#83D5E6',
    brightWhite: '#F2F4F9'
  }
}
