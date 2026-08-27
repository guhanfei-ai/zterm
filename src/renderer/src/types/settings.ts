export interface AppSettings {
  defaultPort: number
  terminalFontSize: number
  terminalFontFamily: string
  recentOutputLines: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultPort: 22,
  terminalFontSize: 14,
  terminalFontFamily: 'Menlo, Monaco, "Courier New", monospace',
  recentOutputLines: 50
}
