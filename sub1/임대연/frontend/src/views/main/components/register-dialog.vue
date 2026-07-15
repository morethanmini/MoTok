<template>
  <div v-if="state.dialogVisible" class="register-dialog-overlay">
    <div class="register-dialog">
      <div class="register-dialog-header">
        <h3>회원가입</h3>
        <button class="close-btn" @click="handleClose">&times;</button>
      </div>
      <div v-if="state.loading" class="register-loading">
        <span class="register-spinner"></span>
        <span>처리 중...</span>
      </div>
      <form @submit.prevent="clickRegister">
        <div class="form-group">
          <label for="reg-department">소속</label>
          <input type="text" id="reg-department" v-model="form.department" autocomplete="off" />
          <span v-if="errors.department" class="error">{{ errors.department }}</span>
        </div>
        <div class="form-group">
          <label for="reg-position">직책</label>
          <input type="text" id="reg-position" v-model="form.position" autocomplete="off" />
          <span v-if="errors.position" class="error">{{ errors.position }}</span>
        </div>
        <div class="form-group">
          <label for="reg-name">이름</label>
          <input type="text" id="reg-name" v-model="form.name" autocomplete="off" />
          <span v-if="errors.name" class="error">{{ errors.name }}</span>
        </div>
        <div class="form-group">
          <label for="reg-userId">아이디</label>
          <div class="id-check-row">
            <input type="text" id="reg-userId" v-model="form.userId" autocomplete="off" />
            <button type="button" class="btn-secondary" @click="checkId">중복 확인</button>
          </div>
          <span v-if="errors.userId" class="error">{{ errors.userId }}</span>
          <span v-else-if="state.userIdChecked" class="success-msg">사용 가능한 아이디입니다.</span>
        </div>
        <div class="form-group">
          <label for="reg-password">비밀번호</label>
          <input type="password" id="reg-password" v-model="form.password" autocomplete="off" />
          <span v-if="errors.password" class="error">{{ errors.password }}</span>
        </div>
        <div class="form-group">
          <label for="reg-passwordConfirm">비밀번호 확인</label>
          <input type="password" id="reg-passwordConfirm" v-model="form.passwordConfirm" autocomplete="off" />
          <span v-if="errors.passwordConfirm" class="error">{{ errors.passwordConfirm }}</span>
        </div>
        <div class="dialog-footer">
          <button type="submit" class="btn-primary" :disabled="!isFormValid || state.loading">가입하기</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script>
