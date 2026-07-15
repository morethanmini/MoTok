<template>
  <div v-if="state.dialogVisible" class="register-dialog-overlay">
    <div class="register-dialog">
      <div class="register-dialog-header">
        <h3>회원가입</h3>
        <button class="close-btn" @click="handleClose">&times;</button>
      </div>
      <form @submit.prevent="clickRegister" ref="registerForm">
        <div class="form-group">
          <label for="department">소속</label>
          <input type="text" id="department" v-model="state.form.department" autocomplete="off" @input="validateDepartment" />
          <span v-if="errors.department" class="error">{{ errors.department }}</span>
        </div>
        <div class="form-group">
          <label for="position">직책</label>
          <input type="text" id="position" v-model="state.form.position" autocomplete="off" @input="validatePosition" />
          <span v-if="errors.position" class="error">{{ errors.position }}</span>
        </div>
        <div class="form-group">
          <label for="name">이름</label>
          <input type="text" id="name" v-model="state.form.name" autocomplete="off" @input="validateName" />
          <span v-if="errors.name" class="error">{{ errors.name }}</span>
        </div>
        <div class="form-group">
          <label for="userId">아이디</label>
          <div class="input-with-button">
            <input type="text" id="userId" v-model="state.form.userId" autocomplete="off" @input="onUserIdInput" />
            <button type="button" class="btn-default btn-check" @click="clickCheckDuplicate">중복확인</button>
          </div>
          <span v-if="errors.userId" class="error">{{ errors.userId }}</span>
          <span v-else-if="state.userIdCheckMessage" class="success">{{ state.userIdCheckMessage }}</span>
        </div>
        <div class="form-group">
          <label for="password">비밀번호</label>
          <input type="password" id="password" v-model="state.form.password" autocomplete="off" @input="validatePassword" />
          <span v-if="errors.password" class="error">{{ errors.password }}</span>
        </div>
        <div class="form-group">
          <label for="passwordConfirm">비밀번호 확인</label>
          <input type="password" id="passwordConfirm" v-model="state.form.passwordConfirm" autocomplete="off" @input="validatePasswordConfirm" />
          <span v-if="errors.passwordConfirm" class="error">{{ errors.passwordConfirm }}</span>
        </div>
        <div class="dialog-footer">
          <button type="submit" class="btn-primary" :disabled="!canSubmit || state.isSubmitting">가입하기</button>
        </div>
      </form>
      <LoadingSpinner :visible="state.isSubmitting" />
    </div>
  </div>
