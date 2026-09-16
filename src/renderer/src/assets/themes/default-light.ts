import type { ThemeDefinition } from './types'

const tokens: Record<string, string> = {
  '--chrome-bar-bg': '#FBFCFE',
  '--chrome-rail-bg': '#F6F8FB',
  '--chrome-rail-border': '#E2E7EF',
  '--bg': '#F4F6F9',
  '--surface-muted': '#F6F8FB',
  '--surface': '#FFFFFF',
  '--surface-alt': '#F1F4F8',
  '--surface-high': '#E7EBF1',

  '--workbench-panel-bg': '#FFFFFF',
  '--workbench-panel-muted-bg': '#F6F8FB',
  '--workbench-terminal-bg': '#FFFFFF',
  '--workbench-tabbar-bg': '#F6F8FB',
  '--workbench-tab-active-bg': '#FFFFFF',
  '--workbench-tab-hover-bg': 'rgba(28, 38, 64, 0.05)',
  '--workbench-border': '#E2E7EF',
  '--workbench-border-soft': '#ECF0F5',
  '--workbench-resize-hover': '#4A76E5',
  '--workbench-rail-active-bg': '#E8EFFD',
  '--workbench-rail-hover-bg': 'rgba(28, 38, 64, 0.05)',
  '--workbench-close-hover-bg': '#FBE7EA',

  '--accent': '#4A76E5',
  '--accent-contrast': '#FFFFFF',
  '--accent-soft': '#628DF0',
  '--accent-muted': '#E8EFFD',
  '--accent-hover': '#5B86F0',
  '--accent-pressed': '#3E66CE',

  '--text-primary': '#1A202B',
  '--text-secondary': '#525B6A',
  '--text-tertiary': '#939CAE',
  '--text-disabled': '#BCC3D1',

  '--divider': '#E2E7EF',
  '--divider-soft': '#ECF0F5',
  '--border-soft': '#D8DEE8',

  '--danger': '#DC5566',
  '--danger-hover': '#E26875',
  '--danger-muted': '#FBE7EA',
  '--success': '#2EA365',
  '--success-muted': '#E3F3EA',
  '--warning': '#C68A20',
  '--warning-muted': '#F7EEDD',

  '--input-shell-bg': '#FFFFFF',
  '--input-shell-border': '#E2E7EF',
  '--input-shell-focus-border': '#4A76E5',
  '--input-shell-hover-bg': '#F1F4F8',
  '--input-send-bg': '#4A76E5',
  '--input-send-hover-bg': '#5B86F0',
  '--input-send-disabled-bg': '#C6D2EC',
  '--input-toolbar-divider': 'rgba(28, 38, 64, 0.08)',

  '--shadow-dialog': '0 12px 32px -8px rgba(24, 39, 75, 0.14), 0 2px 8px rgba(24, 39, 75, 0.06)',
  '--shadow-card': '0 1px 3px rgba(24, 39, 75, 0.06), 0 0 0 1px rgba(24, 39, 75, 0.03)',
  '--shadow-capsule': '0 2px 8px rgba(24, 39, 75, 0.08)',
  '--shadow-subtle': '0 1px 2px rgba(24, 39, 75, 0.05)',

  '--hover-overlay': 'rgba(28, 38, 64, 0.04)',
  '--ambient-glow': 'transparent'
}

export const defaultLight: ThemeDefinition = {
  id: 'default-light',
  name: '默认浅色',
  group: 'default',
  kind: 'light',
  desc: 'Mist 雾灰蓝工作台，白色面板配柔和靛蓝，长时间阅读不刺眼',
  preview: {
    chrome: '#FBFCFE',
    surface: '#FFFFFF',
    surfaceAlt: '#F1F4F8',
    text: '#1A202B',
    accent: '#4A76E5'
  },
  tokens,
  xterm: {
    background: '#FFFFFF',
    foreground: '#232838',
    cursor: '#4A76E5',
    selectionBackground: 'rgba(74, 118, 229, 0.16)',
    black: '#E4E8F0',
    red: '#D6505F',
    green: '#2FA264',
    yellow: '#C48A1E',
    blue: '#4B77E5',
    magenta: '#9A63D0',
    cyan: '#2E94BC',
    white: '#4A5263',
    brightBlack: '#9AA3B5',
    brightRed: '#E26875',
    brightGreen: '#3FB877',
    brightYellow: '#D69A2E',
    brightBlue: '#628DF0',
    brightMagenta: '#AC7BDE',
    brightCyan: '#45A8CE',
    brightWhite: '#232838'
  }
}
