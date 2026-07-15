import { axios } from "../lib/axios";

/**
 * 로그인 요청을 수행하는 api 호출 함수
 *
 * @param { object } payload 로그인 정보 - { id: string, password: string }
 * @returns Promise
 */
const requestLogin = payload => axios.post("/auth/login", payload);

/**
 * 회원가입 요청을 수행하는 api 호출 함수
 *
 * @param { object } payload 회원가입 정보 - { id, password, department, position, name }
 * @returns Promise
 */
const requestRegister = payload => axios.post("/users", payload);

/**
 * 아이디 중복 확인 api 호출 함수
 *
 * @param { string } userId 확인할 아이디
 * @returns Promise (200: 사용 가능 / 409: 이미 존재)
 */
const requestCheckUserId = userId => axios.get(`/users/${userId}`);

/**
 * 로그인한 회원 본인 정보 조회 api 호출 함수
 *
 * @returns Promise
 */
const requestMyInfo = () => axios.get("/users/me");

export { requestLogin, requestRegister, requestCheckUserId, requestMyInfo };
