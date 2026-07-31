<script setup lang="ts">
/**
 * 캐치캐치리듬 플레이 스테이지 — 카메라·판정·렌더·점수를 자기 안에서 완결한다.
 *
 * 방(멀티)이든 개발 페이지(솔로)든 이 컴포넌트를 감싸기만 하면 된다.
 * seed/difficulty/durationMs를 주면 채보를 만들어 돌리고, 끝나면 finished를 emit한다.
 * 서버·STOMP·방 상태를 전혀 모른다 — 그건 감싸는 쪽 책임.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useHandLandmarker } from '@/composables/useHandLandmarker'
import { GameClock } from './core/clock'
import { ScoreTracker } from './core/score'
import { COUNTDOWN_SECONDS } from './core/config'
import { CatchLogic, type Hands, type CatchEvent, type TrackedNote } from './logic/catchLogic'
import { generateBattleChart } from './generator/battleChart'
import { LEAD_IN_MS, slotTimeMs, type Difficulty } from './generator/presets'
import { HandInputTracker } from './input/handInput'
import { Renderer, type RenderHand } from './render/renderer'
import { resolveSkin } from './render/skins'
import { SfxPlayer } from './audio/sfx'
import type { Judgement } from './core/types'
import {
  RingLogic,
  holdBearingDeg,
  laneAngleDeg,
  type RingBeatmap,
  type RingEvent,
  type TrackedRingNote,
} from './ring/ringLogic'
import type { Beatmap } from './core/beatmap'
import { generateRingChart } from './ring/ringChart'
import { RingRenderer } from './ring/ringRenderer'
import { RING_RADIUS } from './ring/ringConfig'
import type { GameMode } from './core/types'
import { RhythmMusic } from './audio/music'

/**
 * 인게임 곡 — 이 게임에서는 배경음이 아니라 **채보의 박자 기준**이다
 * (곡 실측 129 BPM이 presets.ts의 CHART_BPM). 그래서 다른 게임처럼 GameBgm으로 틀지 않고
 * 판정 시계와 같은 AudioContext에 예약한다({@link RhythmMusic} 주석 참고).
 */
const BGM_SRC = '/assets/sfx/catch-rhythm/Neon_Pulse.mp3'
/** "시작!"을 띄워두는 시간 — 첫 노트가 오기 전에 사라져야 해서 1초보다 짧게 */
const START_FLASH_MS = 900
/**
 * 곡의 첫 박이 얹히는 노트 슬롯.
 *
 * <p>1 = 카운트다운이 끝난 뒤 한 칸(232.56ms) 뒤. "시작!" 직후 숨 한 번 두고 곡이 들어오는
 * 체감이면서, 곡의 박자 격자가 노트 격자와 같은 순간에 시작한다. 템포도 129로 같으므로
 * 그 뒤 한 판 내내 어긋나지 않는다.</p>
 *
 * <p>머리 무음·인코더 지연은 {@link RhythmMusic}이 디코드된 버퍼에서 실측해 건너뛴다 —
 * 여기서 ms를 역산하던 상수(BGM_HEAD_SILENCE_MS)는 디코더 구현에 따라 어긋나서 없앴다.
 * 이 값은 {@code songAccents.ts}의 SONG_START_SLOT과 반드시 같아야 한다.</p>
 */
const SONG_START_SLOT = 1
/**
 * 슬롯 정렬에서 곡만 이만큼 늦게 건다 — 실플레이에서 노트가 약간 느리게 느껴졌다.
 *
 * <p>격자 정렬(0.5ms)은 계산상 맞지만 체감은 화면 지연(rAF·컴포지터·디스플레이)이 얹혀서
 * 노트 쪽이 뒤에 있다. 곡을 그만큼 늦추면 귀와 눈이 같은 순간을 가리킨다.</p>
 *
 * <p><b>대가</b>: {@code songAccents.ts}의 표는 곡이 정확히 정렬된 상태에서 뽑은 것이라,
 * 이 값만큼(232.56ms 슬롯의 0.43칸) 슬롯↔소리 짝이 밀린다. 지도를 이 오프셋으로 다시 뽑아
 * 봤지만 샘플 지점이 온셋에서 벗어나 분포가 무너졌다(중앙값 0.96→0.39, 최대 3.3→12.1) —
 * 노트를 소리 위에 놓는 효과는 정렬된 지도를 쓰는 쪽이 낫다. 체감 보정과 배치 근거를
 * 분리해 둔 것이고, 이 값을 크게 키우면 그 전제가 깨진다.</p>
 */
