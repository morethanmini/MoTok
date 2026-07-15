import { requestLogin, getMyInfo } from "../common/api/accountAPI";
import { axios } from "../common/lib/axios";

const emptyUserInfo = {
  department: null,
  position: null,
  name: null,
  user_id: null
};

const state = {
  token: null,
  userInfo: { ...emptyUserInfo }
};

const getters = {
  getToken: state => {
    return state.token;
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
    } else {
      localStorage.removeItem('accessToken');
    }
  },
  setUserInfo: (state, userInfo) => {
    state.userInfo = userInfo
      ? {
        department: userInfo.department,
        position: userInfo.position,
        name: userInfo.name,
        user_id: userInfo.user_id
      }
      : { ...emptyUserInfo };
  }
};

const actions = {
  loginAction: async ({ commit }, loginData) => {
    // 로그인 실패(401/404) 시 여기서 catch 하지 않고 그대로 reject 전파 -> 호출부(로그인 다이얼로그)에서 catch해서 에러 메시지 표시.
    const response = await requestLogin(loginData);
    const accessToken = response.data.accessToken;
    commit("setToken", accessToken);
    // axios 헤더에 토큰 설정
    if (accessToken) {
      axios.defaults.headers.Authorization = 'Bearer ' + accessToken;
    }
    return accessToken;
  },

  fetchMyInfoAction: async ({ commit }) => {
    const response = await getMyInfo();
    commit("setUserInfo", response.data);
    return response.data;
  },

  logoutAction: ({ commit }) => {
    commit("setToken", null);
    commit("setUserInfo", null);
    delete axios.defaults.headers.Authorization;
    // SPEC.md 4.1: "홈" 메뉴로 페이지 리프레시
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
