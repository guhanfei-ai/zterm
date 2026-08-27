import type { ThemeDefinition } from './types'

const tokens: Record<string, string> = {
  '--chrome-bar-bg': '#201A17',
  '--chrome-rail-bg': '#1A1512',
  '--bg': '#231C18',
  '--surface-muted': '#2A2118',
  '--surface': '#30261F',
  '--surface-alt': '#382E26',
  '--surface-high': '#443930',

  '--accent': '#C4564A',
  '--accent-soft': '#B8726A',
  '--accent-muted': '#3A1C1A',
  '--accent-hover': '#D06460',
  '--accent-pressed': '#AA4840',

  '--text-primary': '#E8D8C8',
  '--text-secondary': '#AE9880',
  '--text-tertiary': '#7E6A58',
  '--text-disabled': '#5A4A3A',

  '--divider': '#3D3028',
  '--divider-soft': '#342820',
  '--border-soft': '#4A3C2E',

  '--danger': '#D46A60',
  '--danger-hover': '#E07A70',
  '--danger-muted': '#3C2018',
  '--success': '#7AAA72',
  '--success-muted': '#283220',
  '--warning': '#C8984A',
  '--warning-muted': '#3A2A16',

  '--input-shell-bg': '#3A2E24',
  '--input-shell-border': '#4C3C2E',
  '--input-shell-focus-border': '#604A38',
  '--input-shell-hover-bg': '#402E26',
  '--input-send-bg': '#524038',
  '--input-send-hover-bg': '#604C40',
  '--input-send-disabled-bg': '#3E3028',
  '--input-toolbar-divider': 'rgba(255, 200, 160, 0.07)',

  '--shadow-dialog': '0 4px 24px rgba(0, 0, 0, 0.60)',
  '--shadow-card': '0 2px 8px rgba(0, 0, 0, 0.45)',
  '--shadow-capsule': '0 1px 3px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(255, 180, 130, 0.03)',
  '--shadow-subtle': '0 1px 2px rgba(0, 0, 0, 0.24)',

  '--hover-overlay': 'rgba(255, 200, 160, 0.06)',
  '--ambient-glow': 'transparent'
}

export const wangyiyunAmber: ThemeDefinition = {
  id: 'wangyiyun-amber',
  name: '网易云 Amber',
  group: 'amber',
  kind: 'dark',
  desc: '暖棕黑底色，带温度的暖红强调，炭灰层次，有温度感的暗色',
  preview: {
    chrome: '#201A17',
    surface: '#30261F',
    surfaceAlt: '#382E26',
    text: '#E8D8C8',
    accent: '#C4564A'
  },
  tokens,
  xterm: {
    background: '#231C18',
    foreground: '#E8D8C8',
    cursor: '#C4564A',
    selectionBackground: '#3A1C1A',
    black: '#30261F',
    red: '#CC5E58',
    green: '#72A86A',
    yellow: '#C8984A',
    blue: '#6890B8',
    magenta: '#A06898',
    cyan: '#6098A8',
    white: '#E8D8C8',
    brightBlack: '#7E6A58',
    brightRed: '#D87070',
    brightGreen: '#88BC80',
    brightYellow: '#D8AE62',
    brightBlue: '#7CAAD0',
    brightMagenta: '#B880B0',
    brightCyan: '#78AEC0',
    brightWhite: '#F0E8DC'
  }
}