const SONG_NUDGE_MS = 100

const props = withDefaults(
  defineProps<{
    seed: number | string
    difficulty: Difficulty
    durationMs?: number
    skinId?: string
    /**
     * 분석에 쓸 <video>. 게임룸이면 셀프 타일 비디오를 그대로 넘긴다(카메라를 또 열지 않는다).
     * 없으면 개발 페이지처럼 자체적으로 getUserMedia 한다.
     */
    video?: HTMLVideoElement | null
    /**
     * 게임 시각 t=0에 해당하는 **로컬** 타임스탬프.
     * 대전에서는 서버가 준 시각(clockOffset 보정 후)을 넣어 전원의 t=0을 맞춘다.
     * 없으면 마운트 시점이 t=0 — 솔로는 이걸로 충분하다.
     */
    epochZeroMs?: number | null
    /** 'catch' = 자유 좌표 잡기, 'ring' = 마이마이 레인 */
    mode?: GameMode
    /**
     * 외부에서 만든 채보(채보 랩의 곡 분석 초안). 있으면 시드 생성 대신 이걸 쓴다 —
     * mode와 맞는 스키마여야 한다(catch=Beatmap, ring=RingBeatmap).
     */
    chart?: Beatmap | RingBeatmap | null
    /**
     * 커스텀 곡. src는 objectURL도 된다. gridOriginMs = 파일 안 박자 격자 원점(분석 실측),
     * startMs = 그 원점이 놓일 게임 시각(채보의 offsetMs와 같아야 노트와 소리가 맞는다).
     */
    song?: { src: string; gridOriginMs: number; startMs: number } | null
  }>(),
  {
    durationMs: 90_000,
    skinId: 'cat-candy',
    video: null,
    epochZeroMs: null,
    mode: 'catch',
    chart: null,
    song: null,
  },
)

const emit = defineEmits<{
  finished: [result: { score: number; maxCombo: number; counts: Record<Judgement, number> }]
  progress: [score: number, combo: number]
  error: [message: string]
}>()

type Phase = 'loading' | 'countdown' | 'playing' | 'result'

const phase = ref<Phase>('loading')
const loadingText = ref('카메라와 손 인식을 준비하고 있어요…')
const canvasEl = ref<HTMLCanvasElement | null>(null)
const videoEl = ref<HTMLVideoElement | null>(null)

const score = ref(0)
const combo = ref(0)
const maxCombo = ref(0)
const counts = ref<Record<Judgement, number>>({ perfect: 0, good: 0, miss: 0 })
const countdown = ref(COUNTDOWN_SECONDS)
/** 카운트다운이 끝난 직후 잠깐 띄우는 "시작!" — 곡이 걸리는 순간과 같다 */
const startFlash = ref(false)
const handsSeen = ref(false)
const remainingSec = ref(0)
/** 로딩이 늦어 놓친 노트 수 — 0보다 크면 안내를 띄운다 */
const lateStart = ref(0)

const landmarker = useHandLandmarker()
const isRing = props.mode === 'ring' || props.mode === 'ringTap'
const chart = shallowRef(
  props.chart ??
    (isRing
      ? generateRingChart(props.seed, props.difficulty, props.durationMs, props.mode === 'ring')
      : generateBattleChart(props.seed, props.difficulty, props.durationMs)),
)

let flashTimer = 0
/** 곡 — audioCtx가 생긴 뒤(boot)에야 만들 수 있다 */
let music: RhythmMusic | null = null
let audioCtx: AudioContext | null = null
let clock: GameClock | null = null
let logic: CatchLogic | RingLogic | null = null
let scorer: ScoreTracker | null = null
let renderer: Renderer | RingRenderer | null = null
let sfx: SfxPlayer | null = null
const input = new HandInputTracker()

let ownStream: MediaStream | null = null
let rafId = 0
let disposed = false
/** 최신 손 위치 — 렌더와 miss 판정용(grabbed는 제외해 중복 히트를 막는다) */
let latestHands: Hands = { left: null, right: null }
let lastProgressAt = -Infinity

const accuracy = computed(() => {
  const total = counts.value.perfect + counts.value.good + counts.value.miss
  return total === 0 ? 0 : Math.round(((counts.value.perfect + counts.value.good) / total) * 100)
})

