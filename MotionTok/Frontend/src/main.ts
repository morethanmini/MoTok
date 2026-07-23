import { createApp } from 'vue'
import { createPinia } from 'pinia'

// 전역 스타일 (순서 중요: 토큰 → base → 픽셀 유틸)
import '@/assets/styles/tokens.css'
import '@/assets/styles/base.css'
import '@/assets/styles/pixel.css'

import App from './App.vue'
import router from './router'
import { startTokenAutoRefresh } from '@/api/refreshScheduler'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// 요청이 뜸한 긴 게임 세션에서도 액세스 토큰이 살아 있도록 만료 전에 스스로 갱신한다(-21).
startTokenAutoRefresh()

app.mount('#app')
