import { requestLogin, requestUserInfo, requestRegister } from "../common/api/accountAPI";

const state = {
  // 새로고침 후에도 로그인 상태를 복원할 수 있도록 localStorage 값으로 초기화
  token: localStorage.getItem("accessToken"),
  user: null
};

const getters = {
  getToken: state => {
    return state.token;
  },
  getUser: state => {
    return state.user;
  },
  isLoggedIn: state => {
    return !!state.token;
  }
};

const mutations = {
  setToken: (state, token) => {
    state.token = token;
    // localStorage에도 저장하여 새로고침 후에도 유지
    if (token) {
      localStorage.setItem("accessToken", token);
    } else {
      localStorage.removeItem("accessToken");
    }
  },
  setUser: (state, user) => {
    state.user = user;
  }
};

const actions = {
  loginAction: async ({ commit, dispatch }, loginData) => {
    const response = await requestLogin(loginData);
    const accessToken = response.data.accessToken;
    commit("setToken", accessToken);
    // 로그인 직후 본인 정보를 조회하여 저장한다. (Authorization 헤더는 axios 인터셉터가 처리)
    await dispatch("fetchMe");
  },
  fetchMe: async ({ commit }) => {
    const response = await requestUserInfo();
    commit("setUser", response.data);
  },
  registerAction: (_, registerData) => {
    return requestRegister(registerData);
  },
  logoutAction: ({ commit }) => {
    commit("setToken", null);
    commit("setUser", null);
    // 명세: localStorage 토큰 삭제 후 "홈" 메뉴로 페이지를 리프레시한다.
    window.location.href = "/";
  }
};

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions
};
