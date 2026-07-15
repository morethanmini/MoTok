
import VueAxios from 'vue-axios'
import axios from 'axios'
import { ElMessageBox } from 'element-plus'
// import config from '../config'

const BASE_URL = '/api/v1'
const DEFAULT_ACCEPT_TYPE = 'application/json'

axios.defaults.baseURL = BASE_URL
axios.defaults.headers['Content-Type'] = DEFAULT_ACCEPT_TYPE

// 요청 인터셉터: 토큰이 존재하면 { Authorization: Bearer <토큰> } 형태로 헤더에 실어 보낸다.
axios.interceptors.request.use(
  config => {
    const token = localStorage.getItem('accessToken')
    if (token) {
      config.headers.Authorization = 'Bearer ' + token
    }
    return config
  },
  error => Promise.reject(error)
)

// 로그아웃 처리: 토큰 삭제 후 "홈"으로 페이지를 리프레시한다. (명세 pp.42)
const forceLogout = () => {
  localStorage.removeItem('accessToken')
  window.location.href = '/'
}

// 인증 에러 팝업 표시 후 로그아웃 처리 (팝업 확인/닫기 여부와 무관하게 로그아웃)
const alertAndLogout = message => {
  ElMessageBox.alert(message, '알림', { type: 'warning' })
    .then(forceLogout)
    .catch(forceLogout)
}

// 응답 인터셉터: 공통 인증 에러(401/403) 처리
axios.interceptors.response.use(
  response => response,
  error => {
    const status = error.response && error.response.status
    // JWT 인증 필터가 내려주는 에러 바디의 error 값(예외 클래스명)으로만 세션 에러를 판별한다.
    // (로그인 실패 등 애플리케이션 레벨의 401 은 error 값이 없으므로 호출부에서 처리하도록 통과시킨다.)
    const errorType = error.response && error.response.data && error.response.data.error
    if (status === 401 && errorType === 'TokenExpiredException') {
      alertAndLogout('세션이 만료되었습니다.')
    } else if (status === 401 && (errorType === 'SignatureVerificationException' || errorType === 'JWTDecodeException')) {
      alertAndLogout('세션이 유효하지 않습니다.')
    } else if (status === 403) {
      // Forbidden - 로그아웃 처리는 하지 않는다.
      ElMessageBox.alert('접근 권한이 없습니다.', '알림', { type: 'warning' }).catch(() => {})
    }
    return Promise.reject(error)
  }
)

export { VueAxios, axios }
export default { VueAxios, axios }
