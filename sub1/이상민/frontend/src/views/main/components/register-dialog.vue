<template>
  <div v-if="state.dialogVisible" class="register-dialog-overlay">
    <div class="register-dialog">
      <div class="register-dialog-header">
        <h3>회원가입</h3>
        <button class="close-btn" @click="handleClose">&times;</button>
      </div>
      <form @submit.prevent="clickRegister">
        <div class="form-group">
          <label for="register-department">소속</label>
          <input
            type="text"
            id="register-department"
            v-model="state.form.department"
            maxlength="30"
            autocomplete="off"
            @input="validate"
          />
          <span v-if="errors.department" class="error">{{ errors.department }}</span>
        </div>
        <div class="form-group">
          <label for="register-position">직책</label>
          <input
            type="text"
            id="register-position"
            v-model="state.form.position"
            maxlength="30"
            autocomplete="off"
            @input="validate"
          />
          <span v-if="errors.position" class="error">{{ errors.position }}</span>
        </div>
        <div class="form-group">
          <label for="register-name">이름</label>
          <input
            type="text"
            id="register-name"
            v-model="state.form.name"
            maxlength="30"
            autocomplete="off"
            @input="validate"
          />
          <span v-if="errors.name" class="error">{{ errors.name }}</span>
        </div>
        <div class="form-group">
          <label for="register-user-id">아이디</label>
          <div class="input-with-button">
            <input
              type="text"
              id="register-user-id"
              v-model="state.form.userId"
              maxlength="16"
              autocomplete="off"
              @input="onChangeUserId"
            />
            <button type="button" class="btn-secondary" @click="clickCheckDuplicate">중복 확인</button>
          </div>
          <span v-if="errors.userId" class="error">{{ errors.userId }}</span>
          <span v-else-if="state.idCheckStatus === 'available'" class="success">사용 가능한 아이디입니다.</span>
        </div>
        <div class="form-group">
          <label for="register-password">비밀번호</label>
          <input
            type="password"
            id="register-password"
            v-model="state.form.password"
            maxlength="16"
            autocomplete="off"
            @input="validate"
          />
          <span v-if="errors.password" class="error">{{ errors.password }}</span>
        </div>
        <div class="form-group">
          <label for="register-password-confirm">비밀번호 확인</label>
          <input
            type="password"
            id="register-password-confirm"
            v-model="state.form.passwordConfirm"
            maxlength="16"
            autocomplete="off"
            @input="validate"
          />
          <span v-if="errors.passwordConfirm" class="error">{{ errors.passwordConfirm }}</span>
        </div>
        <div class="dialog-footer">
          <button type="submit" class="btn-primary" :disabled="!state.isValid || state.loading">가입하기</button>
        </div>
      </form>
      <div v-if="state.loading" class="loading-overlay">
        <div class="spinner"></div>
      </div>
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
  width: 420px;
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
.btn-secondary {
  white-space: nowrap;
  padding: 8px 12px;
  border: 1px solid #409eff;
  background-color: white;
  color: #409eff;
  border-radius: 4px;
  cursor: pointer;
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
.register-dialog .loading-overlay {
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
.register-dialog .spinner {
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
import { reactive, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { requestRegister, requestCheckUserId } from '../../../common/api/accountAPI'

const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{9,16}$/

const initialForm = () => ({
  department: '',
  position: '',
  name: '',
  userId: '',
  password: '',
  passwordConfirm: ''
})

export default {
  name: 'RegisterDialog',

  props: {
    open: {
      type: Boolean,
      default: false
    }
  },

  setup(props, { emit }) {
    const state = reactive({
      form: initialForm(),
      dialogVisible: props.open,
      isValid: false,
      loading: false,
      idCheckStatus: null // null | 'available' | 'duplicate'
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
      if (newVal) {
        state.form = initialForm()
        Object.keys(errors).forEach(key => { errors[key] = '' })
        state.isValid = false
        state.idCheckStatus = null
      }
    })

    const validate = () => {
      let valid = true

      if (state.form.department.length > 30) {
        errors.department = '최대 30자까지 입력 가능합니다.'
        valid = false
      } else {
        errors.department = ''
      }

      if (state.form.position.length > 30) {
        errors.position = '최대 30자까지 입력 가능합니다.'
        valid = false
      } else {
        errors.position = ''
      }

      if (!state.form.name) {
        errors.name = '필수 입력 항목입니다.'
        valid = false
      } else if (state.form.name.length > 30) {
        errors.name = '최대 30자까지 입력 가능합니다.'
        valid = false
      } else {
        errors.name = ''
      }

      if (!state.form.userId) {
        errors.userId = '필수 입력 항목입니다.'
        valid = false
      } else if (state.form.userId.length > 16) {
        errors.userId = '최대 16자까지 입력 가능합니다.'
        valid = false
      } else if (state.idCheckStatus === 'duplicate') {
        errors.userId = '이미 존재하는 아이디입니다.'
        valid = false
      } else if (state.idCheckStatus !== 'available') {
        errors.userId = '아이디 중복 확인이 필요합니다.'
        valid = false
      } else {
        errors.userId = ''
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

      if (!state.form.passwordConfirm) {
        errors.passwordConfirm = '필수 입력 항목입니다.'
        valid = false
      } else if (state.form.passwordConfirm !== state.form.password) {
        errors.passwordConfirm = '입력한 비밀번호와 일치하지 않습니다.'
        valid = false
      } else {
        errors.passwordConfirm = ''
      }

      state.isValid = valid
      return valid
    }

    const onChangeUserId = () => {
      // 아이디를 다시 입력하면 중복확인 결과를 초기화한다.
      state.idCheckStatus = null
      validate()
    }

    const clickCheckDuplicate = async () => {
      if (!state.form.userId || state.form.userId.length > 16) {
        validate()
        return
      }
      try {
        await requestCheckUserId(state.form.userId)
        state.idCheckStatus = 'available'
      } catch (err) {
        if (err.response && err.response.status === 409) {
          state.idCheckStatus = 'duplicate'
        } else {
          state.idCheckStatus = null
        }
      }
      validate()
    }

    const clickRegister = async () => {
      if (!validate() || state.loading) {
        return
      }
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
        handleClose()
        ElMessageBox.alert('회원가입이 완료되었습니다.', '알림', { confirmButtonText: '확인' })
      } catch (err) {
        state.loading = false
        ElMessageBox.alert('회원가입에 실패하였습니다.', '알림', { confirmButtonText: '확인' })
      }
    }

    const handleClose = () => {
      state.form = initialForm()
      Object.keys(errors).forEach(key => { errors[key] = '' })
      state.isValid = false
      state.idCheckStatus = null
      emit('closeRegisterDialog')
    }

    return { state, errors, validate, onChangeUserId, clickCheckDuplicate, clickRegister, handleClose }
  }
}
</script>
