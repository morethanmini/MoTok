<script setup lang="ts">
/**
 * 게임룸용 캐치캐치리듬 래퍼 — 방의 셀프 타일 안에서 돌아간다.
 *
 * 카메라·판정·렌더는 CatchRhythmStage가 다 하고, 여기서는 방과의 접점만 맡는다.
 *
 * **대전(멀티)**: 방장이 시작 → 서버가 시드를 방 전체에 배포 → 전원이 같은 채보를 만든다.
 * 서버가 준 serverNow를 t=0으로 맞추므로 전원이 같은 순간에 같은 노트를 본다.
 * **솔로 폴백**: STOMP가 안 붙었으면 로컬 시드로 혼자 돈다.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { preloadHandLandmarker } from '@/composables/useHandLandmarker'
import CatchRhythmStage from './CatchRhythmStage.vue'
import { DIFFICULTIES, type Difficulty } from './generator/presets'
import { useRhythmSession } from './useRhythmSession'
import type { Judgement } from './core/types'
import type { RhythmLiveRow } from './rhythmTypes'
import EarnedPoints from '../EarnedPoints.vue'
import type { GameMode } from './core/types'

const props = defineProps<{
  /** 게임룸 셀프 타일의 <video> — 스트림이 attach되어 재생 중이어야 한다 */
  video: HTMLVideoElement | null
  /** STOMP 방 코드 */
  roomId: string
  isHost: boolean
  /** 내 참가자 id — 순위표에서 내 행을 강조한다 */
  myUserId?: string | null
  /** useRoomChat 인스턴스(공유 연결) */
  roomChat: {
    connected: Readonly<import('vue').Ref<boolean>>
    subscribeRaw: (d: string, cb: (body: string) => void) => { unsubscribe(): void } | null
    publishRaw: (d: string, body: unknown) => boolean
  }
}>()

const emit = defineEmits<{ close: []; started: []; ended: [pointsEarned: number] }>()

/** 솔로 폴백 전용 — 대전은 서버가 라운드 길이를 정한다 */
const SOLO_ROUND_MS = 60_000

const difficulty = ref<Difficulty>('NORMAL')
const mode = ref<GameMode>('catch')
const errorMsg = ref('')
const soloSeed = ref<number | null>(null)
/** 손 인식 모델 준비 상태 — 0~1. 1이면 시작해도 첫 노트를 안 놓친다 */
const modelProgress = ref(0)
const modelReady = computed(() => modelProgress.value >= 1)
const submitted = ref(false)

const roomId = computed(() => props.roomId)
const session = useRhythmSession(props.roomChat, roomId)

const isMultiplayer = computed(() => props.roomChat.connected.value)
/** 대전은 서버 라운드, 솔로는 로컬 시드 */
const playing = computed(() => session.round.value !== null || soloSeed.value !== null)

const MODES: { id: GameMode; label: string; hint: string }[] = [
  { id: 'catch', label: '캐치', hint: '화면 곳곳의 음표를 손으로 잡아요' },
  { id: 'ring', label: '링 · 슬라이드', hint: '링에서 받아치고, 가끔 화살표 방향으로 돌려요' },
  { id: 'ringTap', label: '링 · 탭만', hint: '슬라이드 없이 빠르게 — 밀도가 훨씬 높아요' },
]

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  EASY: '쉬움',
  NORMAL: '보통',
  HARD: '어려움',
}

const stage = ref<{ canvas?: HTMLCanvasElement } | null>(null)
// 게임룸이 이 캔버스를 화면공유 트랙으로 발행한다 — 핑거 스타와 같은 계약
defineExpose({ canvas: computed(() => stage.value?.canvas ?? null) })

/** 라운드 중 상대 점수 — 나를 빼고 점수 내림차순 */
const liveRows = computed<RhythmLiveRow[]>(() =>
  Object.values(session.live.value)
    .filter((r) => r.userId !== props.myUserId)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4),
)

function start() {
  errorMsg.value = ''
  submitted.value = false
  if (isMultiplayer.value) {
    if (props.isHost && !session.start(difficulty.value, mode.value)) {
      errorMsg.value = '서버에 연결되어 있지 않아요'
    }
    return // 비방장은 RHYTHM_START를 기다린다
  }
  // 서버 미연동 — 로컬 시드로 혼자 플레이
  soloSeed.value = Math.floor(Math.random() * 2 ** 31)
}

function onProgress(score: number, combo: number) {
  if (isMultiplayer.value && session.round.value) session.sendProgress(score, combo)
}

