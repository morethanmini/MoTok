
import VueAxios from 'vue-axios'
import axios from 'axios'
// import config from '../config'

const BASE_URL = '/api/v1'
const DEFAULT_ACCEPT_TYPE = 'application/json'

axios.defaults.baseURL = BASE_URL
axios.defaults.headers['Content-Type'] = DEFAULT_ACCEPT_TYPE

// [요청 인터셉터] 토큰이 존재하면 Authorization 헤더에 Bearer 토큰을 첨부한다.
axios.interceptors.request.use(config => {
  const token = localStorage.getItem('accessToken')
  if (token) {
    config.headers.Authorization = 'Bearer ' + token
  }
  return config
})

// [응답 인터셉터] 401/403 에러를 공통 처리한다.
axios.interceptors.response.use(
  response => response,
  error => {
    const status = error.response?.status
    const errName = error.response?.data?.error

    const logout = () => {
      localStorage.removeItem('accessToken')
      delete axios.defaults.headers.Authorization
      // "홈" 메뉴로 페이지를 리프레시한다.
      window.location.href = '/'
    }

    if (status === 401) {
      if (errName === 'TokenExpiredException') {
        alert('세션이 만료되었습니다.')
        logout()
      } else if (
        errName === 'SignatureVerificationException' ||
        errName === 'JWTDecodeException'
      ) {
        alert('세션이 유효하지 않습니다.')
        logout()
      }
    } else if (status === 403) {
      // Forbidden: 로그아웃 처리 없음.
      alert('접근 권한이 없습니다.')
    }
    return Promise.reject(error)
  }
)

export { VueAxios, axios }
export default { VueAxios, axios }
