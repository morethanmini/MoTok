<template>
  <div v-if="state.dialogVisible" class="login-dialog-overlay">
    <div class="login-dialog" v-loading="state.loading">
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
            autocomplete="off"
            @input="validateField('id')" />
          <span v-if="errors.id" class="error">{{ errors.id }}</span>
        </div>
        <div class="form-group">
          <label for="login-password">비밀번호</label>
          <input
            type="password"
            id="login-password"
            v-model="state.form.password"
            autocomplete="off"
            @input="validateField('password')" />
          <span v-if="errors.password" class="error">{{ errors.password }}</span>
        </div>
        <div class="dialog-footer">
          <button type="submit" class="btn-primary" :disabled="!isValid">로그인</button>
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
  z-index: 2000;
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
import { reactive, ref, computed, watch } from 'vue'
import { useStore } from 'vuex'
import { ElMessageBox } from 'element-plus'
import { validateUserId, validateLoginPassword } from '../../../common/util'

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

    watch(
      () => props.open,
      newVal => {
        state.dialogVisible = newVal
      }
    )

    /**
     * 명세서 p.48 - 아이디, 비밀번호 필드에 키보드 입력 시마다 유효성을 체크하여
     * 유효하지 않으면 로그인 버튼을 비활성화한다.
     *
     * 비밀번호 규칙은 팀 결정에 따라 완화된 validateLoginPassword 를 사용한다.
     * (사유는 common/util.js 주석 참고)
     */
    const validateField = field => {
      if (field === 'id') errors.id = validateUserId(state.form.id)
      if (field === 'password') errors.password = validateLoginPassword(state.form.password)
    }

    const isValid = computed(
      () =>
        !validateUserId(state.form.id) &&
        !validateLoginPassword(state.form.password)
    )

    const clickLogin = async () => {
      validateField('id')
      validateField('password')
      if (!isValid.value) return

      // 팝업 내 로딩 스피너 표시 -> 응답 완료까지 다른 인터랙션 방지
      state.loading = true
      try {
        await store.dispatch('accountStore/loginAction', {
          id: state.form.id,
          password: state.form.password
        })
        // 성공: 토큰 저장 + 네비게이션(로그인) 상태 전환은 스토어에서 처리된다.
        handleClose()
      } catch (error) {
        /**
         * 실패: 로딩 스피너가 사라지고 로그인 팝업이 유지된 후
         *       응답 결과의 에러메시지를 팝업 메시지로 표시한다. (명세서 p.48)
         */
        state.loading = false
        const message = error.response?.data?.message || '로그인에 실패하였습니다.'
        ElMessageBox.alert(message, { confirmButtonText: '확인' })
        return
      }
      state.loading = false
    }

    const handleClose = () => {
      state.form.id = ''
      state.form.password = ''
      errors.id = ''
      errors.password = ''
      emit('closeLoginDialog')
    }

    return { state, errors, loginForm, isValid, validateField, clickLogin, handleClose }
  }
}
</script>
