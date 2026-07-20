import { createApp } from 'vue'
import { createPinia } from 'pinia'

// 전역 스타일 (순서 중요: 토큰 → base → 픽셀 유틸)
import '@/assets/styles/tokens.css'
import '@/assets/styles/base.css'
import '@/assets/styles/pixel.css'

import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
