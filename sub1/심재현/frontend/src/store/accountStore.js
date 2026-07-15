import { requestLogin, requestMyInfo } from "../common/api/accountAPI";

const state = {
  token: localStorage.getItem("accessToken") || null,
  userInfo: null
};

const getters = {
  getToken: state => state.token,
  isLogin: state => !!state.token,
  getUserInfo: state => state.userInfo
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
  setUserInfo: (state, userInfo) => {
    state.userInfo = userInfo;
  }
};

const actions = {
  // 로그인: 성공 시 토큰을 저장하고 본인 정보를 조회한다.
  loginAction: async ({ commit, dispatch }, loginData) => {
    const { data } = await requestLogin(loginData);
    commit("setToken", data.accessToken);
    await dispatch("fetchMyInfo");
  },
  // 본인 정보 조회 (axios 인터셉터가 토큰 헤더를 자동 첨부)
  fetchMyInfo: async ({ commit }) => {
    const { data } = await requestMyInfo();
    commit("setUserInfo", data);
  },
  // 로그아웃: 토큰/유저정보 삭제 후 "홈"으로 리프레시한다.
  logoutAction: ({ commit }) => {
    commit("setToken", null);
    commit("setUserInfo", null);
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