/** 노트를 하나도 놓치지 않았는가 — 리듬게임에서 제일 자랑스러운 결과 */
const fullCombo = computed(
  () => counts.value.miss === 0 && counts.value.perfect + counts.value.good > 0,
)

/**
 * 결과 등급 — 점수가 아니라 **정확도** 기준이다.
 * 난이도마다 만점이 다르므로(EASY ~7천 / HARD ~19천) 점수로 등급을 매기면
 * 쉬운 난이도가 영원히 낮은 등급이 된다.
 */
const TIERS = [
  { min: 98, grade: 'SS', label: '완벽해요!', color: '#ff9e3d' },
  { min: 93, grade: 'S', label: '훌륭해요', color: '#f0803c' },
  { min: 85, grade: 'A', label: '잘했어요', color: '#3fa87e' },
  { min: 70, grade: 'B', label: '좋아요', color: '#4a90d9' },
  { min: 50, grade: 'C', label: '괜찮아요', color: '#8b7fd4' },
  { min: 0, grade: 'D', label: '다시 도전!', color: '#9b8f88' },
] as const

const tier = computed(() => TIERS.find((t) => accuracy.value >= t.min) ?? TIERS[TIERS.length - 1]!)

/**
 * 이펙트를 터뜨릴 게임 좌표.
 * 캐치: 노트 자리(연결 노트는 경로 끝). 링: 레인 위치를 각도에서 계산한다.
 */
function fxPointOf(event: CatchEvent | RingEvent, tMs: number): { x: number; y: number } {
  const note = event.note
  if (isRing) {
    const ring = note as TrackedRingNote
    const deg = ring.type === 'hold' ? holdBearingDeg(ring, tMs) : laneAngleDeg(ring.lane)
    const rad = (deg * Math.PI) / 180
    return { x: Math.sin(rad) * RING_RADIUS, y: Math.cos(rad) * RING_RADIUS }
  }
  const c = note as TrackedNote
  if (event.type === 'hit' && c.kind === 'trail' && c.path?.length) {
    return c.path[c.path.length - 1]!
  }
  return { x: c.x, y: c.y }
}

/** 판정 파이프 — 입력 콜백과 렌더 루프 양쪽에서 부른다. */
function pumpLogic(hands: Hands, tMs: number) {
  if (!logic || !scorer || !renderer) return
  for (const event of logic.update(tMs, hands)) {
    if (event.type === 'spawn') continue
    const judgement: Judgement = event.type === 'hit' ? event.judgement : 'miss'
    // miss는 잡을 손이 정해져 있으니 노트의 손을 쓴다('any'는 오른손 색으로)
    const hand = event.type === 'hit' ? event.hand : event.note.hand === 'left' ? 'left' : 'right'
    scorer.add(judgement)
    // 이펙트가 터질 위치 — 모드마다 노트 좌표계가 다르다
    const at = fxPointOf(event, tMs)
    // 콤보를 넘겨 이펙트 크기를 키운다 — 잘 치고 있다는 감각
    renderer.spawnFx(at.x, at.y, judgement, hand, tMs, scorer.combo)
    // 콤보를 같이 넘긴다 — 히트음이 반음씩 올라가 "타고 있다"는 감각을 만든다
    sfx?.play(renderer.skin.sfx[judgement], scorer.combo)
  }
  score.value = scorer.score
  combo.value = scorer.combo
  maxCombo.value = scorer.maxCombo
  counts.value = { ...scorer.counts }

  if (tMs - lastProgressAt >= 1000) {
    lastProgressAt = tMs
    emit('progress', scorer.score, scorer.combo)
  }
}

/** 위치만 남기고 grabbed를 지운다 — 렌더 루프가 히트를 중복 발생시키지 않도록. */
function withoutGrab(hands: Hands): Hands {
  return {
    left: hands.left ? { ...hands.left, grabbed: false } : null,
    right: hands.right ? { ...hands.right, grabbed: false } : null,
  }
}

function renderHands(): Partial<Record<'left' | 'right', RenderHand | null>> {
  return {
    left: latestHands.left
      ? {
          x: latestHands.left.x,
          y: latestHands.left.y,
          isFist: input.isFisted.left,
          landmarks: input.landmarks.left,
        }
      : null,
    right: latestHands.right
      ? {
          x: latestHands.right.x,
          y: latestHands.right.y,
          isFist: input.isFisted.right,
          landmarks: input.landmarks.right,
        }
      : null,
  }
}

