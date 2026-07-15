// 기본 플러그인 Import
import { createApp, h } from 'vue'
import ElementPlus from 'element-plus'
import store from './store'
import App from './App.vue'
import { VueAxios, axios } from './common/lib/axios'
import router from './common/lib/vue-router'

import 'element-plus/dist/index.css'

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

// 앱 시작 시 저장된 토큰이 있으면 본인 정보를 조회하여 로그인 상태를 복원한다.
// (Authorization 헤더는 axios 요청 인터셉터가 처리하며, 토큰이 유효하지 않으면
//  응답 인터셉터가 로그아웃 처리한다.)
if (localStorage.getItem('accessToken')) {
  store.dispatch('accountStore/fetchMe')
}
