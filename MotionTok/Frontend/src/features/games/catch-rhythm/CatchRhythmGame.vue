<script setup lang="ts">
/**
 * 게임룸용 캐치캐치리듬 래퍼 — 방의 셀프 타일 안에서 돌아간다.
 *
 * 카메라·판정·렌더는 CatchRhythmStage가 다 하고, 여기서는 방과의 접점만 맡는다:
 * 난이도 선택 → 시드 결정 → 스테이지 마운트 → 결과 후 대기실 복귀.
 *
 * M4(현재)는 로컬 시드 솔로. 대전(M6)에서는 전용 STOMP 채널로 받은 서버 시드를
 * session prop으로 받아 그대로 넘기면 된다 — 스테이지는 손댈 필요가 없다.
 */
import { computed, ref } from 'vue'
import CatchRhythmStage from './CatchRhythmStage.vue'
import { DIFFICULTIES, type Difficulty } from './generator/presets'
import type { Judgement } from './core/types'

defineProps<{
  /** 게임룸 셀프 타일의 <video> — 스트림이 attach되어 재생 중이어야 한다 */
  video: HTMLVideoElement | null
}>()

const emit = defineEmits<{
  close: []
  /** 라운드 중 진행 상황(1초 스로틀) — 대전에서 LIVE SCORE로 중계된다 */
  progress: [score: number, combo: number]
  finished: [payload: { score: number; maxCombo: number; counts: Record<Judgement, number> }]
}>()

const ROUND_MS = 90_000

type Phase = 'ready' | 'playing'
const phase = ref<Phase>('ready')
const difficulty = ref<Difficulty>('NORMAL')
const seed = ref<number>(0)
const errorMsg = ref('')

const stage = ref<{ canvas?: HTMLCanvasElement } | null>(null)
// 게임룸이 이 캔버스를 화면공유 트랙으로 발행한다 — 이름·모양을 핑거 스타와 맞춘다
defineExpose({ canvas: computed(() => stage.value?.canvas ?? null) })

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  EASY: '쉬움',
  NORMAL: '보통',
  HARD: '어려움',
}

function start() {
  errorMsg.value = ''
  // M4는 로컬 시드. 대전에서는 서버가 방 전원에게 같은 시드를 내려준다.
  seed.value = Math.floor(Math.random() * 2 ** 31)
  phase.value = 'playing'
}

function onFinished(payload: {
  score: number
  maxCombo: number
  counts: Record<Judgement, number>
}) {
  emit('finished', payload)
}

function onError(message: string) {
  errorMsg.value = message
  phase.value = 'ready'
}
</script>

<template>
  <div class="rhythm-game">
    <CatchRhythmStage
      v-if="phase === 'playing'"
      ref="stage"
      :key="seed"
      :seed="seed"
      :difficulty="difficulty"
      :duration-ms="ROUND_MS"
      :video="video"
      @finished="onFinished"
      @progress="(s, c) => emit('progress', s, c)"
      @error="onError"
    >
      <template #result-actions>
        <button type="button" class="px btn" @click="emit('close')">대기실로</button>
      </template>
    </CatchRhythmStage>

    <div v-else class="ready">
      <p class="title">캐치캐치리듬</p>
      <p class="desc">날아오는 음표를 <b>주먹으로 잡아요</b></p>

      <div class="levels">
        <button
          v-for="d in DIFFICULTIES"
          :key="d"
          type="button"
          class="px level"
          :class="{ on: difficulty === d }"
          @click="difficulty = d"
        >
          {{ DIFFICULTY_LABEL[d] }}
        </button>
      </div>

      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

      <div class="actions">
        <button type="button" class="px btn primary" @click="start">시작</button>
        <button type="button" class="px btn" @click="emit('close')">나가기</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rhythm-game {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: #fff3ea;
}
.ready {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  padding: 0.75rem;
  text-align: center;
}
.title {
  font-size: 1.1rem;
  font-weight: 700;
  color: #5c4a3f;
}
.desc {
  font-size: 0.85rem;
  color: #7a6a60;
}
.levels {
  display: flex;
  gap: 0.35rem;
}
.level {
  padding: 0.3rem 0.7rem;
  border: 1px solid #d9cec6;
  background: #fff;
  color: #7a6a60;
  cursor: pointer;
  font-size: 0.8rem;
}
.level.on {
  background: #e07a4f;
  border-color: #e07a4f;
  color: #fff;
}
.actions {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.2rem;
}
.btn {
  padding: 0.35rem 0.9rem;
  border: 1px solid #d9cec6;
  background: #fff;
  color: #5c4a3f;
  cursor: pointer;
  font-size: 0.85rem;
}
.btn.primary {
  background: #e07a4f;
  border-color: #e07a4f;
  color: #fff;
}
.error {
  font-size: 0.8rem;
  color: #b3402a;
}
</style>