/**
 * 카운트다운 → 플레이 전환. 3·2·1이 끝나면 "시작!"을 띄운다.
 *
 * 곡은 여기서 틀지 않는다 — 이미 boot에서 절대 시각으로 예약돼 있다. 이 함수가 늦게 불려도
 * (프레임 드랍) 곡은 제 시각에 들어온다. 리드인부터 깔지 않는 이유는, 첫 노트 전 5초가 손을
 * 올려 자세를 잡는 시간이라 그 사이 곡이 흐르면 "언제 시작인지"가 흐려지기 때문이다.
 */
function beginPlay() {
  phase.value = 'playing'
  startFlash.value = true
  clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => (startFlash.value = false), START_FLASH_MS)
}

function finish() {
  if (phase.value === 'result') return
  phase.value = 'result'
  cancelAnimationFrame(rafId)
  landmarker.stop()
  clock?.stop()
  // 한 판이 끝나면 곡도 끝난다 — 결과 화면 위로 계속 흐르면 판이 안 끝난 것처럼 들린다
  music?.stop()
  if (scorer) {
    emit('finished', {
      score: scorer.score,
      maxCombo: scorer.maxCombo,
      counts: { ...scorer.counts },
    })
  }
}

function loop() {
  if (disposed) return
  rafId = requestAnimationFrame(loop)
  if (!clock || !logic || !renderer) return

  const t = clock.now()

  if (t < LEAD_IN_MS) {
    countdown.value = Math.max(1, Math.ceil((LEAD_IN_MS - t) / 1000))
    phase.value = 'countdown'
  } else if (phase.value === 'countdown') {
    beginPlay()
  }
  remainingSec.value = Math.max(0, Math.ceil((props.durationMs - t) / 1000))

  // 손 입력이 없어도 miss·spawn은 진행돼야 한다
  pumpLogic(withoutGrab(latestHands), t)

  renderer.resize()
  // 두 렌더러의 draw 시그니처는 notes 타입만 다르다 — 모드별로 각자 자기 노트를 받는다
  ;(renderer as { draw: (f: unknown) => void }).draw({
    tMs: t,
    notes: logic.notes,
    approachTimeMs: chart.value.approachTimeMs,
    hands: renderHands(),
  })

  // 마지막 노트가 다 처리됐거나 라운드 시간이 끝나면 종료
  if (logic.isFinished() || t >= props.durationMs + 1500) finish()
}

/**
 * 분석용 <video> 확보.
 * 방에서 넘겨준 게 있으면 그대로 쓰고(카메라 중복 점유 금지), 없으면 자체 스트림을 연다.
 */
async function resolveVideo(): Promise<HTMLVideoElement | null> {
  if (props.video) return props.video

  const video = videoEl.value
  if (!video) return null
  ownStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'user' },
    audio: false,
  })
  video.srcObject = ownStream
  await video.play()
  return video
}

