<template>
  <div v-if="state.dialogVisible" class="login-dialog-overlay">
    <div class="login-dialog" v-loading="state.loading">
      <div class="login-dialog-header">
        <h3>로그인</h3>
        <button class="close-btn" @click="handleClose">&times;</button>
      </div>
      <form @submit.prevent="clickLogin" ref="loginForm">
        <div class="form-group">
          <label for="id">아이디</label>
          <input type="text" id="id" v-model="state.form.id" @input="validateId" autocomplete="off" />
          <span v-if="errors.id" class="error">{{ errors.id }}</span>
        </div>
        <div class="form-group">
          <label for="password">비밀번호</label>
          <input type="password" id="password" v-model="state.form.password" @input="validatePassword" autocomplete="off" />
          <span v-if="errors.password" class="error">{{ errors.password }}</span>
        </div>
        <div class="dialog-footer">
          <button type="submit" class="btn-primary" :disabled="!isFormValid">로그인</button>
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
  z-index: 1000;
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
</style>

<script>
import { reactive, computed, ref, watch } from 'vue'
import { useStore } from 'vuex'
import { ElMessage } from 'element-plus'

const ID_MAX = 16
const PASSWORD_MIN = 9
const PASSWORD_MAX = 16
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/

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

    const validateId = () => {
      if (!state.form.id) {
        errors.id = '필수 입력 항목입니다.'
      } else if (state.form.id.length > ID_MAX) {
        errors.id = '최대 16자까지 입력 가능합니다.'
      } else {
        errors.id = ''
      }
      return !errors.id
    }

    const validatePassword = () => {
      const value = state.form.password
      if (!value) {
        errors.password = '필수 입력 항목입니다.'
      } else if (value.length < PASSWORD_MIN) {
        errors.password = '최소 9 글자를 입력해야 합니다.'
      } else if (value.length > PASSWORD_MAX) {
        errors.password = '최대 16 글자까지 입력 가능합니다.'
      } else if (!PASSWORD_PATTERN.test(value)) {
        errors.password = '비밀번호는 영문, 숫자, 특수문자가 조합되어야 합니다.'
      } else {
        errors.password = ''
      }
      return !errors.password
    }

    const isFormValid = computed(() => {
      return !errors.id && !errors.password && state.form.id && state.form.password
    })

    const clickLogin = async () => {
      if (!validateId() || !validatePassword() || !isFormValid.value) return

      state.loading = true
      try {
        await store.dispatch('accountStore/loginAction', { id: state.form.id, password: state.form.password })
        state.loading = false
        handleClose()
      } catch (error) {
        state.loading = false
        const message = error.response && error.response.data && error.response.data.message
        ElMessage.error(message || '로그인에 실패하였습니다.')
      }
    }

    const handleClose = () => {
      state.form.id = ''
      state.form.password = ''
      errors.id = ''
      errors.password = ''
      emit('closeLoginDialog')
    }

    return { state, errors, isFormValid, loginForm, validateId, validatePassword, clickLogin, handleClose }
  }
}
</script>
