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
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { preloadHandLandmarker } from '@/composables/useHandLandmarker'
import CatchRhythmStage from './CatchRhythmStage.vue'
import { DIFFICULTIES, type Difficulty } from './generator/presets'
import { loadBundledChart, type LoadedBundle } from './generator/bundledCharts'
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
/** 곡 선택(-168): 기존 랜덤(시드) 채보 vs SSAFY 응원가(수제 번들) */
const songPick = ref<'random' | 'ssafy'>('random')
/** 응원가 전용 난이도 — 어려움 풀/하프(MANUAL 채보) / 익스트림(하프) */
const songDifficulty = ref<'manual' | 'manual-half' | 'extreme'>('manual')
const SONG_BUNDLE: Record<typeof songDifficulty.value, string> = {
  manual: 'ssafy-fighting-manual',
  'manual-half': 'ssafy-fighting-manual-verse1',
  extreme: 'ssafy-fighting-extreme',
}
/** 시작·로드에 쓰는 번들 id. null = 랜덤 채보 */
const selectedSong = computed(() =>
  songPick.value === 'ssafy' ? SONG_BUNDLE[songDifficulty.value] : null,
)
/** 이번 라운드에 쓸 번들 — 곡 라운드는 이게 로드돼야 스테이지를 연다 */
const activeBundle = shallowRef<LoadedBundle | null>(null)
const errorMsg = ref('')
const soloSeed = ref<number | null>(null)
/** 손 인식 모델 준비 상태 — 0~1. 1이면 시작해도 첫 노트를 안 놓친다 */
const modelProgress = ref(0)
const modelReady = computed(() => modelProgress.value >= 1)
const submitted = ref(false)

const roomId = computed(() => props.roomId)
const session = useRhythmSession(props.roomChat, roomId)

const isMultiplayer = computed(() => props.roomChat.connected.value)
/** 대전은 서버 라운드, 솔로는 로컬 시드. 곡 라운드는 번들이 로드돼야 화면을 연다 */
const playing = computed(() => {
  const round = session.round.value
  if (round) return !round.song || activeBundle.value !== null
  if (soloSeed.value === null) return false
  return !selectedSong.value || activeBundle.value !== null
})

/** 곡 라운드의 스테이지 주입 채보 — 시드 라운드면 null(기존 경로) */
const stageChart = computed(() => {
  const b = activeBundle.value
  if (!b) return null
  const round = session.round.value
  if (round && !round.song) return null
  if (!round && !selectedSong.value) return null
  const m = round?.mode ?? mode.value
  return m === 'catch' ? b.catch : b.ring
})
const stageSong = computed(() => (stageChart.value && activeBundle.value ? activeBundle.value.song : null))

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

/** 정산 대기 문구(-187) — 서버가 누구의 재접속을 기다리는지 그대로 보여 준다 */
const waitingText = computed(() => {
  const w = session.waiting.value
  if (!w || w.nicknames.length === 0) return '다른 참가자를 기다리는 중…'
  const names = w.nicknames.slice(0, 2).join(', ')
  const more = w.nicknames.length > 2 ? ` 외 ${w.nicknames.length - 2}명` : ''
  return `${names}${more} 님의 연결이 잠시 불안정해요 — 최대 10초만 더 기다릴게요`
})

async function start() {
  errorMsg.value = ''
  submitted.value = false
  const chosen = selectedSong.value
  if (isMultiplayer.value) {
    if (!props.isHost) return // 비방장은 RHYTHM_START를 기다린다
    if (!chosen) {
      if (!session.start(difficulty.value, mode.value)) {
        errorMsg.value = '서버에 연결되어 있지 않아요'
      }
      return
    }
    // 곡 라운드(-168): 번들을 먼저 읽어 곡 길이를 서버에 알려야 endAt이 곡에 맞는다
    try {
      const bundle = await loadBundledChart(chosen)
      const durationSec = Math.ceil((bundle.durationMs + 2000) / 1000)
      if (!session.start(bundle.difficulty, mode.value, { id: chosen, durationSec })) {
        errorMsg.value = '서버에 연결되어 있지 않아요'
      }
    } catch (err) {
      errorMsg.value = (err as Error).message
    }
    return
  }
  // 서버 미연동 — 로컬 플레이 (곡을 골랐으면 번들 채보, 아니면 로컬 시드)
  if (chosen) {
    try {
      activeBundle.value = await loadBundledChart(chosen)
    } catch (err) {
      errorMsg.value = (err as Error).message
      return
    }
  }
  soloSeed.value = Math.floor(Math.random() * 2 ** 31)
  // 솔로는 서버 라운드가 없어 위 감시자를 타지 않는다 — 여기서 직접 알려야 로비 테마가 내려간다
  emit('started')
}

