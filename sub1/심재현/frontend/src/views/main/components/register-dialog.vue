<template>
  <div v-if="visible" class="reg-overlay">
    <div class="reg-dialog">
      <div class="reg-header">
        <h3>회원가입</h3>
        <button class="close-btn" @click="handleClose">&times;</button>
      </div>

      <form @submit.prevent="clickRegister">
        <div class="form-group">
          <label>소속</label>
          <input type="text" v-model="form.department" autocomplete="off" />
          <span v-if="errors.department" class="error">{{ errors.department }}</span>
        </div>

        <div class="form-group">
          <label>직책</label>
          <input type="text" v-model="form.position" autocomplete="off" />
          <span v-if="errors.position" class="error">{{ errors.position }}</span>
        </div>

        <div class="form-group">
          <label>이름</label>
          <input type="text" v-model="form.name" autocomplete="off" />
          <span v-if="errors.name" class="error">{{ errors.name }}</span>
        </div>

        <div class="form-group">
          <label>아이디</label>
          <div class="id-row">
            <input type="text" v-model="form.id" autocomplete="off" @input="onIdInput" />
            <button type="button" class="btn-check" @click="checkId">중복확인</button>
          </div>
          <span v-if="errors.id" class="error">{{ errors.id }}</span>
          <span v-else-if="idSuccessMsg" class="success">{{ idSuccessMsg }}</span>
        </div>

        <div class="form-group">
          <label>비밀번호</label>
          <input type="password" v-model="form.password" autocomplete="off" />
          <span v-if="errors.password" class="error">{{ errors.password }}</span>
        </div>

        <div class="form-group">
          <label>비밀번호 확인</label>
          <input type="password" v-model="form.passwordConfirm" autocomplete="off" />
          <span v-if="errors.passwordConfirm" class="error">{{ errors.passwordConfirm }}</span>
        </div>

        <div class="reg-footer">
          <button type="submit" class="btn-primary" :disabled="!isValid || loading">
            <span v-if="loading" class="spinner"></span>
            <span v-else>가입하기</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script>
import { reactive, ref, computed, watch } from 'vue'
import { requestRegister, requestCheckUserId } from '../../../common/api/accountAPI'

export default {
  name: 'RegisterDialog',

  props: {
    open: {
      type: Boolean,
      default: false
    }
  },

  setup(props, { emit }) {
    const visible = ref(props.open)
    watch(() => props.open, (v) => { visible.value = v })

    const form = reactive({
      department: '',
      position: '',
      name: '',
      id: '',
      password: '',
      passwordConfirm: ''
    })

    const errors = reactive({
      department: '',
      position: '',
      name: '',
      id: '',
      password: '',
      passwordConfirm: ''
    })

    const idChecked = ref(false) // 중복확인 통과 여부
    const idSuccessMsg = ref('')
    const loading = ref(false)

    // 비밀번호: 9~16자, 영문 + 숫자 + 특수문자 조합
    const pwRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{9,16}$/

    const validate = () => {
      // 소속 (선택, 최대 30자)
      errors.department = form.department.length > 30 ? '최대 30자까지 입력 가능합니다.' : ''
      // 직책 (선택, 최대 30자)
      errors.position = form.position.length > 30 ? '최대 30자까지 입력 가능합니다.' : ''
      // 이름 (필수, 최대 30자)
      if (!form.name) errors.name = '필수 입력 항목입니다.'
      else if (form.name.length > 30) errors.name = '최대 30자까지 입력 가능합니다.'
      else errors.name = ''
      // 아이디 (필수, 최대 16자) - 중복확인 메시지는 별도 처리
      if (!form.id) errors.id = '필수 입력 항목입니다.'
      else if (form.id.length > 16) errors.id = '최대 16자까지 입력 가능합니다.'
      else if (!idChecked.value) errors.id = '아이디 중복확인이 필요합니다.'
      else errors.id = ''
      // 비밀번호 (필수, 9~16자, 조합)
      if (!form.password) errors.password = '필수 입력 항목입니다.'
      else if (form.password.length < 9) errors.password = '최소 9글자를 입력해야 합니다.'
      else if (form.password.length > 16) errors.password = '최대 16글자까지 입력 가능합니다.'
      else if (!pwRegex.test(form.password)) errors.password = '비밀번호는 영문, 숫자, 특수문자가 조합되어야 합니다.'
      else errors.password = ''
      // 비밀번호 확인 (필수, 동일 여부)
      if (!form.passwordConfirm) errors.passwordConfirm = '필수 입력 항목입니다.'
      else if (form.passwordConfirm !== form.password) errors.passwordConfirm = '입력한 비밀번호와 일치하지 않습니다.'
      else errors.passwordConfirm = ''
    }

    // 키보드 입력마다 유효성 검사
    watch(form, validate, { deep: true })

    const isValid = computed(() =>
      !errors.department && !errors.position && !errors.name &&
      !errors.id && !errors.password && !errors.passwordConfirm &&
      !!form.name && !!form.id && !!form.password && !!form.passwordConfirm &&
      idChecked.value
    )

    // 아이디를 다시 수정하면 중복확인 무효화
    const onIdInput = () => {
      idChecked.value = false
      idSuccessMsg.value = ''
    }

    const checkId = async () => {
      if (!form.id) {
        errors.id = '필수 입력 항목입니다.'
        return
      }
      if (form.id.length > 16) {
        errors.id = '최대 16자까지 입력 가능합니다.'
        return
      }
      try {
        await requestCheckUserId(form.id) // 200: 사용 가능
        idChecked.value = true
        errors.id = ''
        idSuccessMsg.value = '사용 가능한 아이디입니다.'
      } catch (e) {
        idChecked.value = false
        idSuccessMsg.value = ''
        errors.id = e.response?.data?.message || '이미 존재하는 아이디입니다.'
      }
    }

    const clickRegister = async () => {
      validate()
      if (!isValid.value) return
      loading.value = true
      try {
        await requestRegister({
          id: form.id,
          password: form.password,
          department: form.department,
          position: form.position,
          name: form.name
        })
        loading.value = false
        handleClose()
        alert('회원가입이 완료되었습니다.')
      } catch (e) {
        loading.value = false
        alert('회원가입에 실패하였습니다.')
      }
    }

    const handleClose = () => {
      Object.keys(form).forEach(k => { form[k] = '' })
      Object.keys(errors).forEach(k => { errors[k] = '' })
      idChecked.value = false
      idSuccessMsg.value = ''
      emit('closeRegisterDialog')
    }

    return { visible, form, errors, idSuccessMsg, loading, isValid, onIdInput, checkId, clickRegister, handleClose }
  }
}
</script>

<style scoped>
.reg-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}
.reg-dialog {
  background: white;
  padding: 20px;
  width: 400px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  max-height: 90vh;
  overflow-y: auto;
}
.reg-header {
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
  margin-bottom: 16px;
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
.id-row {
  display: flex;
  gap: 8px;
}
.id-row input {
  flex: 1;
  width: auto;
}
.btn-check {
  padding: 0 12px;
  border: 1px solid #409eff;
  background: white;
  color: #409eff;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
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
.reg-footer {
  text-align: center;
  margin-top: 10px;
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