async function boot() {
  try {
    const video = await resolveVideo()
    const canvas = canvasEl.value
    if (!video || !canvas) return

    if (!video.videoWidth) {
      await new Promise<void>((res) =>
        video.addEventListener('loadedmetadata', () => res(), { once: true }),
      )
    }

    audioCtx = new AudioContext()
    // 브라우저 자동재생 정책 — 사용자 제스처로 진입했으면 즉시 풀린다
    if (audioCtx.state === 'suspended') await audioCtx.resume()
    sfx = new SfxPlayer(audioCtx)
    // 곡 로드·디코드는 손 인식 모델(7.5MB)과 **병렬**로 돌린다. 순서대로 기다리면 카운트다운을
    // 잡아먹고, 늦게 끝나도 아래 예약이 파일 안쪽 offset에서 시작해 위상을 지킨다.
    music = new RhythmMusic(audioCtx, props.song?.src ?? BGM_SRC, props.song?.gridOriginMs ?? null)
    const musicReady = music.load()

    const skin = resolveSkin(props.skinId)
    renderer = isRing ? new RingRenderer(canvas, skin) : new Renderer(canvas, skin)
    renderer.resize()

    logic = isRing
      ? new RingLogic(chart.value as ReturnType<typeof generateRingChart>)
      : new CatchLogic(chart.value as ReturnType<typeof generateBattleChart>)
    scorer = new ScoreTracker()
    clock = new GameClock(audioCtx)

    loadingText.value = '손 인식 모델을 불러오는 중…'
    const started = await landmarker.start(video, (result) => {
      const aspect = video.videoWidth / video.videoHeight || 16 / 9
      const hands = input.update(
        {
          landmarks: result.landmarks,
          handedness: result.handednesses.map((h) => h[0]?.categoryName ?? 'Right'),
        },
        aspect,
      )
      latestHands = hands
      handsSeen.value = Boolean(hands.left || hands.right)
      // 실제 판정은 입력 프레임에서 — grabbed 전환을 정확히 한 번만 소비한다
      if (clock) pumpLogic(hands, clock.now())
    })
    if (!started) {
      emit('error', '손 인식 모델을 불러오지 못했어요')
      return
    }

    // 대전이면 서버가 정한 t=0에 맞춰 예약 시작한다(이미 지났으면 즉시 = 늦게 들어온 참가자).
    // 솔로는 지금이 t=0. 어느 쪽이든 LEAD_IN_MS 동안 카운트다운 오버레이가 뜬다.
    const skewSec = props.epochZeroMs == null ? 0 : (props.epochZeroMs - Date.now()) / 1000
    clock.start(audioCtx.currentTime + skewSec)

    // 곡을 게임 시각으로 예약한다 — 절대 시각이라 여기서 몇 프레임 늦게 걸어도 시작 순간은 같다.
    // 판이 이미 끝났으면(늦게 들어와 즉시 정산) 걸지 않는다 — 결과 화면 위로 곡이 올라온다.
    const musicClock = clock
    void musicReady.then((ok) => {
      if (!ok || disposed || phase.value === 'result') return
      // 커스텀 곡이면 채보 랩이 정한 시각(채보 offsetMs)에, 아니면 기본 곡 슬롯에 건다
      const startMs = props.song?.startMs ?? slotTimeMs(SONG_START_SLOT)
      music?.start(musicClock.ctxTimeAt(startMs + SONG_NUDGE_MS))
    })

    // ★ 늦게 시작한 참가자 보정.
    // 손 인식 모델(7.5MB)이 캐시에 없으면 로드에 수 초가 걸리는데, 대전에서는 t=0을
    // 서버 시각에 맞추므로 그만큼 t가 점프한다. 그때 지나간 노트를 평소 경로로 처리하면
    // 한 프레임에 수십 개의 miss가 쏟아지며 이펙트·오실레이터가 동시 생성돼 화면이 멈춘다.
    // 놓친 건 점수에 반영하되 연출은 내보내지 않는다.
    const missedWhileLoading = logic.catchUp(clock.now())
    if (missedWhileLoading > 0) {
      for (let i = 0; i < missedWhileLoading; i++) scorer.add('miss')
      lateStart.value = missedWhileLoading
      counts.value = { ...scorer.counts }
    }

    phase.value = 'countdown'
    loop()
  } catch (err) {
    const name = (err as { name?: string })?.name
    emit(
      'error',
      name === 'NotAllowedError' || name === 'SecurityError'
        ? '카메라 권한이 필요해요'
        : '카메라를 열 수 없어요',
    )
  }
}

onMounted(boot)

onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(rafId)
  clearTimeout(flashTimer)
  landmarker.stop()
  clock?.stop()
  music?.dispose()
  ownStream?.getTracks().forEach((t) => t.stop())
  void audioCtx?.close()
})

defineExpose({ canvas: canvasEl })
</script>

