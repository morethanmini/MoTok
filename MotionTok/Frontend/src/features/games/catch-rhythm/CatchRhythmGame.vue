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
import { computed, ref, watch } from 'vue'
import CatchRhythmStage from './CatchRhythmStage.vue'
import { DIFFICULTIES, type Difficulty } from './generator/presets'
import { useRhythmSession } from './useRhythmSession'
import type { Judgement } from './core/types'
import type { RhythmLiveRow } from './rhythmTypes'
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

const emit = defineEmits<{ close: [] }>()

/** 솔로 폴백 전용 — 대전은 서버가 라운드 길이를 정한다 */
const SOLO_ROUND_MS = 60_000

const difficulty = ref<Difficulty>('NORMAL')
const mode = ref<GameMode>('catch')
const errorMsg = ref('')
const soloSeed = ref<number | null>(null)
const submitted = ref(false)

const roomId = computed(() => props.roomId)
const session = useRhythmSession(props.roomChat, roomId)

const isMultiplayer = computed(() => props.roomChat.connected.value)
/** 대전은 서버 라운드, 솔로는 로컬 시드 */
const playing = computed(() => session.round.value !== null || soloSeed.value !== null)

const MODES: { id: GameMode; label: string; hint: string }[] = [
  { id: 'catch', label: '캐치', hint: '화면 곳곳의 음표를 손으로 잡아요' },
  { id: 'ring', label: '마이마이', hint: '가장자리 링에서 받아쳐요' },
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

// 방장이 시작하면 다른 참가자도 자동으로 라운드에 들어간다
watch(
  () => session.round.value?.sessionId,
  (id) => {
    if (id) {
      errorMsg.value = ''
      submitted.value = false
      soloSeed.value = null
    }
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
      <p class="desc">{{ MODES.find((m) => m.id === mode)?.hint }}</p>

      <div class="levels">
        <button
          v-for="m in MODES"
          :key="m.id"
          type="button"
          class="px level"
          :class="{ on: mode === m.id }"
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
          :class="{ on: difficulty === d }"
          :disabled="isMultiplayer && !isHost"
          @click="difficulty = d"
        >
          {{ DIFFICULTY_LABEL[d] }}
        </button>
      </div>

      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

      <div class="actions">
        <button v-if="!isMultiplayer || isHost" type="button" class="px btn primary" @click="start">
          시작
        </button>
        <p v-else class="wait-host">방장이 시작하기를 기다리는 중…</p>
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
.level:disabled {
  opacity: 0.5;
  cursor: default;
}
.actions {
  display: flex;
  align-items: center;
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
  top: 0.6rem;
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
  gap: 0.15rem;
  width: min(20rem, 90%);
}
.rank-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #5c4a3f;
}
.rank-row.me {
  font-weight: 700;
  color: #e07a4f;
}
.rank-row .no {
  width: 1.2rem;
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
