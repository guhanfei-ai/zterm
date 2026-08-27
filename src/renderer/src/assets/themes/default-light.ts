import type { ThemeDefinition } from './types'

const tokens: Record<string, string> = {
  '--chrome-bar-bg': '#E0DDD8',
  '--chrome-rail-bg': '#DDD9D3',
  '--bg': '#EBE8E3',
  '--surface-muted': '#E4E1DC',
  '--surface': '#F4F2EF',
  '--surface-alt': '#E6E3DE',
  '--surface-high': '#D9D5D0',

  '--accent': '#5A7394',
  '--accent-soft': '#6D849F',
  '--accent-muted': '#D4DCE7',
  '--accent-hover': '#6580A0',
  '--accent-pressed': '#4E6686',

  '--text-primary': '#2A2725',
  '--text-secondary': '#4E4A47',
  '--text-tertiary': '#807C78',
  '--text-disabled': '#B3B0AC',

  '--divider': '#CFCAC4',
  '--divider-soft': '#D8D4CE',
  '--border-soft': '#C6C0BA',

  '--danger': '#C03D48',
  '--danger-hover': '#D04E5A',
  '--danger-muted': '#F2DDE0',
  '--success': '#3E8D48',
  '--success-muted': '#DEEDDF',
  '--warning': '#B08023',
  '--warning-muted': '#EEE2C8',

  '--input-shell-bg': '#EDE8E3',
  '--input-shell-border': '#CCC7BF',
  '--input-shell-focus-border': '#B3AFAA',
  '--input-shell-hover-bg': '#E4E1DC',
  '--input-send-bg': '#D8D4CE',
  '--input-send-hover-bg': '#CCC7BF',
  '--input-send-disabled-bg': '#DDD9D3',
  '--input-toolbar-divider': 'rgba(0, 0, 0, 0.05)',

  '--shadow-dialog': '0 4px 24px rgba(40, 30, 20, 0.14)',
  '--shadow-card': '0 2px 8px rgba(40, 30, 20, 0.07)',
  '--shadow-capsule': '0 1px 3px rgba(40, 30, 20, 0.06), 0 0 0 1px rgba(40, 30, 20, 0.01)',
  '--shadow-subtle': '0 1px 2px rgba(40, 30, 20, 0.05)',

  '--hover-overlay': 'rgba(40, 30, 20, 0.04)',
  '--ambient-glow': 'transparent'
}

export const defaultLight: ThemeDefinition = {
  id: 'default-light',
  name: '默认浅色',
  group: 'default',
  kind: 'light',
  desc: '暖纸灰工作台，柔和层次，长时间阅读不刺眼',
  preview: {
    chrome: '#E0DDD8',
    surface: '#F4F2EF',
    surfaceAlt: '#E6E3DE',
    text: '#2A2725',
    accent: '#5A7394'
  },
  tokens,
  xterm: {
    background: '#FFFFFF',
    foreground: '#1F2328',
    cursor: '#2F6FE0',
    selectionBackground: '#D9E3F6',
    black: '#1F2328',
    red: '#C73E4A',
    green: '#3D8C46',
    yellow: '#B08023',
    blue: '#2F6FE0',
    magenta: '#8B5BC7',
    cyan: '#3F8AB0',
    white: '#4A5159',
    brightBlack: '#7A828C',
    brightRed: '#D04E5A',
    brightGreen: '#5BA266',
    brightYellow: '#D0A055',
    brightBlue: '#3D7EE6',
    brightMagenta: '#A77BDB',
    brightCyan: '#5DA8C7',
    brightWhite: '#1F2328'
  }
}