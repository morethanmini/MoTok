<template>
  <div class="main-sidebar" :style="{ width: width }">
    <div class="hide-on-small">
      <ul class="menu-vertical">
        <li
          v-for="(item, index) in state.menuItems"
          :key="index"
          :class="{ active: !item.isLogout && state.activeIndex === item.routeIndex }"
          @click="item.isLogout ? handleLogout() : menuSelect(item.routeIndex)">
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

    // SPEC.md 4.4/4.5 - 로그인 상태(토큰 존재 여부)에 따라 메뉴 분기: 비로그인은 "홈"만, 로그인은 홈/지난 회의 이력/로그아웃.
    const isLoggedIn = computed(() => !!store.getters['accountStore/getToken'])

    const state = reactive({
      menuItems: computed(() => {
        const MenuItems = store.getters['menuStore/getMenus']
        const keys = Object.keys(MenuItems)
        const items = keys
          .filter(key => isLoggedIn.value || key === 'home')
          .map(key => ({
            routeIndex: keys.indexOf(key),
            icon: MenuItems[key].icon,
            title: MenuItems[key].name,
            isLogout: false
          }))
        if (isLoggedIn.value) {
          items.push({ routeIndex: -1, icon: null, title: '로그아웃', isLogout: true })
        }
        return items
      }),
      activeIndex: computed(() => store.getters['menuStore/getActiveMenuIndex'])
    })

    if (state.activeIndex === -1) {
      state.activeIndex = 0
      store.commit('menuStore/setMenuActive', 0)
    }

    const menuSelect = (index) => {
      store.commit('menuStore/setMenuActive', index)
      const MenuItems = store.getters['menuStore/getMenus']
      const keys = Object.keys(MenuItems)
      router.push({ name: keys[index] })
    }

    const handleLogout = () => {
      store.dispatch('accountStore/logoutAction')
    }

    return { state, menuSelect, handleLogout }
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
