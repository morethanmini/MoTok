<script setup lang="ts">
/** 게스트가 게임을 한 판 마칠 때마다 뜨는 회원가입/로그인 유도 팝업 (-109). */
import PixelModal from './PixelModal.vue'
import PixelButton from './PixelButton.vue'

defineEmits<{ close: []; signup: []; login: [] }>()
/**
 * 닫기 버튼 문구. 기본은 "나중에 할게요"(팝업을 닫고 하던 화면에 그대로 남는 경우).
 * 게스트 1인 플레이 마무리처럼 닫기가 곧 다음 화면으로 넘어가는 자리에서는 "확인"을 쓴다 —
 * 화면이 바뀌는데 "나중에 할게요"라고 적혀 있으면 아무 일도 안 일어날 것처럼 읽힌다.
 */
withDefaults(defineProps<{ dismissLabel?: string }>(), { dismissLabel: '나중에 할게요' })
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
      <button class="later" @click="$emit('close')">{{ dismissLabel }}</button>
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