function onFinished(r: { score: number; maxCombo: number; counts: Record<Judgement, number> }) {
  submitted.value = true
  if (!isMultiplayer.value || !session.round.value) return
  session.sendFinish({
    score: r.score,
    maxCombo: r.maxCombo,
    perfect: r.counts.perfect,
    good: r.counts.good,
    miss: r.counts.miss,
  })
}

function onError(message: string) {
  errorMsg.value = message
  soloSeed.value = null
  session.reset()
}

function backToLobby() {
  session.reset()
  soloSeed.value = null
  emit('close')
}

/**
 * 게임 카드를 여는 순간 모델(7.5MB)을 미리 받는다.
 *
 * 대전은 t=0을 서버 시각에 맞추므로, 라운드가 시작된 뒤에 모델을 받기 시작하면
 * 그 시간만큼 노트를 놓친다(로비 프리로드가 없는 2번째 창에서 실제로 발생했다).
 * 시작 버튼을 누르기 전에 끝내 두면 이 문제가 원천적으로 사라진다.
 */
onMounted(async () => {
  const ok = await preloadHandLandmarker((f) => (modelProgress.value = f))
  if (ok) modelProgress.value = 1
})

// 방장이 시작하면 다른 참가자도 자동으로 라운드에 들어간다
watch(
  () => session.round.value?.sessionId,
  (id) => {
    if (id) {
      errorMsg.value = ''
      submitted.value = false
      soloSeed.value = null
      emit('started')
    }
  },
)

// 라운드 정산(RHYTHM_END) → 부모에게 알린다. 별자리의 GAME_END와 같은 계약 —
// 부모가 전원의 게임 화면 송출을 내려서, 결과 화면을 닫지 않아도 모든 타일이 카메라로 복귀한다.
//
// 내 획득 포인트를 함께 넘긴다 — 이 게임은 전용 채널이라 부모의 GAME_END 핸들러를 타지 않아서,
// 안 넘기면 서버는 지급하는데 헤더 잔액만 그대로 남는다.
watch(
  () => session.results.value,
  (r) => {
    if (!r) return
    const mine = props.myUserId ? r.find((row) => row.userId === props.myUserId) : undefined
    emit('ended', mine?.pointsEarned ?? 0)
  },
)
</script>

