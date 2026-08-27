import type { ThemeDefinition } from './types'

const tokens: Record<string, string> = {
  '--chrome-bar-bg': '#21201E',
  '--chrome-rail-bg': '#1C1B18',
  '--bg': '#252421',
  '--surface-muted': '#2C2B27',
  '--surface': '#312F2C',
  '--surface-alt': '#393631',
  '--surface-high': '#44403C',

  '--accent': '#C4874A',
  '--accent-soft': '#B89268',
  '--accent-muted': '#3D2C1A',
  '--accent-hover': '#D0945C',
  '--accent-pressed': '#A87040',

  '--text-primary': '#DDD5C8',
  '--text-secondary': '#AA9E92',
  '--text-tertiary': '#7A7068',
  '--text-disabled': '#58504A',

  '--divider': '#3C3A36',
  '--divider-soft': '#33312E',
  '--border-soft': '#464240',

  '--danger': '#C07068',
  '--danger-hover': '#CE7E76',
  '--danger-muted': '#3D2524',
  '--success': '#7AA87E',
  '--success-muted': '#253228',
  '--warning': '#C4A350',
  '--warning-muted': '#3A2E18',

  '--input-shell-bg': '#3A3834',
  '--input-shell-border': '#494640',
  '--input-shell-focus-border': '#5C5852',
  '--input-shell-hover-bg': '#3F3C38',
  '--input-send-bg': '#504D48',
  '--input-send-hover-bg': '#5E5A54',
  '--input-send-disabled-bg': '#3E3C38',
  '--input-toolbar-divider': 'rgba(255, 240, 220, 0.06)',

  '--shadow-dialog': '0 4px 24px rgba(0, 0, 0, 0.55)',
  '--shadow-card': '0 2px 8px rgba(0, 0, 0, 0.42)',
  '--shadow-capsule': '0 1px 3px rgba(0, 0, 0, 0.20), 0 0 0 1px rgba(255, 240, 220, 0.025)',
  '--shadow-subtle': '0 1px 2px rgba(0, 0, 0, 0.22)',

  '--hover-overlay': 'rgba(255, 240, 220, 0.06)',
  '--ambient-glow': 'transparent'
}

export const aurumNocturne: ThemeDefinition = {
  id: 'aurum-nocturne',
  name: 'Aurum Nocturne',
  group: 'aurum',
  kind: 'dark',
  desc: '暖炭灰底色，低饱和暖金强调，面间微弱明度差，安静细腻',
  preview: {
    chrome: '#21201E',
    surface: '#312F2C',
    surfaceAlt: '#393631',
    text: '#DDD5C8',
    accent: '#C4874A'
  },
  tokens,
  xterm: {
    background: '#252421',
    foreground: '#DDD5C8',
    cursor: '#C4874A',
    selectionBackground: '#3D2C1A',
    black: '#312F2C',
    red: '#C26A68',
    green: '#78A87C',
    yellow: '#C4A350',
    blue: '#7090B8',
    magenta: '#A07CC0',
    cyan: '#6A9EB0',
    white: '#DDD5C8',
    brightBlack: '#7A7068',
    brightRed: '#D07878',
    brightGreen: '#90BC90',
    brightYellow: '#D0B870',
    brightBlue: '#88A8CC',
    brightMagenta: '#B890D4',
    brightCyan: '#82B8C8',
    brightWhite: '#EDE8E0'
  }
}
