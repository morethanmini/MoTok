
import VueAxios from 'vue-axios'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import store from '../../store'
// import config from '../config'

const BASE_URL = '/api/v1'
const DEFAULT_ACCEPT_TYPE = 'application/json'

axios.defaults.baseURL = BASE_URL
axios.defaults.headers['Content-Type'] = DEFAULT_ACCEPT_TYPE

// SPEC.md 3.3 - JWT 필터 처리 기준 인증 에러 메시지.
// 이 메시지는 JwtAuthenticationFilter가 던진 예외 클래스명(response.data.error)으로만 판별한다.
// 로그인 실패(401, BaseResponseBody 형식)는 error 필드가 없으므로 이 매핑에 걸리지 않는다.
const JWT_AUTH_ERROR_MESSAGES = {
  SignatureVerificationException: '세션이 유효하지 않습니다.',
  JWTDecodeException: '세션이 유효하지 않습니다.',
  TokenExpiredException: '세션이 만료되었습니다.'
}

axios.interceptors.response.use(
  response => response,
  error => {
    const response = error.response
    if (response) {
      const { status, data } = response
      if (status === 401 && data && data.error) {
        // JwtAuthenticationFilter -> ResponseBodyWriteUtil.sendError 가 만든 응답만 처리.
        const message = JWT_AUTH_ERROR_MESSAGES[data.error] || data.message || '세션이 유효하지 않습니다.'
        ElMessage.error(message)
        store.dispatch('accountStore/logoutAction')
      } else if (status === 403) {
        ElMessage.error('접근 권한이 없습니다.')
      }
    }
    return Promise.reject(error)
  }
)

export { VueAxios, axios }
export default { VueAxios, axios }
