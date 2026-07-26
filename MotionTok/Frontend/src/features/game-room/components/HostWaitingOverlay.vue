<script setup lang="ts">
/**
 * 방장이 아직 게임방에 들어오지 않았을 때 참가자에게 띄우는 대기 오버레이.
 *
 * 왜 필요한가 — 방을 만든 사람은 곧바로 게임방에 오지 않는다. 기기 점검 화면(카메라·마이크 확인)을
 * 먼저 거치므로 그 사이 친구가 먼저 입장할 수 있다. 그때 참가자에게는 게임을 시작할 권한이 없는데
 * 화면은 다 그려져 있어서 "왜 아무 일도 안 일어나지?"가 된다.
 *
 * 닫기 버튼은 두지 않는다 — 방장이 들어오면 스스로 사라져야 하고, 그때까지 할 수 있는 게 없다.
 * 대신 방장이 아예 안 올 수도 있으니 로비로 나가는 길은 반드시 열어 둔다.
 */
import PixelButton from '@/components/common/PixelButton.vue'

defineProps<{
  /** 방 제목 — 어떤 방에서 기다리는지 알려 준다 */
  roomTitle: string | null
  /** 방장 표시명 */
  hostName: string | null
}>()
defineEmits<{ leave: [] }>()
</script>

<template>
  <div class="wait">
    <div class="wait-bg" />
    <div class="wait-panel">
      <div class="dots"><i /><i /><i /></div>
      <b class="wait-title">
        {{ hostName ? `${hostName}님이` : '호스트가' }} 입장하고 있습니다
      </b>
      <small v-if="roomTitle">‘{{ roomTitle }}’</small>
      <p class="wait-desc">
        방장이 기기 점검을 마치면 자동으로 시작할 수 있어요.<br />
        조금만 기다려 주세요!
      </p>
      <PixelButton variant="primary" @click="$emit('leave')">로비로 나가기</PixelButton>
    </div>
  </div>
</template>

<style scoped>
.wait {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
}
.wait-bg {
  position: absolute;
  inset: 0;
  background: rgba(38, 26, 40, 0.62);
  backdrop-filter: blur(3px);
}
.wait-panel {
  position: relative;
  width: min(92vw, 380px);
  padding: 26px 24px 22px;
  border: 3px solid var(--c-ink);
  border-radius: 18px;
  background: var(--c-paper);
  box-shadow: var(--shadow-lg);
  text-align: center;
}
.wait-title {
  display: block;
  font-size: 14px;
  line-height: 1.5;
}
.wait-panel small {
  display: block;
  margin-top: 6px;
  font-size: 10px;
  color: var(--c-muted);
}
.wait-desc {
  margin: 14px 0 18px;
  font-size: 10px;
  line-height: 1.8;
  color: var(--c-muted);
}
/* 로딩 점 3개 — 진행률을 알 수 없는 대기라 스피너 대신 가벼운 신호만 준다 */
.dots {
  display: flex;
  justify-content: center;
  gap: 7px;
  margin-bottom: 16px;
}
.dots i {
  width: 10px;
  height: 10px;
  border: 2px solid var(--c-ink);
  border-radius: 50%;
  background: var(--c-yellow);
  animation: wait-bounce 1s infinite ease-in-out;
}
.dots i:nth-child(2) { animation-delay: 0.15s; }
.dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes wait-bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-7px); }
}
@media (prefers-reduced-motion: reduce) {
  .dots i { animation: none; }
}
</style>