function onProgress(score: number, combo: number) {
  if (isMultiplayer.value && session.round.value) session.sendProgress(score, combo)
}

function onFinished(r: { score: number; maxCombo: number; counts: Record<Judgement, number> }) {
  submitted.value = true
  if (!isMultiplayer.value || !session.round.value) {
    // 솔로는 서버 정산(RHYTHM_END)이 없어 ended가 영영 안 나간다 — started만 넣으면 로비 테마가
    // 게임을 닫을 때까지 안 돌아온다. 지급 포인트는 0이다(서버를 안 거치므로 적립도 없다).
    emit('ended', 0)
    return
  }
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

/**
 * 방장이 시작하면 다른 참가자도 자동으로 라운드에 들어간다.
 *
 * <p><b>immediate가 필요하다.</b> 비방장은 시작 신호를 받은 <b>뒤에</b> 이 화면이 열리는데
 * (useRhythmAutoJoin), 놓친 RHYTHM_START는 모듈 버퍼에 맡겨져 useRhythmSession()이
 * 만들어지는 순간 <b>동기적으로</b> 꺼내 쓰인다. 즉 화면이 열릴 때 round는 이미 채워져 있고,
 * 이 감시자는 그보다 아래에서 등록되므로 immediate 없이는 그 전이를 영영 못 본다.</p>
 *
 * <p>그때 started가 안 나가서 <b>비방장은 게임 내내 로비 테마가 겹쳐 들렸다</b> — 이 게임은
 * started~ended 사이에만 오디오를 소유하기 때문이다(GameRoomView의 AUDIO_OWNING_GAMES 주석).
 * 방장은 화면을 먼저 열고 시작을 눌러 null→id 전이가 등록 뒤에 생기므로 멀쩡했다.</p>
 */
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
  { immediate: true },
)

// 곡 라운드면 전원이 같은 번들(정적 자산)을 읽는다 — 로드 전까지 스테이지는 열리지 않고,
// 자산이 없는 클라이언트는 라운드를 접는다(방장이 자산 없는 곡을 고른 배포 사고 대비).
watch(
  () => session.round.value?.song ?? null,
  async (songId) => {
    if (!songId) return
    try {
      activeBundle.value = await loadBundledChart(songId)
    } catch {
      errorMsg.value = '곡 채보 자산을 불러올 수 없어요'
      session.reset()
    }
  },
  { immediate: true },
)

