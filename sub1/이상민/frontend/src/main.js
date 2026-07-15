// 기본 플러그인 Import
import { createApp, h } from 'vue'
import ElementPlus, { ElMessageBox } from 'element-plus'
import store from './store'
import App from './App.vue'
import { VueAxios, axios } from './common/lib/axios'
import router from './common/lib/vue-router'

import 'element-plus/dist/index.css'

// 앱 시작 시 localStorage에서 accessToken을 가져와서 axios 헤더에 설정
const accessToken = localStorage.getItem('accessToken')
if (accessToken) {
  axios.defaults.headers.Authorization = 'Bearer ' + accessToken
  // 토큰이 존재하는 경우, 해당 토큰을 통해 유저의 정보를 받아온다.
  store.dispatch('accountStore/fetchMyInfoAction').catch(() => {
    // me 조회 실패 시(토큰 만료 등)는 axios 응답 인터셉터에서 로그아웃 처리한다.
  })
}

// 공용 Axios 에러 처리
axios.interceptors.response.use(
  response => response,
  error => {
    const status = error.response ? error.response.status : null
    const data = error.response ? error.response.data : {}

    if (status === 401) {
      let message = '세션이 유효하지 않습니다.'
      if (data.error === 'TokenExpiredException') {
        message = '세션이 만료되었습니다.'
      }
      ElMessageBox.alert(message, '알림', { confirmButtonText: '확인' })
      store.dispatch('accountStore/logoutAction')
    } else if (status === 403) {
      ElMessageBox.alert('접근 권한이 없습니다.', '알림', { confirmButtonText: '확인' })
    }

    return Promise.reject(error)
  }
)

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
