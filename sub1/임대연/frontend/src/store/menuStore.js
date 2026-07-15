/**
 * 메뉴 목록 및 활성화 메뉴 정보
 */

import menuData from "../views/main/menu.json";

const state = {
  activeMenu: "home",
  menus: menuData
};

const getters = {
  // 메뉴 객체 가져오기
  getMenus: state => {
    return state.menus;
  },
  // 로그인 상태에 따라 노출할 메뉴만 반환 (비로그인: 홈만 / 로그인: 홈, 지난 회의 이력, 로그아웃)
  getVisibleMenus: (state, getters, rootState, rootGetters) => {
    const isLoggedIn = rootGetters["accountStore/isLoggedIn"];
    const result = {};
    Object.keys(state.menus).forEach(key => {
      if (isLoggedIn || key === "home") {
        result[key] = state.menus[key];
      }
    });
    return result;
  },
  // 현재 활성화된 메뉴 이름 가져오기
  getActiveMenu: state => {
    return state.activeMenu;
  },
  // Active된 메뉴 인덱스 가져오기
  getActiveMenuIndex: state => {
    const keys = Object.keys(state.menus);
    return keys.findIndex(item => item === state.activeMenu);
  }
};

const mutations = {
  setMenuActive: (state, index) => {
    console.log("setMenuActive", state, index);
    const keys = Object.keys(state.menus);
    state.activeMenu = keys[index];
  },
  setMenuActiveMenuName: (state, menuName) => {
    state.activeMenu = menuName;
  }
};

export default {
  namespaced: true,
  state,
  getters,
  mutations
};
