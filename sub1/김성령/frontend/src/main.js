// 기본 플러그인 Import
import { createApp, h } from 'vue'
import ElementPlus from 'element-plus'
import store from './store'
import App from './App.vue'
import { VueAxios, axios } from './common/lib/axios'
import router from './common/lib/vue-router'

import 'element-plus/dist/index.css'

/**
 * 페이지 진입 시 처리 (명세서 p.42)
 *  - 토큰이 존재할 경우: 해당 토큰을 통해 유저 정보를 받아온 뒤 (로그인) 화면을 표시한다.
 *  - 토큰이 존재하지 않을 경우: (비로그인) 화면을 표시한다.
 *
 * 토큰은 accountStore 가 localStorage 에서 복원하고,
 * 요청 헤더 주입은 axios 요청 인터셉터가 매 요청마다 처리한다.
 * 토큰이 만료/위조된 경우 응답 인터셉터가 메시지 표시 + 로그아웃까지 처리하므로 여기서는 무시한다.
 */
if (store.getters['accountStore/isLoggedIn']) {
  store.dispatch('accountStore/fetchUserInfo').catch(() => {})
}

const app = createApp({
  render: ()=>h(App)
})
app.use(VueAxios, axios)
app.use(store)
app.use(router)
// ElementPlus를 app.use()로 등록하면 모든 컴포넌트와 플러그인이 자동으로 등록됩니다.
// 별도로 플러그인을 등록할 필요가 없습니다.
app.use(ElementPlus, {
  // options
})

app.mount('#app')