</template>

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
}
.register-dialog {
  background: white;
  padding: 20px;
  width: 400px;
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
  margin-bottom: 20px;
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
.register-dialog .input-with-button {
  display: flex;
  gap: 8px;
}
.register-dialog .input-with-button input {
  flex: 1;
  width: auto;
}
.register-dialog .input-with-button .btn-check {
  flex-shrink: 0;
  white-space: nowrap;
}
.register-dialog .error {
  color: red;
  font-size: 12px;
  margin-top: 5px;
  display: block;
}
.register-dialog .success {
  color: #67c23a;
  font-size: 12px;
  margin-top: 5px;
  display: block;
}
.register-dialog .dialog-footer {
  text-align: center;
}
.register-dialog .btn-default {
  background-color: #f5f5f5;
  color: #333;
  padding: 8px 14px;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
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
</style>

<script>
import { reactive, ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { checkDuplicateUserId, register } from '../../../common/api/accountAPI'
import LoadingSpinner from '../../../common/components/LoadingSpinner.vue'

const MAX_TEXT_LENGTH = 30
const MAX_ID_LENGTH = 16
const MIN_PASSWORD_LENGTH = 9
const MAX_PASSWORD_LENGTH = 16
// 영문 + 숫자 + 특수문자 조합 확인용 (SPEC.md 4.4)
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).+$/

export default {
  name: 'RegisterDialog',

  components: {
    LoadingSpinner
  },

  props: {
    open: {
      type: Boolean,
      default: false
    }
  },

  setup(props, { emit }) {
    const registerForm = ref(null)

    const state = reactive({
      form: {
        department: '',
        position: '',
        name: '',
        userId: '',
        password: '',
        passwordConfirm: ''
      },
      dialogVisible: props.open,
      isSubmitting: false,
      userIdChecked: false,
      userIdCheckMessage: ''
    })

    const errors = reactive({
      department: '',
      position: '',
      name: '',
      userId: '',
      password: '',
      passwordConfirm: ''
    })

    const resetForm = () => {
      state.form.department = ''
      state.form.position = ''
      state.form.name = ''
      state.form.userId = ''
      state.form.password = ''
      state.form.passwordConfirm = ''
      state.userIdChecked = false
      state.userIdCheckMessage = ''
      errors.department = ''
      errors.position = ''
      errors.name = ''
      errors.userId = ''
      errors.password = ''
      errors.passwordConfirm = ''
    }

    watch(() => props.open, (newVal) => {
      state.dialogVisible = newVal
      if (newVal) {
        resetForm()
      }
    })

    const validateDepartment = () => {
      if (state.form.department.length > MAX_TEXT_LENGTH) {
        errors.department = '최대 30자까지 입력 가능합니다.'
      } else {
        errors.department = ''
      }
    }

    const validatePosition = () => {
      if (state.form.position.length > MAX_TEXT_LENGTH) {
        errors.position = '최대 30자까지 입력 가능합니다.'
      } else {
        errors.position = ''
      }
    }

    const validateName = () => {
      if (!state.form.name) {
        errors.name = '필수 입력 항목입니다.'
      } else if (state.form.name.length > MAX_TEXT_LENGTH) {
        errors.name = '최대 30자까지 입력 가능합니다.'
      } else {
        errors.name = ''
      }
    }

    const validateUserId = () => {
      if (!state.form.userId) {
        errors.userId = '필수 입력 항목입니다.'
      } else if (state.form.userId.length > MAX_ID_LENGTH) {
        errors.userId = '최대 16자까지 입력 가능합니다.'
      } else {
        errors.userId = ''
      }
    }

    const onUserIdInput = () => {
      validateUserId()
      // 아이디를 다시 수정하면 이전 중복확인 결과는 무효화 -> 다시 확인해야 가입 가능.
      state.userIdChecked = false
      state.userIdCheckMessage = ''
    }

    const validatePassword = () => {
      const value = state.form.password
      if (!value) {
        errors.password = '필수 입력 항목입니다.'
      } else if (value.length < MIN_PASSWORD_LENGTH) {
        errors.password = '최소 9글자를 입력해야 합니다.'
      } else if (value.length > MAX_PASSWORD_LENGTH) {
        errors.password = '최대 16글자까지 입력 가능합니다.'
      } else if (!PASSWORD_PATTERN.test(value)) {
        errors.password = '비밀번호는 영문, 숫자, 특수문자가 조합되어야 합니다.'
      } else {
        errors.password = ''
      }
      if (state.form.passwordConfirm) {
        validatePasswordConfirm()
      }
    }

    const validatePasswordConfirm = () => {
      const value = state.form.passwordConfirm
      if (!value) {
        errors.passwordConfirm = '필수 입력 항목입니다.'
      } else if (value.length < MIN_PASSWORD_LENGTH) {
        errors.passwordConfirm = '최소 9글자를 입력해야 합니다.'
      } else if (value.length > MAX_PASSWORD_LENGTH) {
        errors.passwordConfirm = '최대 16글자까지 입력 가능합니다.'
      } else if (!PASSWORD_PATTERN.test(value)) {
        errors.passwordConfirm = '비밀번호는 영문, 숫자, 특수문자가 조합되어야 합니다.'
      } else if (value !== state.form.password) {
        errors.passwordConfirm = '입력한 비밀번호와 일치하지 않습니다.'
      } else {
        errors.passwordConfirm = ''
      }
    }

    const clickCheckDuplicate = async () => {
      validateUserId()
      if (errors.userId) {
        return
      }
      try {
        await checkDuplicateUserId(state.form.userId)
        state.userIdChecked = true
        errors.userId = ''
        state.userIdCheckMessage = '사용 가능한 아이디입니다.'
      } catch (error) {
        state.userIdChecked = false
        state.userIdCheckMessage = ''
        if (error.response && error.response.status === 409) {
          errors.userId = '이미 존재하는 아이디입니다.'
        } else {
          errors.userId = '중복확인에 실패했습니다.'
        }
      }
    }

    const canSubmit = computed(() => {
      return !!(
        !errors.department &&
        !errors.position &&
        !errors.name &&
        !errors.userId &&
        !errors.password &&
        !errors.passwordConfirm &&
        state.form.name &&
        state.form.userId &&
        state.form.password &&
        state.form.passwordConfirm &&
        state.userIdChecked
      )
    })

    const validateAll = () => {
      validateDepartment()
      validatePosition()
      validateName()
      validateUserId()
      validatePassword()
      validatePasswordConfirm()
    }

    const clickRegister = async () => {
      validateAll()
      if (!canSubmit.value) {
        return
      }
      state.isSubmitting = true
      try {
        await register({
          department: state.form.department,
          position: state.form.position,
          name: state.form.name,
          user_id: state.form.userId,
          password: state.form.password
        })
        state.isSubmitting = false
        ElMessage.success('회원가입이 완료되었습니다.')
        handleClose()
      } catch (error) {
        state.isSubmitting = false
        ElMessage.error('회원가입에 실패하였습니다.')
      }
    }

    const handleClose = () => {
      resetForm()
      emit('closeRegisterDialog')
    }

    return {
      state,
      errors,
      registerForm,
      canSubmit,
      validateDepartment,
      validatePosition,
      validateName,
      onUserIdInput,
      validatePassword,
      validatePasswordConfirm,
      clickCheckDuplicate,
      clickRegister,
      handleClose
    }
  }
}
</script>
