<template>
  <div class="main-sidebar" :style="{ width: width }">
    <div class="hide-on-small">
      <ul class="menu-vertical">
        <li
          v-for="item in state.menuItems"
          :key="item.key"
          :class="{ active: item.key === state.activeMenuName }"
          @click="menuSelect(item)">
          <i v-if="item.icon" :class="['ic', item.icon]"></i>
          <span>{{ item.title }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script>
import { reactive, computed } from 'vue'
import { useStore } from 'vuex'
import { useRouter } from 'vue-router'

export default {
  name: 'MainSidebar',

  props: {
    width: {
      type: String,
      default: '240px'
    }
  },

  setup() {
    const store = useStore()
    const router = useRouter()

    const state = reactive({
      isLoggedIn: computed(() => store.getters['accountStore/isLoggedIn']),
      activeMenuName: computed(() => store.getters['menuStore/getActiveMenuName']),
      // 로그인 상태에 따라 표시되는 메뉴 목록을 구성한다.
      menuItems: computed(() => {
        const menus = store.getters['menuStore/getMenus']
        const items = [{ key: 'home', icon: menus.home.icon, title: menus.home.name }]
        if (state.isLoggedIn) {
          items.push({ key: 'history', icon: menus.history.icon, title: menus.history.name })
          items.push({ key: 'logout', icon: null, title: '로그아웃' })
        }
        return items
      })
    })

    const menuSelect = (item) => {
      if (item.key === 'logout') {
        store.dispatch('accountStore/logoutAction')
        return
      }
      store.commit('menuStore/setMenuActiveMenuName', item.key)
      router.push({ name: item.key })
    }

    return { state, menuSelect }
  }
}
</script>

<style>
.main-sidebar {
  padding: 10px;
  background-color: #f5f5f5;
}

.hide-on-small {
  height: 100%;
}

.menu-vertical {
  list-style: none;
  padding: 0;
  margin: 0;
  height: 100%;
  overflow-y: auto;
}

.menu-vertical li {
  padding: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.menu-vertical li.active {
  background-color: #409eff;
  color: white;
}

.menu-vertical li .ic {
  margin-right: 10px;
}
</style>