<template>
  <div class="rhythm-game">
    <!-- 대전: 서버 시드·서버 t=0 / 솔로: 로컬 시드 -->
    <CatchRhythmStage
      v-if="playing"
      ref="stage"
      :key="session.round.value?.sessionId ?? soloSeed ?? 0"
      :seed="session.round.value?.seed ?? soloSeed ?? 0"
      :difficulty="session.round.value?.difficulty ?? difficulty"
      :duration-ms="session.round.value?.durationMs ?? SOLO_ROUND_MS"
      :epoch-zero-ms="session.round.value?.epochZeroMs ?? null"
      :mode="session.round.value?.mode ?? mode"
      :video="video"
      @finished="onFinished"
      @progress="onProgress"
      @error="onError"
    >
      <template #result-actions>
        <p v-if="isMultiplayer && !session.results.value" class="waiting">
          다른 참가자를 기다리는 중…
        </p>
        <div v-else-if="session.results.value" class="ranking">
          <p
            v-for="r in session.results.value"
            :key="r.userId"
            class="rank-row"
            :class="{ me: r.userId === myUserId }"
          >
            <span class="no">{{ r.rank }}</span>
            <span class="who">{{ r.nickname }}</span>
            <span class="pts">{{ r.score.toLocaleString() }}</span>
            <span v-if="!r.finished" class="dnf">미완주</span>
          </p>
        </div>
        <EarnedPoints :results="session.results.value" :my-user-id="myUserId" />
        <button type="button" class="px btn" @click="backToLobby">대기실로</button>
      </template>
    </CatchRhythmStage>

    <!-- 라운드 중 상대 점수 -->
    <div v-if="playing && liveRows.length" class="live">
      <p v-for="r in liveRows" :key="r.userId" class="live-row">
        <span class="who">{{ r.nickname }}</span>
        <span class="pts">{{ r.score.toLocaleString() }}</span>
      </p>
    </div>

    <div v-if="!playing" class="ready">
      <p class="title">캐치캐치리듬</p>
      <p class="desc">모드 · 난이도 설정</p>

      <div class="levels">
        <button
          v-for="m in MODES"
          :key="m.id"
          type="button"
          class="px level"
          :class="['mode-level', `mode-${m.id}`, { on: mode === m.id }]"
          :disabled="isMultiplayer && !isHost"
          :title="m.hint"
          @click="mode = m.id"
        >
          {{ m.label }}
        </button>
      </div>

      <div class="levels">
        <button
          v-for="d in DIFFICULTIES"
          :key="d"
          type="button"
          class="px level"
          :class="['difficulty-level', `difficulty-${d.toLowerCase()}`, { on: difficulty === d }]"
          :disabled="isMultiplayer && !isHost"
          @click="difficulty = d"
        >
          {{ DIFFICULTY_LABEL[d] }}
        </button>
      </div>

      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

      <div class="actions">
        <button
          v-if="!isMultiplayer || isHost"
          type="button"
          class="px btn primary"
          :disabled="!modelReady"
          @click="start"
        >
          {{ modelReady ? '시작' : `준비 중 ${Math.round(modelProgress * 100)}%` }}
        </button>
        <p v-else class="wait-host">
          {{
            modelReady
              ? '방장이 시작하기를 기다리는 중…'
              : `준비 중 ${Math.round(modelProgress * 100)}%`
          }}
        </p>
        <button type="button" class="px btn" @click="backToLobby">나가기</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rhythm-game {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: #fff3ea url('/assets/games/catch-rhythm/background-peach-weave.png') center / cover no-repeat;
  font-family: var(--font-pixel);
}
.ready {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.7rem;
  padding: 1rem;
  background:
    radial-gradient(circle at 16% 18%, rgba(255, 255, 255, 0.88) 0 3px, transparent 4px),
    radial-gradient(circle at 83% 78%, rgba(255, 255, 255, 0.78) 0 4px, transparent 5px),
    linear-gradient(145deg, #fff6ee, #ffe6d8);
  text-align: center;
}
.title {
  margin: 0;
  color: #5a392d;
  font-size: clamp(1.35rem, 3vw, 2rem);
  line-height: 1;
  text-shadow: 2px 2px 0 #fff;
}
.desc {
  width: min(100%, 30rem);
  margin: 0 0 0.35rem;
  color: #8a6556;
  font-size: 0.82rem;
}
.levels {
  position: relative;
  display: grid;
  width: min(100%, 31rem);
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  padding: 1.25rem 0.8rem 0.8rem;
  border: 2px solid #e7c5b3;
  border-radius: 0.9rem;
  background: rgba(255, 253, 249, 0.88);
  box-shadow: 4px 4px 0 rgba(182, 113, 82, 0.2);
}
.levels::before {
  position: absolute;
  top: 0.38rem;
  left: 0.75rem;
  color: #9a6a55;
  font-size: 0.68rem;
  letter-spacing: 0.08em;
}
.ready > .levels:first-of-type::before { content: '플레이 모드'; }
.ready > .levels:nth-of-type(2)::before { content: '난이도'; }
.ready > .levels:nth-of-type(2) {
  padding-top: 1.1rem;
}
.level {
  display: grid;
  min-height: 3.15rem;
  place-items: center;
  padding: 0.45rem 0.35rem;
  border: 2px solid #dfc4b6;
  border-radius: 0.6rem;
  background: #fffdf9;
  box-shadow: 2px 2px 0 #e6cfc1;
  color: #886659;
  cursor: pointer;
  font-size: 0.78rem;
  line-height: 1.25;
  transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
}
.level:hover:not(:disabled) {
  transform: translate(-1px, -1px);
  box-shadow: 3px 3px 0 #d6ab97;
}
.mode-level::before {
  display: block;
  margin-bottom: 0.2rem;
  font-size: 1rem;
  line-height: 1;
}
.mode-catch::before { content: '🐾'; }
.mode-ring::before { content: '↻'; color: #8f75c8; }
.mode-ringTap::before { content: '●'; color: #ef7792; }
.difficulty-easy { border-color: #b6d9c1; color: #4c8a65; }
.difficulty-normal { border-color: #e7cf82; color: #a06d20; }
.difficulty-hard { border-color: #e6a9a3; color: #b4524a; }
.difficulty-level.on {
  background: #fff0c5;
  border-color: #d69d41;
  box-shadow: 3px 3px 0 #c48734;
}
.level.on {
  transform: translate(-1px, -1px);
  border-color: #dd765d;
  background: #f59a7b;
  box-shadow: 3px 3px 0 #bd614d;
  color: #fff;
}
.level:disabled {
  opacity: 0.5;
  cursor: default;
}
.actions {
  display: flex;
  align-items: center;
  justify-content: center;
  width: min(100%, 31rem);
  gap: 0.55rem;
  margin-top: 0.45rem;
}
.btn {
  min-width: 6.8rem;
  padding: 0.68rem 1rem;
  border: 2px solid #d4b49f;
  border-radius: 0.55rem;
  background: #fffdf9;
  box-shadow: 3px 3px 0 #dec3b3;
  color: #725044;
  cursor: pointer;
  font-size: 0.85rem;
}
.btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.btn.primary {
  border-color: #c95d4b;
  background: #ed8065;
  box-shadow: 3px 3px 0 #a94b3c;
  color: #fff;
}
.btn.primary:hover:not(:disabled) { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 #a94b3c; }

/* Compact, calm setup controls: choices are the focus, not their decoration. */
.ready {
  gap: 0.8rem;
  background:
    linear-gradient(rgba(255, 247, 241, 0.78), rgba(255, 233, 221, 0.78)),
    url('/assets/games/catch-rhythm/background-peach-weave.png') center / cover no-repeat;
}
.title {
  color: #4b3429;
  font-size: clamp(1.2rem, 2.5vw, 1.65rem);
  text-shadow: none;
}
.desc {
  margin-bottom: 0.1rem;
  color: #947568;
  font-size: 0.72rem;
}
.levels {
  width: min(100%, 29rem);
  gap: 0;
  padding: 1.22rem 0.5rem 0.5rem;
  border: 1px solid #ead5c8;
  border-radius: 0.55rem;
  background: #fffdfa;
  box-shadow: none;
}
.levels::before {
  content: none;
  display: none;
}
.ready > .levels,
.ready > .levels:nth-of-type(2) { padding-top: 0.5rem; }
.title { font-size: clamp(2rem, 4.5vw, 3rem); }
.desc { font-size: 0.9rem; }
.level {
  min-height: 3.05rem;
  padding: 0.45rem 0.3rem;
  border: 0;
  border-right: 1px solid #ecdcd2;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: #8b6e62;
  font-size: 0.92rem;
  transition: background 0.12s ease, color 0.12s ease;
}
.level:last-child { border-right: 0; }
.level:hover:not(:disabled) {
  transform: none;
  box-shadow: none;
  background: #fff2ea;
}
.mode-level::before { display: none; }
.difficulty-easy, .difficulty-normal, .difficulty-hard { border-color: #ecdcd2; color: #8b6e62; }
.difficulty-level.on, .level.on {
  transform: none;
  border-color: transparent;
  border-radius: 0.35rem;
  background: #e9856a;
  box-shadow: none;
  color: #fff;
}
.actions {
  width: min(100%, 29rem);
  flex-direction: row;
  margin-top: 0.15rem;
  gap: 0.45rem;
}
.btn {
  min-width: 7.4rem;
  padding: 0.75rem 1rem;
  border: 1px solid #ddc8bc;
  border-radius: 0.45rem;
  background: #fffdfa;
  box-shadow: none;
  color: #806155;
  font-size: 0.95rem;
}
.actions .btn.primary {
  order: 2;
  flex: 1;
  width: auto;
}
.actions .btn:not(.primary) {
  order: 1;
  flex: 1;
  min-width: 0;
}
.wait-host { order: 1; }
.btn.primary {
  border-color: #d9725b;
  background: #df795f;
  box-shadow: none;
}
.btn.primary:hover:not(:disabled) {
  transform: none;
  background: #cf684f;
  box-shadow: none;
}
.error {
  font-size: 0.8rem;
  color: #b3402a;
}
.wait-host {
  font-size: 0.8rem;
  color: #9b8f88;
}
.waiting {
  font-size: 0.85rem;
  color: #7a6a60;
}
.live {
  position: absolute;
  /* Stage HUD(점수·남은시간)가 상단 줄을 쓰므로 그 아래로 — 겹치면 남은시간이 가려진다 */
  top: 3.2rem;
  right: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.3rem 0.5rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.72);
  pointer-events: none;
}
.live-row {
  display: flex;
  gap: 0.5rem;
  font-size: 0.72rem;
  color: #5c4a3f;
}
.live-row .who {
  max-width: 5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.live-row .pts {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.ranking {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  width: min(100%, 20rem);
  margin: 0.35rem 0;
}
.rank-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  padding: 0.48rem 0.55rem;
  border: 1px solid #ead6ca;
  border-radius: 0.4rem;
  background: #fff9f3;
  font-size: 0.78rem;
  color: #5c4a3f;
}
.rank-row.me {
  border-color: #e29a7e;
  background: #fff0e7;
  font-weight: 400;
  color: #e07a4f;
}
.rank-row .no {
  display: grid;
  width: 1.35rem;
  height: 1.35rem;
  flex: none;
  place-items: center;
  border-radius: 50%;
  background: #f1dfd1;
  color: #805b4a;
  font-size: 0.68rem;
}
.rank-row .pts {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.rank-row .dnf {
  font-size: 0.72rem;
  color: #9b8f88;
}
</style>
