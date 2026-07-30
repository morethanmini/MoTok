<script setup lang="ts">
/**
 * 결과 화면의 획득 포인트 한 줄 — 세 게임이 같은 모양으로 쓴다.
 *
 * <p>값은 서버가 `GAME_END`에 실어 보낸 `pointsEarned`다(순위·점수 기반, `PointCalculator`).
 * 지갑 반영도 서버가 하고 헤더 잔액은 `GameRoomView`가 즉시 얹으므로, 여기는 표시만 한다.</p>
 *
 * <p>0점이거나 내 항목이 없으면(게스트·미제출) 아무것도 그리지 않는다 — "＋0 P"를 보여 주면
 * 보상이 있는데 못 받은 것처럼 읽힌다.</p>
 */
import { computed } from 'vue'

/**
 * 캐치캐치리듬은 전용 채널(RHYTHM_END)이라 결과 타입이 다르다. 필요한 두 필드만 요구해
 * `GameResultEntry`·`RhythmResultEntry` 양쪽을 그대로 받는다.
 */
interface EarnedRow {
  userId: string
  pointsEarned: number
}

const props = defineProps<{
  results?: readonly EarnedRow[] | null
  myUserId?: string | null
}>()

const earned = computed(() => {
  if (!props.results || !props.myUserId) return 0
  return props.results.find((r) => r.userId === props.myUserId)?.pointsEarned ?? 0
})
</script>

<template>
  <p v-if="earned > 0" class="earned">
    획득 포인트 <b>＋{{ earned.toLocaleString() }} P</b>
    <span>꾸미기 아이템에 쓸 수 있어요</span>
  </p>
</template>

<style scoped>
.earned {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 4px 8px;
  margin: 12px 0 0;
  padding: 9px 14px;
  border: 2px solid #dcb37d;
  border-radius: 9px;
  background: #fff6df;
  color: #7a5c40;
  font-size: 11px;
  font-weight: 700;
}
.earned b { color: #d79600; font-size: 16px; }
.earned span { color: #9b8471; font-size: 9px; font-weight: 400; }
</style>
