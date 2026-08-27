import type { ThemeDefinition } from './types'

const tokens: Record<string, string> = {
  '--chrome-bar-bg': '#121314',
  '--chrome-rail-bg': '#0F1011',
  '--bg': '#161718',
  '--surface-muted': '#1C1D1F',
  '--surface': '#212224',
  '--surface-alt': '#27282A',
  '--surface-high': '#2E3032',

  '--accent': '#6B8CAE',
  '--accent-soft': '#7899BB',
  '--accent-muted': '#1E2A38',
  '--accent-hover': '#7DA0C4',
  '--accent-pressed': '#5A7A9C',

  '--text-primary': '#D0D4D8',
  '--text-secondary': '#96A0AA',
  '--text-tertiary': '#606A74',
  '--text-disabled': '#404850',

  '--divider': '#2A2C2E',
  '--divider-soft': '#232527',
  '--border-soft': '#303436',

  '--danger': '#C06870',
  '--danger-hover': '#CE7880',
  '--danger-muted': '#2A2028',
  '--success': '#5EA070',
  '--success-muted': '#1C2C22',
  '--warning': '#B89050',
  '--warning-muted': '#2A2718',

  '--input-shell-bg': '#252829',
  '--input-shell-border': '#30353A',
  '--input-shell-focus-border': '#40484E',
  '--input-shell-hover-bg': '#2A2D30',
  '--input-send-bg': '#363A3E',
  '--input-send-hover-bg': '#404548',
  '--input-send-disabled-bg': '#2E3134',
  '--input-toolbar-divider': 'rgba(255, 255, 255, 0.04)',

  '--shadow-dialog': '0 8px 32px rgba(0, 0, 0, 0.70)',
  '--shadow-card': '0 2px 8px rgba(0, 0, 0, 0.55)',
  '--shadow-capsule': '0 1px 3px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.02)',
  '--shadow-subtle': '0 1px 2px rgba(0, 0, 0, 0.30)',

  '--hover-overlay': 'rgba(255, 255, 255, 0.04)',
  '--ambient-glow': 'transparent'
}

export const codexGraphite: ThemeDefinition = {
  id: 'codex-graphite',
  name: 'Codex Graphite',
  group: 'graphite',
  kind: 'dark',
  desc: '极深石墨底色，边界近乎消失，内容区极安静，消声钢蓝强调',
  preview: {
    chrome: '#121314',
    surface: '#212224',
    surfaceAlt: '#27282A',
    text: '#D0D4D8',
    accent: '#6B8CAE'
  },
  tokens,
  xterm: {
    background: '#161718',
    foreground: '#D0D4D8',
    cursor: '#6B8CAE',
    selectionBackground: '#1E2A38',
    black: '#212224',
    red: '#C46870',
    green: '#60A870',
    yellow: '#B89050',
    blue: '#6B8CAE',
    magenta: '#9878C0',
    cyan: '#5AA0B8',
    white: '#D0D4D8',
    brightBlack: '#606A74',
    brightRed: '#D07880',
    brightGreen: '#78BC88',
    brightYellow: '#C8A468',
    brightBlue: '#7DA0C4',
    brightMagenta: '#AC90D4',
    brightCyan: '#72B4CC',
    brightWhite: '#E0E4E8'
  }
}
