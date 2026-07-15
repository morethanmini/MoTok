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
        <div v-if="state.loading" class="login-loading">처리 중...</div>
        <div class="dialog-footer">
          <button type="submit" class="btn-primary" :disabled="!isFormValid || state.loading">로그인</button>
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
}
.btn-primary:disabled {
  background-color: #a0cfff;
  cursor: not-allowed;
}
.login-loading {
  text-align: center;
  color: #409eff;
  margin-bottom: 12px;
}
</style>

<script>
import { reactive, ref, computed, watch } from 'vue'
import { useStore } from 'vuex'
import { ElMessage } from 'element-plus'

const PASSWORD_COMBINATION_MESSAGE = '비밀번호는 영문, 숫자, 특수문자가 조합되어야 합니다.'

// 비밀번호 유효성: 9~16자, 영문 + 숫자 + 특수문자 조합
const validatePassword = value => {
  if (!value) return '필수 입력 항목입니다.'
  if (value.length < 9) return '최소 9글자를 입력해야 합니다.'
  if (value.length > 16) return '최대 16글자까지 입력 가능합니다.'
  const hasLetter = /[A-Za-z]/.test(value)
  const hasNumber = /[0-9]/.test(value)
  const hasSpecial = /[^A-Za-z0-9]/.test(value)
  if (!(hasLetter && hasNumber && hasSpecial)) return PASSWORD_COMBINATION_MESSAGE
  return ''
}

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

    const runValidation = () => {
      // 아이디 (필수, 최대 16자)
      if (!state.form.id) errors.id = '필수 입력 항목입니다.'
      else if (state.form.id.length > 16) errors.id = '최대 16자까지 입력 가능합니다.'
      else errors.id = ''
      // 비밀번호 (9~16자, 영문 + 숫자 + 특수문자)
      errors.password = validatePassword(state.form.password)
    }

    const resetForm = () => {
      state.form.id = ''
      state.form.password = ''
      errors.id = ''
      errors.password = ''
      state.loading = false
    }

    watch(() => props.open, (newVal) => {
      state.dialogVisible = newVal
      if (newVal) resetForm()
    })

    // 명세: 키보드 입력 시 마다 유효성을 체크한다.
    watch(() => state.form, () => runValidation(), { deep: true })

    const isFormValid = computed(() => {
      return !errors.id && !errors.password && !!state.form.id && !!state.form.password
    })

    const clickLogin = async () => {
      runValidation()
      if (!isFormValid.value) return
      state.loading = true
      try {
        await store.dispatch('accountStore/loginAction', { id: state.form.id, password: state.form.password })
        state.loading = false
        handleClose()
      } catch (error) {
        state.loading = false
        const message = (error.response && error.response.data && error.response.data.message) || '로그인에 실패하였습니다.'
        ElMessage.error(message)
      }
    }

    const handleClose = () => {
      resetForm()
      emit('closeLoginDialog')
    }

    return { state, errors, loginForm, isFormValid, clickLogin, handleClose }
  }
}
</script>
