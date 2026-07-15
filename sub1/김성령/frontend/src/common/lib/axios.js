
import VueAxios from 'vue-axios'
import axios from 'axios'
import { ElMessageBox } from 'element-plus'
// import config from '../config'

const BASE_URL = '/api/v1'
const DEFAULT_ACCEPT_TYPE = 'application/json'

export const TOKEN_KEY = 'accessToken'

axios.defaults.baseURL = BASE_URL
axios.defaults.headers['Content-Type'] = DEFAULT_ACCEPT_TYPE

/**
 * 로그아웃 처리 (명세서 p.43)
 *  - localStorage 에 저장된 토큰을 삭제한다.
 *  - "홈" 메뉴로 페이지를 리프레시한다.
 *
 * store 를 import 하면 store -> accountStore -> accountAPI -> axios 로 순환 참조가 되므로,
 * 여기서는 localStorage 와 location 만 직접 다룬다.
 */
export const forceLogout = () => {
  localStorage.removeItem(TOKEN_KEY)
  delete axios.defaults.headers.Authorization
  window.location.href = '/'
}

/**
 * 요청 인터셉터
 * 토큰이 존재할 경우 { Authorization : Bearer 토큰 값 } 으로 헤더에 전송한다.
 * 매 요청마다 localStorage 에서 직접 읽으므로 새로고침 후에도 항상 헤더가 붙는다.
 */
axios.interceptors.request.use(
  config => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  error => Promise.reject(error)
)

/**
 * 응답 인터셉터 - 명세서 p.42 의 에러 처리 표를 그대로 구현한다.
 *
 * BE 는 ResponseBodyWriteUtil.sendError() 를 통해 아래 형태로 응답한다.
 *   { timestamp, status, error: "<예외 클래스 SimpleName>", message, path }
 * 즉 error 값이 예외 클래스명이므로 이 값으로 분기한다.
 */
const TOKEN_ERROR_MESSAGES = {
  SignatureVerificationException: '세션이 유효하지 않습니다.',
  JWTDecodeException: '세션이 유효하지 않습니다.',
  TokenExpiredException: '세션이 만료되었습니다.'
}

const alertPopup = message => ElMessageBox.alert(message, { confirmButtonText: '확인' })

axios.interceptors.response.use(
  response => response,
  error => {
    const status = error.response?.status
    const errorType = error.response?.data?.error

    if (status === 401 && Object.prototype.hasOwnProperty.call(TOKEN_ERROR_MESSAGES, errorType)) {
      // 토큰 자체가 유효하지 않거나 만료된 경우 -> 메시지 표시 후 로그아웃 처리
      alertPopup(TOKEN_ERROR_MESSAGES[errorType]).finally(forceLogout)
      return Promise.reject(error)
    }

    if (status === 403 && errorType === 'Forbidden') {
      // 접근 권한 문제 -> 메시지만 표시하고 로그아웃 처리는 하지 않는다.
      alertPopup('접근 권한이 없습니다.')
      return Promise.reject(error)
    }

    /**
     * 그 외(로그인 실패 401/404, 중복 확인 409 등)는 각 화면에서 처리해야 하는 에러이므로
     * 여기서 팝업을 띄우지 않고 그대로 전달한다.
     */
    return Promise.reject(error)
  }
)

export { VueAxios, axios }
export default { VueAxios, axios }
