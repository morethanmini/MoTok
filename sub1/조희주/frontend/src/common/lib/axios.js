
import VueAxios from 'vue-axios'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import store from '../../store'
// import config from '../config'

const BASE_URL = '/api/v1'
const DEFAULT_ACCEPT_TYPE = 'application/json'

axios.defaults.baseURL = BASE_URL
axios.defaults.headers['Content-Type'] = DEFAULT_ACCEPT_TYPE

// 공용 에러 처리: 응답코드 401(세션 관련), 403(권한 관련)에 대한 공통 처리
axios.interceptors.response.use(
  response => response,
  error => {
    const status = error.response ? error.response.status : null
    const errorType = error.response && error.response.data ? error.response.data.error : null

    if (status === 401) {
      if (errorType === 'SignatureVerificationException' || errorType === 'JWTDecodeException') {
        ElMessage.error('세션이 유효하지 않습니다.')
        store.dispatch('accountStore/logoutAction')
      } else if (errorType === 'TokenExpiredException') {
        ElMessage.error('세션이 만료되었습니다.')
        store.dispatch('accountStore/logoutAction')
      }
    } else if (status === 403) {
      ElMessage.error('접근 권한이 없습니다.')
    }

    return Promise.reject(error)
  }
)

export { VueAxios, axios }
export default { VueAxios, axios }
