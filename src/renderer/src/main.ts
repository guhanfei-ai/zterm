import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/design-tokens.css'
import { bootstrapThemeFromStorage, bootstrapThemeListener } from './stores/theme'

// Pinia 挂上之前先做：避免首屏闪默认主题
bootstrapThemeFromStorage()

const app = createApp(App)
app.use(createPinia())
app.mount('#app')

// Pinia 可用后再挂全局系统主题监听，保证应用级生命周期内持续生效
bootstrapThemeListener()