// 곡을 고르면 탭 전용 링(ringTap)은 지원하지 않는다 — 번들에는 catch·ring 두 벌뿐
watch(selectedSong, (chosen) => {
  if (chosen && mode.value === 'ringTap') mode.value = 'ring'
})

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
    <!--
      상시 종료 — 시작 화면과 결과 화면에는 자체 나가기 버튼이 있다.
      별자리·낚시와 같게 close만 쏜다. backToLobby 는 session.reset() 이 먼저라
      호출부가 확인 모달을 띄우기도 전에 판이 사라진다("계속 하기"가 무의미해진다).
    -->
    <button
      v-if="playing && !submitted"
      type="button"
      class="close"
      title="게임 종료"
      @click="emit('close')"
    >
      ✕
    </button>

    <!-- 대전: 서버 시드·서버 t=0 / 솔로: 로컬 시드 / 곡 라운드: 번들 채보+곡 주입 -->
    <CatchRhythmStage
      v-if="playing"
      ref="stage"
      :key="session.round.value?.sessionId ?? soloSeed ?? 0"
      :seed="session.round.value?.seed ?? soloSeed ?? 0"
      :difficulty="session.round.value?.difficulty ?? difficulty"
      :duration-ms="
        session.round.value?.durationMs ??
        (stageChart ? stageChart.durationMs + 2000 : SOLO_ROUND_MS)
      "
      :epoch-zero-ms="session.round.value?.epochZeroMs ?? null"
      :mode="session.round.value?.mode ?? mode"
      :chart="stageChart"
      :song="stageSong"
      :video="video"
      @finished="onFinished"
      @progress="onProgress"
      @error="onError"
    >
      <template #result-actions>
        <!-- 정산 대기(-187): 스피너로 "멈춘 게 아님"을 보인다. 형식은 기존 waiting 문단 그대로 -->
        <p v-if="isMultiplayer && !session.results.value" class="waiting">
          <span class="spinner" aria-hidden="true"></span>
          {{ waitingText }}
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
      <p class="desc">곡 · 모드 · 난이도 설정</p>

      <div class="levels row-song">
        <button
          type="button"
          class="px level"
          :class="{ on: songPick === 'random' }"
          :disabled="isMultiplayer && !isHost"
          title="분석 기반 랜덤 채보 — 매판 다르게"
          @click="songPick = 'random'"
        >
          랜덤 채보
        </button>
        <button
          type="button"
          class="px level"
          :class="{ on: songPick === 'ssafy' }"
          :disabled="isMultiplayer && !isHost"
          title="SSAFY 응원가 수제 채보"
          @click="songPick = 'ssafy'"
        >
          SSAFY 응원가
        </button>
      </div>

      <div class="levels row-mode">
        <button
          v-for="m in MODES"
          :key="m.id"
          v-show="!selectedSong || m.id !== 'ringTap'"
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

      <div v-if="songPick === 'random'" class="levels row-diff">
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
      <!-- 응원가 전용 난이도 — 어려움 풀/하프(수제 MANUAL) / 익스트림(하프) -->
      <div v-else class="levels row-diff">
        <button
          type="button"
          class="px level difficulty-level difficulty-hard"
          :class="{ on: songDifficulty === 'manual' }"
          :disabled="isMultiplayer && !isHost"
          @click="songDifficulty = 'manual'"
        >
          어려움(풀)
        </button>
        <button
          type="button"
          class="px level difficulty-level difficulty-hard"
          :class="{ on: songDifficulty === 'manual-half' }"
          :disabled="isMultiplayer && !isHost"
          @click="songDifficulty = 'manual-half'"
        >
          어려움(하프)
        </button>
        <button
          type="button"
          class="px level difficulty-level difficulty-extreme"
          :class="{ on: songDifficulty === 'extreme' }"
          :disabled="isMultiplayer && !isHost"
          @click="songDifficulty = 'extreme'"
        >
          익스트림(하프)
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
/* 상시 종료. Stage HUD 가 상단 전폭을 쓰므로 :deep 으로 오른쪽을 비워 자리를 낸다 */
.close {
  position: absolute;
  z-index: 4;
  top: 0.6rem;
  right: 0.6rem;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 2px solid #5a392d;
  border-radius: 6px;
  background: rgba(255, 246, 238, 0.85);
  color: #5a392d;
  font-family: inherit;
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
}
.rhythm-game :deep(.hud) {
  right: 3.1rem;
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
  /* 버튼 개수만큼 균등 분할 — 3열 고정 그리드는 2개짜리 줄(곡·응원가 난이도)에 빈칸을 남긴다 */
  display: flex;
  width: min(100%, 31rem);
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
.row-song::before { content: '곡'; }
.row-mode::before { content: '플레이 모드'; }
.row-diff::before { content: '난이도'; }
.level {
  flex: 1 1 0;
  min-width: 0;
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
.difficulty-extreme { border-color: #c9a3e6; color: #7b4ab4; }
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
.ready > .levels { padding-top: 0.5rem; }
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
.difficulty-easy, .difficulty-normal, .difficulty-hard, .difficulty-extreme { border-color: #ecdcd2; color: #8b6e62; }
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
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  font-size: 0.85rem;
  color: #7a6a60;
}
/* 정산 대기 중임을 보여 주는 회전자 — 화면이 멈춘 게 아니라 기다리는 중이다 */
.waiting .spinner {
  width: 0.85rem;
  height: 0.85rem;
  flex: none;
  border: 2px solid #e6d5c9;
  border-top-color: #a97c66;
  border-radius: 50%;
  animation: rhythm-wait-spin 0.8s linear infinite;
}
@keyframes rhythm-wait-spin {
  to { transform: rotate(360deg); }
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
