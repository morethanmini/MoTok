<template>
  <div v-if="state.dialogVisible" class="register-dialog-overlay">
    <div class="register-dialog" v-loading="state.loading">
      <div class="register-dialog-header">
        <h3>회원가입</h3>
        <button class="close-btn" @click="handleClose">&times;</button>
      </div>

      <form @submit.prevent="clickRegister">
        <!-- 소속 : 선택 입력, 최대 30자 -->
        <div class="form-group">
          <label for="register-department">소속</label>
          <input
            type="text"
            id="register-department"
            v-model="state.form.department"
            autocomplete="off"
            @input="validateField('department')" />
          <span v-if="errors.department" class="error">{{ errors.department }}</span>
        </div>

        <!-- 직책 : 선택 입력, 최대 30자 -->
        <div class="form-group">
          <label for="register-position">직책</label>
          <input
            type="text"
            id="register-position"
            v-model="state.form.position"
            autocomplete="off"
            @input="validateField('position')" />
          <span v-if="errors.position" class="error">{{ errors.position }}</span>
        </div>

        <!-- 이름 : 필수 입력, 최대 30자 -->
        <div class="form-group">
          <label for="register-name">이름</label>
          <input
            type="text"
            id="register-name"
            v-model="state.form.name"
            autocomplete="off"
            @input="validateField('name')" />
          <span v-if="errors.name" class="error">{{ errors.name }}</span>
        </div>

        <!-- 아이디 : 필수 입력, 최대 16자, 중복 확인 필요 -->
        <div class="form-group">
          <label for="register-user-id">아이디</label>
          <div class="input-with-button">
            <input
              type="text"
              id="register-user-id"
              v-model="state.form.userId"
              autocomplete="off"
              @input="onUserIdInput" />
            <button
              type="button"
              class="btn-default"
              :disabled="!!errors.userId || !state.form.userId || state.checkingUserId"
              @click="clickCheckUserId">
              중복 확인
            </button>
          </div>
          <span v-if="errors.userId" class="error">{{ errors.userId }}</span>
          <span v-else-if="state.userIdChecked" class="success">사용 가능한 아이디입니다.</span>
        </div>

        <!-- 비밀번호 : 필수 입력, 9~16자, 영문+숫자+특수문자 조합 -->
        <div class="form-group">
          <label for="register-password">비밀번호</label>
          <input
            type="password"
            id="register-password"
            v-model="state.form.password"
            autocomplete="off"
            @input="onPasswordInput" />
          <span v-if="errors.password" class="error">{{ errors.password }}</span>
        </div>

        <!-- 비밀번호 확인 : 위 규칙 + 비밀번호와 일치 -->
        <div class="form-group">
          <label for="register-password-confirm">비밀번호 확인</label>
          <input
            type="password"
            id="register-password-confirm"
            v-model="state.form.passwordConfirm"
            autocomplete="off"
            @input="validateField('passwordConfirm')" />
          <span v-if="errors.passwordConfirm" class="error">{{ errors.passwordConfirm }}</span>
        </div>

        <div class="dialog-footer">
          <button type="submit" class="btn-primary" :disabled="!isValid">가입하기</button>
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
  z-index: 2000;
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
.register-dialog .input-with-button {
  display: flex;
  gap: 8px;
}
.register-dialog .input-with-button input {
  flex: 1;
  width: auto;
}
.register-dialog .btn-default {
  flex-shrink: 0;
  padding: 8px 12px;
  border: 1px solid #dcdfe6;
  background-color: #ffffff;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.register-dialog .btn-default:disabled {
  color: #a8abb2;
  cursor: not-allowed;
}
.register-dialog .success {
  color: #67c23a;
  font-size: 12px;
  margin-top: 5px;
  display: block;
}
</style>

