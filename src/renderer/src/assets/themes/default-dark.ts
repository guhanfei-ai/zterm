import type { ThemeDefinition } from './types'

const tokens: Record<string, string> = {
  '--chrome-bar-bg': '#26272A',
  '--chrome-rail-bg': '#212224',
  '--chrome-rail-border': 'rgba(255, 255, 255, 0.08)',
  '--bg': '#17171A',
  '--surface-muted': '#1D1F21',
  '--surface': '#232527',
  '--surface-alt': '#2B2D30',
  '--surface-high': '#34373A',

  '--workbench-panel-bg': '#212224',
  '--workbench-panel-muted-bg': '#1B1C1F',
  '--workbench-terminal-bg': '#17171A',
  '--workbench-tabbar-bg': '#1B1C1F',
  '--workbench-tab-active-bg': '#242629',
  '--workbench-tab-hover-bg': 'rgba(255, 255, 255, 0.06)',
  '--workbench-border': 'rgba(255, 255, 255, 0.09)',
  '--workbench-border-soft': 'rgba(255, 255, 255, 0.055)',
  '--workbench-resize-hover': '#5479A8',
  '--workbench-rail-active-bg': '#30363D',
  '--workbench-rail-hover-bg': 'rgba(255, 255, 255, 0.06)',
  '--workbench-close-hover-bg': '#3A292D',

  '--accent': '#4C8DFF',
  '--accent-contrast': '#FFFFFF',
  '--accent-soft': '#76A8FF',
  '--accent-muted': '#243A5C',
  '--accent-hover': '#609AFF',
  '--accent-pressed': '#3B78DE',

  '--text-primary': '#D7D9DC',
  '--text-secondary': '#A1A6AD',
  '--text-tertiary': '#71777F',
  '--text-disabled': '#4D535A',

  '--divider': 'rgba(255, 255, 255, 0.11)',
  '--divider-soft': 'rgba(255, 255, 255, 0.065)',
  '--border-soft': 'rgba(255, 255, 255, 0.15)',

  '--danger': '#D36B75',
  '--danger-hover': '#E07A84',
  '--danger-muted': '#422529',
  '--success': '#72B487',
  '--success-muted': '#213A2B',
  '--warning': '#C6A15A',
  '--warning-muted': '#3B321F',

  '--input-shell-bg': '#3B3C3E',
  '--input-shell-border': 'rgba(255, 255, 255, 0.10)',
  '--input-shell-focus-border': '#5D6670',
  '--input-shell-hover-bg': '#424447',
  '--input-send-bg': '#5A5E63',
  '--input-send-hover-bg': '#696E74',
  '--input-send-disabled-bg': '#34373A',
  '--input-toolbar-divider': 'rgba(255, 255, 255, 0.07)',

  '--shadow-dialog': '0 20px 60px rgba(0, 0, 0, 0.55)',
  '--shadow-card': '0 8px 24px rgba(0, 0, 0, 0.28)',
  '--shadow-capsule': '0 6px 18px rgba(0, 0, 0, 0.22)',
  '--shadow-subtle': '0 2px 8px rgba(0, 0, 0, 0.18)',

  '--hover-overlay': 'rgba(255, 255, 255, 0.055)',
  '--ambient-glow': 'transparent'
}

export const defaultDark: ThemeDefinition = {
  id: 'default-dark',
  name: '默认暗色',
  group: 'default',
  kind: 'dark',
  desc: '中性石墨灰工作台，低饱和蓝色强调，安静而清晰',
  preview: {
    chrome: '#26272A',
    surface: '#232527',
    surfaceAlt: '#2B2D30',
    text: '#D7D9DC',
    accent: '#4C8DFF'
  },
  tokens,
  xterm: {
    background: '#17171A',
    foreground: '#D7D9DC',
    cursor: '#4C8DFF',
    selectionBackground: '#243A5C',
    black: '#232527',
    red: '#D36B75',
    green: '#72B487',
    yellow: '#C6A15A',
    blue: '#4C8DFF',
    magenta: '#A77BC4',
    cyan: '#62A7C4',
    white: '#D7D9DC',
    brightBlack: '#71777F',
    brightRed: '#E07A84',
    brightGreen: '#8BC99D',
    brightYellow: '#D8B66B',
    brightBlue: '#76A8FF',
    brightMagenta: '#BE9BDA',
    brightCyan: '#82C2DC',
    brightWhite: '#ECEEF0'
  }
}
