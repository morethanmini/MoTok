/**
 * 메뉴 목록 및 활성화 메뉴 정보
 */

import menuData from "../views/main/menu.json";

const state = {
  activeMenu: "home",
  menus: menuData
};

const getters = {
  /**
   * 로그인 상태에 따라 노출할 메뉴만 걸러서 반환한다. (명세서 p.43, p.49)
   *  - 비로그인: 홈
   *  - 로그인  : 홈, 지난 회의 이력, 로그아웃
   *
   * menu.json 의 auth 값이 "user" 인 메뉴는 로그인 상태에서만 노출한다.
   */
  getMenus: (state, getters, rootState, rootGetters) => {
    const isLoggedIn = rootGetters["accountStore/isLoggedIn"];
    return Object.keys(state.menus).reduce((acc, key) => {
      const menu = state.menus[key];
      if (menu.auth === "user" && !isLoggedIn) return acc;
      acc[key] = menu;
      return acc;
    }, {});
  },
  // Active된 메뉴 인덱스 가져오기 (노출 중인 메뉴 기준)
  getActiveMenuIndex: (state, getters) => {
    const keys = Object.keys(getters.getMenus);
    return keys.findIndex(item => item === state.activeMenu);
  }
};

const mutations = {
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
