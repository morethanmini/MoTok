<template>
  <div v-if="state.dialogVisible" class="login-dialog-overlay">
    <div class="login-dialog">
      <div class="login-dialog-header">
        <h3>로그인</h3>
        <button class="close-btn" @click="handleClose">&times;</button>
      </div>
      <form @submit.prevent="clickLogin" ref="loginForm">
        <div class="form-group">
          <label for="id">아이디</label>
          <input type="text" id="id" v-model="state.form.id" autocomplete="off" />
          <span v-if="errors.id" class="error">{{ errors.id }}</span>
        </div>
        <div class="form-group">
          <label for="password">비밀번호</label>
          <input type="password" id="password" v-model="state.form.password" autocomplete="off" />
          <span v-if="errors.password" class="error">{{ errors.password }}</span>
        </div>
        <div class="dialog-footer">
          <button type="submit" class="btn-primary" :disabled="!isValid || state.loading">
            <span v-if="state.loading" class="spinner"></span>
            <span v-else>로그인</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style>
.login-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
}
.login-dialog {
  background: white;
  padding: 20px;
  width: 400px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  position: relative;
}
.login-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
}
.form-group {
  margin-bottom: 20px;
}
.form-group label {
  display: block;
  margin-bottom: 5px;
}
.form-group input {
  width: calc(100% - 20px);
  padding: 8px 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.error {
  color: red;
  font-size: 12px;
  margin-top: 5px;
  display: block;
}
.dialog-footer {
  text-align: center;
}
.btn-primary {
  background-color: #409eff;
  color: white;
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  min-width: 90px;
}
.btn-primary:disabled {
  background-color: #a0cfff;
  cursor: not-allowed;
}
.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid #fff;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

<script>
import { reactive, ref, watch, computed } from 'vue'
import { useStore } from 'vuex'

export default {
  name: 'LoginDialog',

  props: {
    open: {
      type: Boolean,
      default: false
    }
  },

  setup(props, { emit }) {
    const store = useStore()
    const loginForm = ref(null)

    const state = reactive({
      form: {
        id: '',
        password: ''
      },
      dialogVisible: props.open,
      loading: false
    })

    const errors = reactive({
      id: '',
      password: ''
    })

    watch(() => props.open, (newVal) => {
      state.dialogVisible = newVal
    })

    // 아이디/비밀번호 입력마다 유효성 검사(에러 메시지 갱신)
    watch(() => [state.form.id, state.form.password], () => validate())

    // 로그인 버튼 활성/비활성 판단 (유효한 경우에만 활성화)
    const pwRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{9,16}$/
    const isValid = computed(() =>
      !!state.form.id && state.form.id.length <= 16 &&
      !!state.form.password && pwRegex.test(state.form.password)
    )

    const validate = () => {
      let valid = true
      // 아이디: 필수, 최대 16자
      if (!state.form.id) {
        errors.id = '필수 입력 항목입니다.'
        valid = false
      } else if (state.form.id.length > 16) {
        errors.id = '최대 16자까지 입력 가능합니다.'
        valid = false
      } else {
        errors.id = ''
      }

      // 비밀번호: 필수, 9~16자, 영문 + 숫자 + 특수문자 조합
      const pwRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{9,16}$/
      if (!state.form.password) {
        errors.password = '필수 입력 항목입니다.'
        valid = false
      } else if (state.form.password.length < 9) {
        errors.password = '최소 9글자를 입력해야 합니다.'
        valid = false
      } else if (state.form.password.length > 16) {
        errors.password = '최대 16글자까지 입력 가능합니다.'
        valid = false
      } else if (!pwRegex.test(state.form.password)) {
        errors.password = '비밀번호는 영문, 숫자, 특수문자가 조합되어야 합니다.'
        valid = false
      } else {
        errors.password = ''
      }

      return valid
    }

    const clickLogin = async () => {
      if (!validate()) return
      // 팝업 내 로딩 스피너 표시
      state.loading = true
      try {
        await store.dispatch('accountStore/loginAction', { id: state.form.id, password: state.form.password })
        state.loading = false
        handleClose()
      } catch (e) {
        // 실패 시 로딩 스피너 제거, 팝업 유지 후 응답 에러메시지를 팝업으로 표시한다.
        state.loading = false
        alert(e.response?.data?.message || '로그인에 실패하였습니다.')
      }
    }

    const handleClose = () => {
      state.form.id = ''
      state.form.password = ''
      errors.id = ''
      errors.password = ''
      state.loading = false
      emit('closeLoginDialog')
    }

    return { state, errors, loginForm, isValid, clickLogin, handleClose }
  }
}
</script>