<template>
  <div class="stage">
    <!-- 분석 전용 — 화면에는 캔버스만 보인다 -->
    <video ref="videoEl" class="hidden-video" playsinline muted></video>
    <canvas ref="canvasEl" class="board"></canvas>

    <div v-if="phase === 'loading'" class="overlay">
      <p>{{ loadingText }}</p>
    </div>

    <!-- 리드인 5초 중 마지막 3초만 숫자를 센다 — 그 앞은 손을 올려 자세를 잡는 시간이라 안내만 띄운다 -->
    <div v-else-if="phase === 'countdown'" class="overlay">
      <p v-if="countdown <= COUNTDOWN_SECONDS" class="count">{{ countdown }}</p>
      <p v-else class="get-ready">준비</p>
      <p class="hint">손을 펴서 화면에 보이게 한 뒤, 노트 위에서 <b>주먹을 쥐세요</b></p>
    </div>

    <!-- 곡이 걸리는 순간 — 오버레이가 아니라 얹기만 한다(첫 노트가 이미 다가오고 있다) -->
    <p v-if="startFlash" class="start-flash">시작!</p>

    <div v-if="phase === 'playing'" class="hud">
      <span class="score">{{ score.toLocaleString() }}</span>
      <span v-if="combo > 1" class="combo">{{ combo }} COMBO</span>
      <span class="time">{{ remainingSec }}s</span>
    </div>

    <p v-if="phase === 'playing' && !handsSeen" class="hand-lost">손이 보이지 않아요</p>
    <p v-if="lateStart > 0 && phase !== 'result'" class="late">
      준비가 늦어 {{ lateStart }}개를 놓쳤어요
    </p>

    <div v-if="phase === 'result'" class="overlay result">
      <div class="result-card">
        <p class="tier" :style="{ color: tier.color }">{{ tier.grade }}</p>
        <p class="tier-label">{{ tier.label }}</p>
        <p class="final">{{ score.toLocaleString() }}</p>
        <p class="detail">
          PERFECT {{ counts.perfect }} · GOOD {{ counts.good }} · MISS {{ counts.miss }}
        </p>
        <p class="detail">최대 콤보 {{ maxCombo }} · 정확도 {{ accuracy }}%</p>
        <p v-if="fullCombo" class="full-combo">FULL COMBO!</p>
        <slot name="result-actions" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: var(--font-pixel);
}
.hidden-video {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.board {
  display: block;
  width: 100%;
  height: 100%;
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: rgba(255, 243, 234, 0.82);
  text-align: center;
  padding: 1rem;
}
.count {
  font-size: clamp(3rem, 14vh, 7rem);
  font-weight: 700;
  color: #e07a4f;
  line-height: 1;
}
.get-ready {
  font-size: clamp(1.6rem, 7vh, 3.2rem);
  font-weight: 700;
  color: #b0968a;
  letter-spacing: 0.2em;
  line-height: 1;
}
.hint {
  font-size: 0.95rem;
  color: #7a6a60;
}
.start-flash {
  position: absolute;
  top: 42%;
  left: 50%;
  margin: 0;
  /* 애니메이션이 꺼진 환경에서도 가운데에 있도록 기본 변형을 둔다 */
  transform: translate(-50%, -50%);
  font-size: clamp(2.4rem, 11vh, 5.4rem);
  font-weight: 700;
  color: #e07a4f;
  letter-spacing: 0.08em;
  text-shadow: 3px 3px 0 #fff3ea;
  pointer-events: none;
  animation: start-pop 0.9s ease-out forwards;
}
@keyframes start-pop {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.7); }
  22% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
  70% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.15); }
}
.hud {
  position: absolute;
  top: 0.75rem;
  left: 0.75rem;
  right: 0.75rem;
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}
.score {
  font-size: 1.6rem;
  font-weight: 700;
  color: #5c4a3f;
}
.combo {
  font-size: 1rem;
  color: #e07a4f;
}
.time {
  margin-left: auto;
  font-size: 1rem;
  color: #7a6a60;
}
.late {
  position: absolute;
  top: 2.4rem;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  background: rgba(179, 64, 42, 0.85);
  color: #fff;
  font-size: 0.78rem;
}
.hand-lost {
  position: absolute;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 0.85rem;
}
.result .tier {
  margin: 0;
  font-size: clamp(2.6rem, 10vh, 4.6rem);
  font-weight: 400;
  line-height: 1;
  letter-spacing: 0.05em;
}
.result {
  padding: clamp(0.8rem, 3vh, 1.4rem);
}
.result-card {
  display: flex;
  width: min(100%, 25rem);
  max-height: 100%;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
  overflow: auto;
  padding: clamp(1rem, 3vh, 1.6rem);
  border: 2px solid #d7b09a;
  border-radius: 0.9rem;
  background: #fffdf8;
  box-shadow: 5px 5px 0 rgba(131, 79, 58, 0.22);
}
.result .tier-label {
  margin: 0;
  font-size: 1rem;
  color: #7a6a60;
}
.result .full-combo {
  margin: 0.15rem 0;
  font-size: 0.9rem;
  font-weight: 400;
  letter-spacing: 0.12em;
  color: #ff9e3d;
}
.result .final {
  margin: 0.2rem 0;
  font-size: clamp(2.1rem, 7vh, 3.4rem);
  font-weight: 400;
  color: #e07a4f;
  line-height: 1.1;
}
.result .detail {
  width: 100%;
  margin: 0;
  padding: 0.35rem 0.45rem;
  border-radius: 0.35rem;
  background: #fff4ec;
  font-size: clamp(0.72rem, 1.7vh, 0.9rem);
  line-height: 1.45;
  color: #5c4a3f;
}
</style>
