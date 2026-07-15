<template>
  <div v-if="state.dialogVisible" class="login-dialog-overlay">
    <div class="login-dialog">
      <div class="login-dialog-header">
        <h3>로그인</h3>
        <button class="close-btn" @click="handleClose">&times;</button>
      </div>
      <form @submit.prevent="clickLogin" ref="loginForm">
        <div class="form-group">
          <label for="login-id">아이디</label>
          <input
            type="text"
            id="login-id"
            v-model="state.form.id"
            maxlength="16"
            autocomplete="off"
            @input="validate"
          />
          <span v-if="errors.id" class="error">{{ errors.id }}</span>
        </div>
        <div class="form-group">
          <label for="login-password">비밀번호</label>
          <input
            type="password"
            id="login-password"
            v-model="state.form.password"
            maxlength="16"
            autocomplete="off"
            @input="validate"
          />
          <span v-if="errors.password" class="error">{{ errors.password }}</span>
        </div>
        <div class="dialog-footer">
          <button type="submit" class="btn-primary" :disabled="!state.isValid || state.loading">로그인</button>
        </div>
      </form>
      <div v-if="state.loading" class="loading-overlay">
        <div class="spinner"></div>
      </div>
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
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 8px;
}
.spinner {
  width: 32px;
  height: 32px;
  border: 4px solid #e0e0e0;
  border-top-color: #409eff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<script>
import { reactive, ref, watch } from 'vue'
import { useStore } from 'vuex'
import { ElMessageBox } from 'element-plus'

const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{9,16}$/

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
      isValid: false,
      loading: false
    })

    const errors = reactive({
      id: '',
      password: ''
    })

    watch(() => props.open, (newVal) => {
      state.dialogVisible = newVal
      if (newVal) {
        state.form.id = ''
        state.form.password = ''
        errors.id = ''
        errors.password = ''
        state.isValid = false
      }
    })

    const validate = () => {
      let valid = true

      if (!state.form.id) {
        errors.id = '필수 입력 항목입니다.'
        valid = false
      } else if (state.form.id.length > 16) {
        errors.id = '최대 16자까지 입력 가능합니다.'
        valid = false
      } else {
        errors.id = ''
      }

      if (!state.form.password) {
        errors.password = '필수 입력 항목입니다.'
        valid = false
      } else if (state.form.password.length < 9) {
        errors.password = '최소 9 글자를 입력해야 합니다.'
        valid = false
      } else if (state.form.password.length > 16) {
        errors.password = '최대 16 글자까지 입력 가능합니다.'
        valid = false
      } else if (!PASSWORD_REGEX.test(state.form.password)) {
        errors.password = '비밀번호는 영문, 숫자, 특수문자가 조합되어야 합니다.'
        valid = false
      } else {
        errors.password = ''
      }

      state.isValid = valid
      return valid
    }

    const clickLogin = async () => {
      if (!validate() || state.loading) {
        return
      }
      state.loading = true
      try {
        await store.dispatch('accountStore/loginAction', { id: state.form.id, password: state.form.password })
        state.loading = false
        handleClose()
      } catch (err) {
        state.loading = false
        const message = (err.response && err.response.data && err.response.data.message) || '로그인에 실패하였습니다.'
        ElMessageBox.alert(message, '알림', { confirmButtonText: '확인' })
      }
    }

    const handleClose = () => {
      state.form.id = ''
      state.form.password = ''
      errors.id = ''
      errors.password = ''
      state.isValid = false
      emit('closeLoginDialog')
    }

    return { state, errors, loginForm, clickLogin, handleClose, validate }
  }
}
</script>
