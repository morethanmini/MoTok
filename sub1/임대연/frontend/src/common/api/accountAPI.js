import $axios from "axios";

/**
 * 로그인 요청을 수행하는 api 호출 함수
 *
 * @param { object } payload 로그인 정보 - { id: string, password: string }
 * @returns Promise
 */
const requestLogin = payload => $axios.post("/auth/login", payload);

/**
 * 회원가입 요청을 수행하는 api 호출 함수
 *
 * @param { object } payload 회원 정보 - { user_id, deparment, position, name, password }
 * @returns Promise
 */
const requestRegister = payload => $axios.post("/users", payload);

/**
 * 로그인 한 본인 정보 조회 api 호출 함수
 *
 * @returns Promise
 */
const requestUserInfo = () => $axios.get("/users/me");

/**
 * 아이디 중복 확인 api 호출 함수 (200: 사용 가능, 409: 이미 존재)
 *
 * @param { string } userId 확인할 아이디
 * @returns Promise
 */
const checkUserId = userId => $axios.get(`/users/${userId}`);

/**
 * 회원 정보 수정 api 호출 함수
 *
 * @param { string } userId 수정할 아이디
 * @param { object } payload 수정 정보 - { deparment, position, name }
 * @returns Promise
 */
const updateUser = (userId, payload) => $axios.patch(`/users/${userId}`, payload);

/**
 * 회원 탈퇴 api 호출 함수
 *
 * @param { string } userId 삭제할 아이디
 * @returns Promise
 */
const deleteUser = userId => $axios.delete(`/users/${userId}`);

export { requestLogin, requestRegister, requestUserInfo, checkUserId, updateUser, deleteUser };
