import { requestLogin, requestMyInfo } from "../common/api/accountAPI";
import { axios } from "../common/lib/axios";

const state = {
  token: localStorage.getItem('accessToken') || null,
  userInfo: null
};

const getters = {
  getToken: state => {
    return state.token;
  },
  isLoggedIn: state => {
    return !!state.token;
  },
  getUserInfo: state => {
    return state.userInfo;
  }
};

const mutations = {
  setToken: (state, token) => {
    state.token = token;
    // localStorage에도 저장하여 새로고침 후에도 유지
    if (token) {
      localStorage.setItem('accessToken', token);
      axios.defaults.headers.Authorization = 'Bearer ' + token;
    } else {
      localStorage.removeItem('accessToken');
      delete axios.defaults.headers.Authorization;
    }
  },
  setUserInfo: (state, userInfo) => {
    state.userInfo = userInfo;
  }
};

const actions = {
  loginAction: async ({ commit, dispatch }, loginData) => {
    const response = await requestLogin(loginData);
    const accessToken = response.data.accessToken;
    commit("setToken", accessToken);
    await dispatch("fetchMyInfoAction");
  },
  // 페이지 진입 시 토큰이 존재하는 경우, 유저 정보를 받아오기 위한 액션
  fetchMyInfoAction: async ({ commit }) => {
    const response = await requestMyInfo();
    commit("setUserInfo", response.data);
  },
  // localStorage 에 저장된 토큰을 삭제하고, "홈" 메뉴로 페이지를 리프레시 하는 로그아웃 액션
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
