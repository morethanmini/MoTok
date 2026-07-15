import {
  requestLogin,
  requestRegister,
  requestUserInfo
} from '../common/api/accountAPI'
import { TOKEN_KEY, forceLogout } from '../common/lib/axios'

const state = {
  /**
   * 새로고침하면 자바스크립트 상태는 초기화되지만 localStorage 의 토큰은 남아있다.
   * 초기값을 null 로 두면 토큰이 있어도 비로그인으로 취급되므로, localStorage 에서 복원한다.
   */
  token: localStorage.getItem(TOKEN_KEY),
  // { department, position, name, user_id }
  userInfo: null
}

const getters = {
  getToken: state => {
    return state.token
  },
  getUserInfo: state => {
    return state.userInfo
  },
  // 네비게이션/버튼의 로그인·비로그인 분기 기준
  isLoggedIn: state => {
    return !!state.token
  }
}

const mutations = {
  setToken: (state, token) => {
    state.token = token
    // localStorage에도 저장하여 새로고침 후에도 유지
    if (token) {
      localStorage.setItem(TOKEN_KEY, token)
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
  },
  setUserInfo: (state, userInfo) => {
    state.userInfo = userInfo
  }
}

const actions = {
  /**
   * 로그인 후 토큰을 저장한다.
   * 실패 시 에러를 그대로 던지므로 호출한 팝업에서 메시지를 표시한다.
   */
  loginAction: async ({ commit, dispatch }, loginData) => {
    const response = await requestLogin(loginData)
    const accessToken = response.data.accessToken
    commit('setToken', accessToken)
    // 로그인 직후 유저 정보까지 채워야 네비게이션(로그인) 상태로 전환된다.
    await dispatch('fetchUserInfo')
  },

  registerAction: async (_, registerData) => {
    await requestRegister(registerData)
  },

  /**
   * 페이지 진입 시 토큰이 존재하면 호출한다. (명세서 p.42)
   * 토큰이 유효하지 않으면 axios 응답 인터셉터가 메시지 표시 + 로그아웃을 처리한다.
   */
  fetchUserInfo: async ({ commit }) => {
    const response = await requestUserInfo()
    commit('setUserInfo', response.data)
    return response.data
  },

  /**
   * 로그아웃 처리 (명세서 p.43)
   *  - localStorage 의 토큰 삭제
   *  - "홈" 메뉴로 페이지 리프레시
   * 리프레시하면 스토어도 초기화되므로 상태 정리는 forceLogout 이 대신한다.
   */
  logoutAction: ({ commit }) => {
    commit('setToken', null)
    commit('setUserInfo', null)
    forceLogout()
  }
}

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions
}
