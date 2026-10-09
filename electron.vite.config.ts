import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    define: { __ZTERM_WINDOWS_UPDATE_PUBLISHER__: JSON.stringify(process.env.ZTERM_UPDATE_WIN_PUBLISHER ?? '') },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.js' } } }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [vue(), {
      name: 'zterm-development-csp',
      transformIndexHtml(html, context) {
        // HMR 仅在开发时允许连回本地 server，生产页面不开放网络。
        return context.server
          ? html.replace("connect-src 'none'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*")
          : html
      }
    }]
  }
})