import { reactive, computed, watch } from 'vue'
import { useStore } from 'vuex'
import { ElMessage } from 'element-plus'
import { checkUserId } from '../../../common/api/accountAPI'

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
  name: 'RegisterDialog',

  props: {
    open: {
      type: Boolean,
      default: false
    }
  },

  setup(props, { emit }) {
    const store = useStore()

    const form = reactive({
      department: '',
      position: '',
      name: '',
      userId: '',
      password: '',
      passwordConfirm: ''
    })

    const errors = reactive({
      department: '',
      position: '',
      name: '',
      userId: '',
      password: '',
      passwordConfirm: ''
    })

    const state = reactive({
      dialogVisible: props.open,
      loading: false,
      userIdChecked: false
    })

    const runValidation = () => {
      // 소속 (선택, 최대 30자)
      errors.department = form.department.length > 30 ? '최대 30자까지 입력 가능합니다.' : ''
      // 직책 (선택, 최대 30자)
      errors.position = form.position.length > 30 ? '최대 30자까지 입력 가능합니다.' : ''
      // 이름 (필수, 최대 30자)
      if (!form.name) errors.name = '필수 입력 항목입니다.'
      else if (form.name.length > 30) errors.name = '최대 30자까지 입력 가능합니다.'
      else errors.name = ''
      // 아이디 (필수, 최대 16자, 중복 확인 필요)
      if (!form.userId) errors.userId = '필수 입력 항목입니다.'
      else if (form.userId.length > 16) errors.userId = '최대 16자까지 입력 가능합니다.'
      else if (!state.userIdChecked) errors.userId = '아이디 중복 확인을 해주세요.'
      else errors.userId = ''
      // 비밀번호
      errors.password = validatePassword(form.password)
      // 비밀번호 확인
      const confirmError = validatePassword(form.passwordConfirm)
      if (confirmError) errors.passwordConfirm = confirmError
      else if (form.passwordConfirm !== form.password) errors.passwordConfirm = '입력한 비밀번호와 일치하지 않습니다.'
      else errors.passwordConfirm = ''
    }

    const resetForm = () => {
      form.department = ''
      form.position = ''
      form.name = ''
      form.userId = ''
      form.password = ''
      form.passwordConfirm = ''
      Object.keys(errors).forEach(key => { errors[key] = '' })
      state.userIdChecked = false
      state.loading = false
    }

    watch(() => props.open, newVal => {
      state.dialogVisible = newVal
      if (newVal) resetForm()
    })

    // 아이디가 바뀌면 중복 확인 결과를 무효화한다.
    watch(() => form.userId, () => { state.userIdChecked = false })

    // 명세: 키보드 입력 마다 유효성을 체크한다.
    watch(form, () => runValidation(), { deep: true })

    const isFormValid = computed(() => {
      return !errors.department && !errors.position && !errors.name &&
        !errors.userId && !errors.password && !errors.passwordConfirm &&
        !!form.name && !!form.userId && !!form.password && !!form.passwordConfirm &&
        state.userIdChecked
    })

    const checkId = async () => {
      if (!form.userId) { errors.userId = '필수 입력 항목입니다.'; return }
      if (form.userId.length > 16) { errors.userId = '최대 16자까지 입력 가능합니다.'; return }
      try {
        await checkUserId(form.userId) // 200 → 사용 가능
        state.userIdChecked = true
        errors.userId = ''
        ElMessage.success('사용 가능한 아이디입니다.')
      } catch (error) {
        state.userIdChecked = false
        errors.userId = '이미 존재하는 아이디입니다.'
      }
      runValidation()
    }

    const clickRegister = async () => {
      runValidation()
      if (!isFormValid.value) return
      state.loading = true
      try {
        await store.dispatch('accountStore/registerAction', {
          user_id: form.userId,
          deparment: form.department,
          position: form.position,
          name: form.name,
          password: form.password
        })
        state.loading = false
        handleClose()
        ElMessage.success('회원가입이 완료되었습니다.')
      } catch (error) {
        state.loading = false
        ElMessage.error('회원가입에 실패하였습니다.')
      }
    }

    const handleClose = () => {
      resetForm()
      emit('closeRegisterDialog')
    }

    return { form, errors, state, isFormValid, checkId, clickRegister, handleClose }
  }
}
</script>

<style>
.register-dialog-overlay {
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
.register-dialog {
  background: white;
  padding: 20px;
  width: 400px;
  max-height: 90vh;
  overflow-y: auto;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  position: relative;
}
.register-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.register-dialog .close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
}
.register-dialog .form-group {
  margin-bottom: 16px;
}
.register-dialog .form-group label {
  display: block;
  margin-bottom: 5px;
}
.register-dialog .form-group input {
  width: calc(100% - 20px);
  padding: 8px 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.register-dialog .id-check-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.register-dialog .id-check-row input {
  flex: 1;
}
.register-dialog .error {
  color: red;
  font-size: 12px;
  margin-top: 5px;
  display: block;
}
.register-dialog .success-msg {
  color: #67c23a;
  font-size: 12px;
  margin-top: 5px;
  display: block;
}
.register-dialog .dialog-footer {
  text-align: center;
  margin-top: 8px;
}
.register-dialog .btn-primary {
  background-color: #409eff;
  color: white;
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.register-dialog .btn-primary:disabled {
  background-color: #a0cfff;
  cursor: not-allowed;
}
.register-dialog .btn-secondary {
  white-space: nowrap;
  padding: 8px 12px;
  border: 1px solid #409eff;
  background-color: white;
  color: #409eff;
  border-radius: 4px;
  cursor: pointer;
}
.register-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 0;
  color: #409eff;
}
.register-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #cfe4ff;
  border-top-color: #409eff;
  border-radius: 50%;
  display: inline-block;
  animation: register-spin 0.8s linear infinite;
}
@keyframes register-spin {
  to { transform: rotate(360deg); }
}
</style>
