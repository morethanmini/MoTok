<template>
  <div v-if="state.dialogVisible" class="register-dialog-overlay">
    <div class="register-dialog" v-loading="state.loading">
      <div class="register-dialog-header">
        <h3>회원가입</h3>
        <button class="close-btn" @click="handleClose">&times;</button>
      </div>
      <form @submit.prevent="clickRegister">
        <div class="form-group">
          <label for="department">소속</label>
          <input type="text" id="department" v-model="state.form.department" @input="validateDepartment" autocomplete="off" />
          <span v-if="errors.department" class="error">{{ errors.department }}</span>
        </div>
        <div class="form-group">
          <label for="position">직책</label>
          <input type="text" id="position" v-model="state.form.position" @input="validatePosition" autocomplete="off" />
          <span v-if="errors.position" class="error">{{ errors.position }}</span>
        </div>
        <div class="form-group">
          <label for="name">이름</label>
          <input type="text" id="name" v-model="state.form.name" @input="validateName" autocomplete="off" />
          <span v-if="errors.name" class="error">{{ errors.name }}</span>
        </div>
        <div class="form-group">
          <label for="userId">아이디</label>
          <div class="input-with-button">
            <input type="text" id="userId" v-model="state.form.userId" @input="onUserIdInput" autocomplete="off" />
            <button type="button" class="btn-secondary" @click="clickCheckUserId">중복 확인</button>
          </div>
          <span v-if="errors.userId" class="error">{{ errors.userId }}</span>
          <span v-else-if="state.userIdCheckMessage" class="success">{{ state.userIdCheckMessage }}</span>
        </div>
        <div class="form-group">
          <label for="password">비밀번호</label>
          <input type="password" id="password" v-model="state.form.password" @input="validatePassword" autocomplete="off" />
          <span v-if="errors.password" class="error">{{ errors.password }}</span>
        </div>
        <div class="form-group">
          <label for="passwordConfirm">비밀번호 확인</label>
          <input type="password" id="passwordConfirm" v-model="state.form.passwordConfirm" @input="validatePasswordConfirm" autocomplete="off" />
          <span v-if="errors.passwordConfirm" class="error">{{ errors.passwordConfirm }}</span>
        </div>
        <div class="dialog-footer">
          <button type="submit" class="btn-primary" :disabled="!isFormValid">가입하기</button>
        </div>
      </form>
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
.input-with-button {
  display: flex;
  gap: 8px;
}
.input-with-button input {
  flex: 1;
}
.btn-secondary {
  white-space: nowrap;
  padding: 8px 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background-color: #f5f5f5;
  cursor: pointer;
}
.error {
  color: red;
  font-size: 12px;
  margin-top: 5px;
  display: block;
}
.success {
  color: #67c23a;
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
import { reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { requestCheckUserId, requestRegister } from '../../../common/api/accountAPI'

const NAME_MAX = 30
const ID_MAX = 16
const PASSWORD_MIN = 9
const PASSWORD_MAX = 16
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/

export default {
  name: 'RegisterDialog',

  props: {
    open: {
      type: Boolean,
      default: false
    }
  },

  emits: ['closeRegisterDialog'],

  setup(props, { emit }) {
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
      loading: false,
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

    watch(() => props.open, (newVal) => {
      state.dialogVisible = newVal
    })

    const validateDepartment = () => {
      errors.department = state.form.department.length > NAME_MAX ? '최대 30자까지 입력 가능합니다.' : ''
      return !errors.department
    }

    const validatePosition = () => {
      errors.position = state.form.position.length > NAME_MAX ? '최대 30자까지 입력 가능합니다.' : ''
      return !errors.position
    }

    const validateName = () => {
      if (!state.form.name) {
        errors.name = '필수 입력 항목입니다.'
      } else if (state.form.name.length > NAME_MAX) {
        errors.name = '최대 30자까지 입력 가능합니다.'
      } else {
        errors.name = ''
      }
      return !errors.name
    }

    const validateUserId = () => {
      if (!state.form.userId) {
        errors.userId = '필수 입력 항목입니다.'
      } else if (state.form.userId.length > ID_MAX) {
        errors.userId = '최대 16자까지 입력 가능합니다.'
      } else {
        errors.userId = ''
      }
      return !errors.userId
    }

    const onUserIdInput = () => {
      state.userIdChecked = false
      state.userIdCheckMessage = ''
      validateUserId()
    }

    const clickCheckUserId = async () => {
      if (!validateUserId()) return
      try {
        await requestCheckUserId(state.form.userId)
        state.userIdChecked = true
        state.userIdCheckMessage = '사용 가능한 아이디입니다.'
        errors.userId = ''
      } catch (error) {
        if (error.response && error.response.status === 409) {
          state.userIdChecked = false
          state.userIdCheckMessage = ''
          errors.userId = '이미 존재하는 아이디입니다.'
        }
      }
    }

    const validatePasswordValue = (value) => {
      if (!value) return '필수 입력 항목입니다.'
      if (value.length < PASSWORD_MIN) return '최소 9 글자를 입력해야 합니다.'
      if (value.length > PASSWORD_MAX) return '최대 16 글자까지 입력 가능합니다.'
      if (!PASSWORD_PATTERN.test(value)) return '비밀번호는 영문, 숫자, 특수문자가 조합되어야 합니다.'
      return ''
    }

    const validatePassword = () => {
      errors.password = validatePasswordValue(state.form.password)
      if (state.form.passwordConfirm) validatePasswordConfirm()
      return !errors.password
    }

    const validatePasswordConfirm = () => {
      const baseError = validatePasswordValue(state.form.passwordConfirm)
      if (baseError) {
        errors.passwordConfirm = baseError
      } else if (state.form.passwordConfirm !== state.form.password) {
        errors.passwordConfirm = '입력한 비밀번호와 일치하지 않습니다.'
      } else {
        errors.passwordConfirm = ''
      }
      return !errors.passwordConfirm
    }

    const isFormValid = computed(() => {
      return (
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

    const clickRegister = async () => {
      if (!isFormValid.value) return

      state.loading = true
      try {
        await requestRegister({
          deparment: state.form.department,
          position: state.form.position,
          name: state.form.name,
          user_id: state.form.userId,
          password: state.form.password
        })
        state.loading = false
        resetForm()
        emit('closeRegisterDialog')
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

    return {
      state,
      errors,
      isFormValid,
      validateDepartment,
      validatePosition,
      validateName,
      onUserIdInput,
      clickCheckUserId,
      validatePassword,
      validatePasswordConfirm,
      clickRegister,
      handleClose
    }
  }
}
</script>
