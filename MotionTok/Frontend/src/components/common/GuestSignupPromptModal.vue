<script setup lang="ts">
/** 게스트가 게임을 한 판 마칠 때마다 뜨는 회원가입/로그인 유도 팝업 (-109). */
import PixelModal from './PixelModal.vue'
import PixelButton from './PixelButton.vue'

defineEmits<{ close: []; signup: []; login: [] }>()
</script>

<template>
  <PixelModal @close="$emit('close')">
    <div class="gp">
      <div class="icon">🎉</div>
      <h3>재밌으셨나요?</h3>
      <p>로그인하시고 다양한 사람들과<br />더 다양한 게임을 함께 즐겨보세요!</p>
      <div class="actions">
        <PixelButton block @click="$emit('signup')">회원가입</PixelButton>
        <PixelButton variant="primary" block @click="$emit('login')">로그인</PixelButton>
      </div>
      <button class="later" @click="$emit('close')">나중에 할게요</button>
    </div>
  </PixelModal>
</template>

<style scoped>
.gp { text-align: center; }
.icon { font-size: 40px; }
h3 { margin: 10px 0 8px; font-size: 16px; }
p { margin: 0 0 20px; font-size: 12px; color: var(--c-muted); line-height: 1.7; }
.actions { display: flex; gap: 9px; }
.later {
  margin-top: 12px;
  border: 0;
  background: transparent;
  color: var(--c-muted);
  font-size: 10px;
  text-decoration: underline;
}
</style>
