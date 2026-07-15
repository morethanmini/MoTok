import $axios from "axios";

/**
 * 로그인 요청을 수행하는 api 호출 함수
 *
 * @param { object } payload 로그인 정보 - { id: stirng, password: string }
 * @returns Promise
 */
const requestLogin = payload => $axios.post("/auth/login", payload);

/**
 * 로그인한 본인 정보를 조회하는 api 호출 함수
 *
 * @returns Promise
 */
const getMyInfo = () => $axios.get("/users/me");

/**
 * 유저 아이디 중복 여부를 확인하는 api 호출 함수
 *
 * @param { string } userId 중복 확인할 아이디
 * @returns Promise
 */
const checkDuplicateUserId = userId => $axios.get(`/users/${encodeURIComponent(userId)}`);

/**
 * 회원가입 요청을 수행하는 api 호출 함수
 *
 * @param { object } payload 회원가입 정보 - { department, position, name, user_id, password }
 * @returns Promise
 */
const register = payload => $axios.post("/users", payload);

export { requestLogin, getMyInfo, checkDuplicateUserId, register };
