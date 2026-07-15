import $axios from "axios";

/**
 * 로그인 요청을 수행하는 api 호출 함수
 *
 * @param { object } payload 로그인 정보 - { id: stirng, password: string }
 * @returns Promise
 */
const requestLogin = payload => $axios.post("/auth/login", payload);

/**
 * 회원가입 요청을 수행하는 api 호출 함수
 *
 * @param { object } payload 회원가입 정보 - { deparment, position, name, user_id, password }
 * @returns Promise
 */
const requestRegister = payload => $axios.post("/users", payload);

/**
 * 로그인한 회원 본인의 정보를 조회하는 api 호출 함수
 *
 * @returns Promise
 */
const requestMyInfo = () => $axios.get("/users/me");

/**
 * 아이디 중복 여부를 확인하는 api 호출 함수
 *
 * @param { string } userId 확인할 아이디
 * @returns Promise
 */
const requestCheckUserId = userId => $axios.get(`/users/${userId}`);

export { requestLogin, requestRegister, requestMyInfo, requestCheckUserId };
