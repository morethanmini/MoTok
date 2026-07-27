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
import { CatchLogic, type Hands } from './logic/catchLogic'
import { generateBattleChart } from './generator/battleChart'
import { LEAD_IN_MS, type Difficulty } from './generator/presets'
import { HandInputTracker } from './input/handInput'
import { Renderer, type RenderHand } from './render/renderer'
import { resolveSkin } from './render/skins'
import { SfxPlayer } from './audio/sfx'
import type { Judgement } from './core/types'

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
  }>(),
  { durationMs: 90_000, skinId: 'cat-candy', video: null, epochZeroMs: null },
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
const handsSeen = ref(false)
const remainingSec = ref(0)

const landmarker = useHandLandmarker()
const chart = shallowRef(generateBattleChart(props.seed, props.difficulty, props.durationMs))

let audioCtx: AudioContext | null = null
let clock: GameClock | null = null
let logic: CatchLogic | null = null
let scorer: ScoreTracker | null = null
let renderer: Renderer | null = null
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

/** 판정 파이프 — 입력 콜백과 렌더 루프 양쪽에서 부른다. */
function pumpLogic(hands: Hands, tMs: number) {
  if (!logic || !scorer || !renderer) return
  for (const event of logic.update(tMs, hands)) {
    if (event.type === 'spawn') continue
    const judgement: Judgement = event.type === 'hit' ? event.judgement : 'miss'
    // miss는 잡을 손이 정해져 있으니 노트의 손을 쓴다('any'는 오른손 색으로)
    const hand = event.type === 'hit' ? event.hand : event.note.hand === 'left' ? 'left' : 'right'
    scorer.add(judgement)
    // 연결 노트는 경로 끝에서 터져야 자연스럽다
    const at =
      event.type === 'hit' && event.note.kind === 'trail'
        ? (event.note.path?.[event.note.path.length - 1] ?? event.note)
        : event.note
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

function finish() {
  if (phase.value === 'result') return
  phase.value = 'result'
  cancelAnimationFrame(rafId)
  landmarker.stop()
  clock?.stop()
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
    phase.value = 'playing'
  }
  remainingSec.value = Math.max(0, Math.ceil((props.durationMs - t) / 1000))

  // 손 입력이 없어도 miss·spawn은 진행돼야 한다
  pumpLogic(withoutGrab(latestHands), t)

  renderer.resize()
  renderer.draw({
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

    const skin = resolveSkin(props.skinId)
    renderer = new Renderer(canvas, skin)
    renderer.resize()

    logic = new CatchLogic(chart.value)
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
  landmarker.stop()
  clock?.stop()
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

    <div v-else-if="phase === 'countdown'" class="overlay">
      <p class="count">{{ countdown }}</p>
      <p class="hint">손을 펴서 화면에 보이게 한 뒤, 노트 위에서 <b>주먹을 쥐세요</b></p>
    </div>

    <div v-if="phase === 'playing'" class="hud">
      <span class="score">{{ score.toLocaleString() }}</span>
      <span v-if="combo > 1" class="combo">{{ combo }} COMBO</span>
      <span class="time">{{ remainingSec }}s</span>
    </div>

    <p v-if="phase === 'playing' && !handsSeen" class="hand-lost">손이 보이지 않아요</p>

    <div v-if="phase === 'result'" class="overlay result">
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
</template>

<style scoped>
.stage {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
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
.hint {
  font-size: 0.95rem;
  color: #7a6a60;
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
  font-size: clamp(3rem, 13vh, 6rem);
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0.05em;
}
.result .tier-label {
  font-size: 1rem;
  color: #7a6a60;
  margin-top: -0.2rem;
}
.result .full-combo {
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #ff9e3d;
}
.result .final {
  font-size: clamp(2.5rem, 10vh, 4.5rem);
  font-weight: 700;
  color: #e07a4f;
  line-height: 1.1;
}
.result .detail {
  font-size: 0.95rem;
  color: #5c4a3f;
}
</style>