<script>
import { reactive, computed, watch } from 'vue'
import { useStore } from 'vuex'
import { ElMessageBox } from 'element-plus'
import { requestCheckUserId } from '../../../common/api/accountAPI'
import {
  validateOptionalText30,
  validateName,
  validateUserId,
  validateRegisterPassword,
  validateRegisterPasswordConfirm
} from '../../../common/util'

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
      // 중복 확인 버튼을 눌러 "사용 가능"을 확인했는지 여부
      userIdChecked: false,
      checkingUserId: false
    })

    const errors = reactive({
      department: '',
      position: '',
      name: '',
      userId: '',
      password: '',
      passwordConfirm: ''
    })

    watch(
      () => props.open,
      newVal => {
        state.dialogVisible = newVal
      }
    )

    /** 명세서 p.46 - 각 필드에 키보드 입력마다 유효성을 체크한다. */
    const validateField = field => {
      switch (field) {
        case 'department':
          errors.department = validateOptionalText30(state.form.department)
          break
        case 'position':
          errors.position = validateOptionalText30(state.form.position)
          break
        case 'name':
          errors.name = validateName(state.form.name)
          break
        case 'userId':
          errors.userId = validateUserId(state.form.userId)
          break
        case 'password':
          errors.password = validateRegisterPassword(state.form.password)
          break
        case 'passwordConfirm':
          errors.passwordConfirm = validateRegisterPasswordConfirm(
            state.form.passwordConfirm,
            state.form.password
          )
          break
      }
    }

    /**
     * 아이디를 다시 수정하면 이전 중복 확인 결과를 무효화한다.
     * 그렇지 않으면 "확인 후 아이디를 바꿔서 가입" 하는 구멍이 생긴다.
     */
    const onUserIdInput = () => {
      state.userIdChecked = false
      validateField('userId')
    }

    // 비밀번호가 바뀌면 이미 입력된 '비밀번호 확인'의 일치 여부도 다시 검사한다.
    const onPasswordInput = () => {
      validateField('password')
      if (state.form.passwordConfirm) validateField('passwordConfirm')
    }

    const clickCheckUserId = async () => {
      validateField('userId')
      if (errors.userId) return

      state.checkingUserId = true
      try {
        await requestCheckUserId(state.form.userId)
        // 200 -> 사용 가능한 아이디
        state.userIdChecked = true
        errors.userId = ''
      } catch (error) {
        state.userIdChecked = false
        if (error.response?.status === 409) {
          errors.userId = '이미 존재하는 아이디입니다.'
        } else {
          errors.userId = '아이디 중복 확인에 실패하였습니다.'
        }
      } finally {
        state.checkingUserId = false
      }
    }

    /**
     * 명세서 p.46 - 모든 필드가 유효하고, 중복 확인 결과까지 통과해야
     * "가입하기" 버튼이 활성화된다.
     */
    const isValid = computed(
      () =>
        !validateOptionalText30(state.form.department) &&
        !validateOptionalText30(state.form.position) &&
        !validateName(state.form.name) &&
        !validateUserId(state.form.userId) &&
        !validateRegisterPassword(state.form.password) &&
        !validateRegisterPasswordConfirm(state.form.passwordConfirm, state.form.password) &&
        state.userIdChecked
    )

    const clickRegister = async () => {
      if (!isValid.value) return

      // 팝업 내 로딩 스피너 표시
      state.loading = true
      try {
        await store.dispatch('accountStore/registerAction', {
          department: state.form.department,
          position: state.form.position,
          name: state.form.name,
          user_id: state.form.userId,
          password: state.form.password
        })
      } catch (error) {
        // 실패: 스피너가 사라지고 회원가입 팝업이 유지된 후 팝업 메시지를 표시한다.
        state.loading = false
        ElMessageBox.alert('회원가입에 실패하였습니다.', { confirmButtonText: '확인' })
        return
      }
      // 성공: 스피너가 사라지고 회원가입 팝업이 닫힌 후 팝업 메시지를 표시한다.
      state.loading = false
      handleClose()
      ElMessageBox.alert('회원가입이 완료되었습니다.', { confirmButtonText: '확인' })
    }

    const handleClose = () => {
      Object.keys(state.form).forEach(key => {
        state.form[key] = ''
      })
      Object.keys(errors).forEach(key => {
        errors[key] = ''
      })
      state.userIdChecked = false
      emit('closeRegisterDialog')
    }

    return {
      state,
      errors,
      isValid,
      validateField,
      onUserIdInput,
      onPasswordInput,
      clickCheckUserId,
      clickRegister,
      handleClose
    }
  }
}
</script>
