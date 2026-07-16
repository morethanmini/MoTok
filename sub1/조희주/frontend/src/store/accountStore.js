import { requestLogin, requestRegister, requestMe } from "../common/api/accountAPI";
import { axios } from "../common/lib/axios";

const state = {
  token: null,
  userInfo: null
};

const getters = {
  getToken: state => {
    return state.token;
  },
  getUserInfo: state => {
    return state.userInfo;
  },
  isLogin: state => {
    return !!state.userInfo;
  }
};

const mutations = {
  setToken: (state, token) => {
    state.token = token;
    // localStorage에도 저장하여 새로고침 후에도 유지
    if (token) {
      localStorage.setItem('accessToken', token);
    } else {
      localStorage.removeItem('accessToken');
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
    // axios 헤더에 토큰 설정
    if (accessToken) {
      axios.defaults.headers.Authorization = 'Bearer ' + accessToken;
      await dispatch("fetchMyInfoAction");
    }
  },

  registerAction: async (context, registerData) => {
    return requestRegister(registerData);
  },

  // 페이지 진입 시(또는 로그인 직후), 토큰을 통해 본인 정보를 조회하여 로그인 상태를 반영
  fetchMyInfoAction: async ({ commit }) => {
    const response = await requestMe();
    commit("setUserInfo", response.data);
  },

  // 로그아웃 처리: 토큰 삭제 후 홈으로 새로고침
  logoutAction: ({ commit }) => {
    commit("setToken", null);
    commit("setUserInfo", null);
    delete axios.defaults.headers.Authorization;
    window.location.href = '/';
  }
};

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions
};
