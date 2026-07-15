import { axios as $axios } from '../lib/axios'

/**
 * 로그인 요청을 수행하는 api 호출 함수
 *
 * @param { object } payload 로그인 정보 - { id: string, password: string }
 * @returns Promise
 */
const requestLogin = payload => $axios.post('/auth/login', payload)

/**
 * 회원가입 요청을 수행하는 api 호출 함수
 *
 * @param { object } payload 회원가입 정보
 *        - { department: string, position: string, name: string, user_id: string, password: string }
 * @returns Promise
 */
const requestRegister = payload => $axios.post('/users', payload)

/**
 * 로그인한 회원 본인의 정보를 조회하는 api 호출 함수
 * 토큰은 axios 요청 인터셉터가 자동으로 헤더에 실어준다.
 *
 * @returns Promise - { department, position, name, user_id }
 */
const requestUserInfo = () => $axios.get('/users/me')

/**
 * 아이디 중복 확인을 수행하는 api 호출 함수
 * 이미 존재하는 아이디인 경우 409 로 응답된다.
 *
 * @param { string } userId 확인할 아이디
 * @returns Promise
 */
const requestCheckUserId = userId => $axios.get(`/users/${encodeURIComponent(userId)}`)

export { requestLogin, requestRegister, requestUserInfo, requestCheckUserId }
