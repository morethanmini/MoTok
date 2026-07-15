// 기본 플러그인 Import
import { createApp, h } from 'vue'
import ElementPlus from 'element-plus'
import store from './store'
import App from './App.vue'
import { VueAxios, axios } from './common/lib/axios'
import router from './common/lib/vue-router'

import 'element-plus/dist/index.css'

// 앱 시작 시 localStorage에서 accessToken을 가져와서 axios 헤더에 설정
const accessToken = localStorage.getItem('accessToken')
if (accessToken) {
  axios.defaults.headers.Authorization = 'Bearer ' + accessToken
  // 페이지 진입 시 토큰이 존재하면 해당 토큰으로 유저 정보를 받아온다. ([GET] /api/v1/users/me)
  // 토큰이 유효하지 않거나 만료된 경우 axios 응답 인터셉터가 로그아웃 처리한다.
  store.dispatch('accountStore/fetchMyInfo').catch(() => {})
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
