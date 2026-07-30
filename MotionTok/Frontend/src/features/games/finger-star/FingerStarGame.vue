<script setup lang="ts">
/**
 * 핑거 스타 — 손가락으로 별자리 만들기.
 *
 * 부모(게임룸)의 셀프 비디오 엘리먼트를 받아 MediaPipe로 분석하고, 카메라 원본 대신
 * 밤하늘 + 별자리 + 손가락 포인트만 캔버스에 그린다. 카메라를 새로 열지 않는다
 * (게임룸의 로컬 캡처 스트림을 재사용 — S15P11A706-33). 카메라 원본을 그리지 않으므로
 * 카메라 발행을 끈(숨김) 상태에서 캔버스를 송출해도 얼굴은 노출되지 않는다.
 *
 * 매치 룰(개선안): 60초 동안 별자리를 연속으로 완성한다 — 모든 별을 켠 채 3초 유지하면
 * 그 즉시 점수를 확정하고 다음 별자리가 나온다. 승부는 완성 개수(1순위) → 평균 점수(2순위).
 * 처음 3개는 쉬움·보통에서만 출제된다(StarSequence).
 *
 * 모드:
 * - 솔로 연습(session=null): 별자리를 골라 한 판(30초) — 서버 미연동 폴백 겸 연습.
 * - 솔로 도전(session=null): 위 매치 룰 그대로 60초, 로컬 최고 기록(개수·평균).
 * - 멀티(session 제공): 서버 권위 타이머(S15P11A706-116) + GAME_START의 공유 시드로
 *   전원이 같은 별자리 순서를 뽑는다. 진행 상황은 progress 이벤트로(스로틀 300ms),
 *   최종 집계는 finished 이벤트로 부모가 STOMP 발신한다. 순위는 results prop(GAME_END)으로 표시.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { GameResultEntry } from '@/api/types'
import { useHandLandmarker, type HandLandmarkerResult } from '@/composables/useHandLandmarker'
import type { ActiveGameSession } from '../session'
import { GameBgm } from '../gameBgm'
import { CONSTELLATIONS, constellationByKey } from './constellations'
import {
  StarSequence,
  mulberry32,
  averageScore,
  isBetterRecord,
  type MatchRecord,
} from './challenge'
import {
  FINGER_TIPS,
  HIT_RADIUS_RATIO,
  CONSTELLATION_SCALE,
  collectFingerSlots,
  layoutConstellation,
  matchFingersToTargets,
  computeRatioScore,
  partialScore,
  scoreTier,
  type FingerSlots,
  type Point,
  type SlotKey,
} from './logic'

const props = defineProps<{
  /** 게임룸 셀프 타일의 <video> — 스트림이 attach되어 재생 중이어야 한다 */
  video: HTMLVideoElement | null
  /** 멀티플레이 세션(GAME_START). null이면 솔로 모드 */
  session?: ActiveGameSession | null
  /** GAME_END 순위 — 도착 전까지 "집계 중" 표시 */
  results?: GameResultEntry[] | null
  /** 순위에서 내 행을 강조하기 위한 참가자 id */
  myUserId?: string | null
}>()
const emit = defineEmits<{
  close: []
  /** 멀티: 라운드 중 진행 상황(300ms 스로틀 완료 상태) — starsLit·홀드 게이지·완성 개수 */
  progress: [starsLit: number, holdProgress: number, completedCount: number]
  /** 매치 최종 집계 — totalScore(총점)·completedCount가 서버 순위 입력이다 */
  finished: [payload: { completedCount: number; totalScore: number; avgScore: number }]
}>()

/** 매치(도전·멀티) 총 시간 — 멀티는 서버 endAt이 권위이고 이 값은 games 테이블과 동기화된 표시 기본값 */
const MATCH_SECONDS = 60
/** 솔로 연습 한 판 시간 */
const PRACTICE_SECONDS = 30
const HOLD_SECONDS = 3
const PROGRESS_EMIT_INTERVAL_MS = 300

const SLOT_COLOR: Record<SlotKey, string> = {
  R1: '#FF5D73', R2: '#FFD23F', R3: '#C6FF5E', R4: '#3ddcff', R5: '#B98CFF',
  L1: '#FF9F5D', L2: '#FF5DE0', L3: '#5DFFC6', L4: '#5D8CFF', L5: '#FFEA5D',
}
const SLOT_RADIUS: Record<SlotKey, number> = {
  R1: 6, R2: 5.5, R3: 5, R4: 4.5, R5: 4, L1: 6, L2: 5.5, L3: 5, L4: 4.5, L5: 4,
}
const FINGER_IDLE_COLOR = '#5a5a68'
const HAND_CONN: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
]

const hand = useHandLandmarker()
const canvasRef = ref<HTMLCanvasElement>()
/** 부모(게임룸)가 게임 화면을 captureStream으로 송출할 수 있게 캔버스를 노출 */
defineExpose({ canvas: canvasRef })

// ── 게임 상태 ─────────────────────────────────
const phase = ref<'ready' | 'countdown' | 'playing' | 'result'>('ready')
const shapeKey = ref(CONSTELLATIONS[0]!.key)
const shape = computed(() => constellationByKey(shapeKey.value))
const isMultiplayer = computed(() => !!props.session)
const countdownLeft = ref(0)
const timeLeftSec = ref(MATCH_SECONDS)
const holdProgress = ref(0)
const hitCount = ref(0)
const score = ref<number | null>(null)
const rDetected = ref(false)
const lDetected = ref(false)
/** 새 비디오 프레임이 한 번이라도 들어왔는지 — 아니면 "카메라 대기 중" 안내 */
const gotFrame = ref(false)

/** 멀티: 서버 보정 시각. 솔로에서는 사용하지 않는다. */
function serverNow(): number {
  return Date.now() + (props.session?.clockOffset ?? 0)
}

// ── 60초 매치 상태 (솔로 도전·멀티 공용) ─────
const soloMode = ref<'practice' | 'challenge'>('practice')
/** 이번 매치 집계 — 완성 개수·점수 합(평균은 표시 시점 계산) */
const match = ref<MatchRecord>({ count: 0, sum: 0 })
/** 별자리 완성 직후 잠깐 띄우는 배너 — 화면 전환 없이 즉시 다음 별자리로 넘어가므로 */
const completeFlash = ref<{ gain: number; count: number } | null>(null)
let flashTimer = 0
let sequence: StarSequence | null = null
/** 솔로(연습·도전) 종료 시각 — performance.now() 기준. 별자리 전환과 무관하게 유지된다 */
let soloEndAt = 0

/** 로컬 최고 기록(도전 모드) — 본인 표시용. 랭킹과 무관. 비교 규칙은 승부와 동일(개수→총점) */
const BEST_MATCH_KEY = 'motok.fingerStar.bestMatch'
const isNewBest = ref(false)
const bestRecord = ref<MatchRecord>(loadBestRecord())

function loadBestRecord(): MatchRecord {
  try {
    const parsed = JSON.parse(localStorage.getItem(BEST_MATCH_KEY) ?? '') as MatchRecord
    if (typeof parsed?.count === 'number' && typeof parsed?.sum === 'number') {
      return { count: parsed.count, sum: parsed.sum }
    }
  } catch {
    // 기록 없음 또는 구버전(라운드제 숫자) — 규칙이 달라 비교 불가라 초기화
  }
  return { count: 0, sum: 0 }
}
function saveBestRecord(record: MatchRecord) {
  try {
    localStorage.setItem(BEST_MATCH_KEY, JSON.stringify(record))
  } catch {
    // 스토리지 불가(프라이빗 모드 등) — 기록 저장만 포기
  }
}

// 프레임마다 바뀌는 값은 반응성 없이 보관 (렌더 루프 전용) — "별자리 한 개" 단위 상태.
// 매치 도중 완성할 때마다 freshRound()로 갈리고, 매치 집계는 match ref가 따로 든다.
interface RoundState {
  activeMask: boolean[]
  matchedSlots: Set<SlotKey>
  positions: (Point | null)[]
  bestCount: number
  done: boolean
  finalPositions: (Point | null)[] | null
  lastTs: number
}
let round: RoundState = freshRound()
let finishEmitted = false
let lastProgressEmitAt = 0
function freshRound(): RoundState {
  return {
    activeMask: [], matchedSlots: new Set(), positions: [],
    bestCount: 0, done: false, finalPositions: null, lastTs: 0,
  }
}

// ── 인식 루프 연결 — 비디오가 준비되면 항상 돌린다(대기 화면에서도 손이 보이게) ──
watch(
  () => props.video,
  (video) => {
    hand.stop()
    if (!video) return
    // 실패(모델 로드·GPU 초기화)를 삼키면 화면은 도는데 손만 안 잡히는 상태가 된다(-161).
    // 한 번 재시도하고, 그래도 안 되면 hand.error가 대기 패널에 표시된다.
    void hand.start(video, onFrame).then((ok) => {
      if (!ok && props.video === video) return hand.start(video, onFrame)
    })
  },
  { immediate: true },
)

// ── 멀티플레이 상태 머신 — 프레임 유무와 무관하게 서버 시각으로 전이한다 ──
let mpTicker = 0
watch(
  () => props.session,
  (session) => {
    clearInterval(mpTicker)
    if (!session) {
      phase.value = 'ready'
      return
    }
    // GAME_START의 공유 시드(constellationKey 필드) → 전원이 같은 별자리 순서를 뽑는다
    startMatch(mulberry32(Number(session.constellationKey) || 1))
    phase.value = serverNow() >= session.startAt ? 'playing' : 'countdown'
    if (phase.value === 'playing') beginConstellation()
    mpTicker = window.setInterval(mpTick, 100)
  },
  { immediate: true },
)
function mpTick() {
  const session = props.session
  if (!session) return
  const now = serverNow()
  if (phase.value === 'countdown') {
    countdownLeft.value = Math.max(1, Math.ceil((session.startAt - now) / 1000))
    if (now >= session.startAt) {
      beginConstellation()
      phase.value = 'playing'
    }
    return
  }
  if (phase.value === 'playing') {
    timeLeftSec.value = Math.max(0, (session.endAt - now) / 1000)
    if (now >= session.endAt) finalizeMultiplayerRound()
  }
}
// GAME_END 순위가 도착하면(조기 종료 포함) 결과 화면으로 전환
watch(
  () => props.results,
  (results) => {
    if (!results) return
    if (phase.value === 'playing') finalizeMultiplayerRound()
    phase.value = 'result'
  },
)
const bgm = new GameBgm('/assets/sfx/finger-star/ingame-loop.mp3')
onMounted(() => bgm.start())
onBeforeUnmount(() => {
  hand.stop()
  bgm.dispose()
  clearInterval(mpTicker)
  clearTimeout(flashTimer)
})

/** 매치 공통 초기화 — 시퀀스 생성·집계 리셋·첫 별자리 결정 (연습은 안 거친다) */
function startMatch(rng: () => number) {
  sequence = new StarSequence(CONSTELLATIONS, rng)
  match.value = { count: 0, sum: 0 }
  completeFlash.value = null
  isNewBest.value = false
  finishEmitted = false
  score.value = null
  shapeKey.value = sequence.next()
  timeLeftSec.value = MATCH_SECONDS
}

/** 별자리 한 개 단위 상태 리셋 — 매치 타이머는 건드리지 않는다 */
function beginConstellation() {
  round = freshRound()
  round.lastTs = performance.now()
  holdProgress.value = 0
  hitCount.value = 0
}

/** 솔로 연습: 시작 버튼 / 다시 하기 (별자리 자유 선택, 한 판 30초) */
function startSoloRound() {
  soloMode.value = 'practice'
  finishEmitted = false
  score.value = null
  soloEndAt = performance.now() + PRACTICE_SECONDS * 1000
  timeLeftSec.value = PRACTICE_SECONDS
  beginConstellation()
  phase.value = 'playing'
}

/** 솔로 도전: 60초 매치 시작 / 다시 도전 */
function startChallengeRun() {
  soloMode.value = 'challenge'
  startMatch(mulberry32(Math.floor(Math.random() * 0xffffffff)))
  soloEndAt = performance.now() + MATCH_SECONDS * 1000
  beginConstellation()
  phase.value = 'playing'
}

/** 완성된 별자리의 비율 점수 (round.done 이후에만 유효) */
function computeConstellationScore(): number {
  const canvas = canvasRef.value
  if (!round.finalPositions || !canvas) return 0
  const targets = layoutConstellation(shape.value.pts, canvas.width, canvas.height)
  return computeRatioScore(targets, round.finalPositions.filter((p): p is Point => !!p))
}

/**
 * 매치 중 별자리 완성(3초 유지) — 즉시 점수를 확정해 집계에 더하고 다음 별자리로 넘어간다.
 * 화면 전환 없이 배너만 잠깐 띄운다(남은 시간이 곧 자원이므로 흐름을 끊지 않는다).
 */
function completeAndAdvance() {
  const gain = computeConstellationScore()
  match.value = { count: match.value.count + 1, sum: match.value.sum + gain }
  completeFlash.value = { gain, count: match.value.count }
  clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => (completeFlash.value = null), 1200)
  if (sequence) shapeKey.value = sequence.next()
  beginConstellation()
}

/** 연습 한 판 점수 (완성 시 비율 점수, 미완성 시 부분 점수) */
function computeFinalScore(): { score: number; starsHit: number } {
  const n = shape.value.pts.length
  if (round.done) {
    return { score: computeConstellationScore(), starsHit: round.bestCount }
  }
  return { score: partialScore(round.bestCount, n), starsHit: round.bestCount }
}

function emitFinishedOnce() {
  if (finishEmitted) return
  finishEmitted = true
  if (isMultiplayer.value || soloMode.value === 'challenge') {
    const avg = averageScore(match.value)
    score.value = avg
    emit('finished', {
      completedCount: match.value.count,
      totalScore: match.value.sum,
      avgScore: avg,
    })
    return
  }
  // 연습 — 단판 점수를 같은 페이로드 모양으로 실어 보낸다(솔로 폴백 토스트용)
  const r = computeFinalScore()
  score.value = r.score
  emit('finished', {
    completedCount: round.done ? 1 : 0,
    totalScore: r.score,
    avgScore: r.score,
  })
}

/** 솔로 시간 종료 → 연습은 단판 결과, 도전은 매치 집계·최고 기록 갱신 */
function endSoloRound() {
  if (soloMode.value === 'challenge') {
    score.value = averageScore(match.value)
    if (isBetterRecord(match.value, bestRecord.value)) {
      bestRecord.value = { ...match.value }
      isNewBest.value = true
      saveBestRecord(match.value)
    }
    phase.value = 'result'
    return
  }
  emitFinishedOnce()
  phase.value = 'result'
}

/** 멀티 매치 종료(시간 만료·GAME_END 수신) → 집계 발신 후 정산 대기 */
function finalizeMultiplayerRound() {
  emitFinishedOnce()
  phase.value = 'result'
}

// ── 프레임 처리 (새 비디오 프레임마다 호출) ─────
function onFrame(result: HandLandmarkerResult) {
  const canvas = canvasRef.value
  const video = props.video
  if (!canvas || !video) return
  gotFrame.value = true

  const w = video.videoWidth || 960
  const h = video.videoHeight || 540
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }

  const landmarks = result.landmarks ?? []
  const handedness = result.handedness ?? []
  const slots = collectFingerSlots(landmarks, handedness, w, h)
  rDetected.value = !!slots.R1
  lDetected.value = !!slots.L1

  if (phase.value === 'playing') {
    const now = performance.now()
    const dt = Math.min(0.2, (now - round.lastTs) / 1000)
    round.lastTs = now
    updateRound(slots, dt, w, h)

    // 완성(3초 유지) — 매치(도전·멀티)는 즉시 점수 확정 후 다음 별자리로, 연습은 단판 결과로
    if (round.done) {
      if (isMultiplayer.value || soloMode.value === 'challenge') completeAndAdvance()
      else endSoloRound()
    }

    if (isMultiplayer.value) {
      if (now - lastProgressEmitAt >= PROGRESS_EMIT_INTERVAL_MS) {
        lastProgressEmitAt = now
        emit('progress', hitCount.value, holdProgress.value, match.value.count)
      }
    } else {
      timeLeftSec.value = Math.max(0, (soloEndAt - now) / 1000)
      if (timeLeftSec.value <= 0) endSoloRound()
    }
  }

  render(canvas, landmarks, handedness)
}

function updateRound(slots: FingerSlots, dt: number, w: number, h: number) {
  if (round.done) return
  const targets = layoutConstellation(shape.value.pts, w, h)
  const hitRadius = Math.min(w, h) * CONSTELLATION_SCALE * HIT_RADIUS_RATIO
  const { activeMask, positions, matchedSlots } = matchFingersToTargets(slots, targets, hitRadius)
  const count = activeMask.filter(Boolean).length
  round.activeMask = activeMask
  round.positions = positions
  round.matchedSlots = matchedSlots
  round.bestCount = Math.max(round.bestCount, count)
  hitCount.value = count

  if (count === targets.length) {
    holdProgress.value = Math.min(1, holdProgress.value + dt / HOLD_SECONDS)
  } else {
    holdProgress.value = Math.max(0, holdProgress.value - (dt / HOLD_SECONDS) * 2)
  }
  if (holdProgress.value >= 1) {
    round.done = true
    round.finalPositions = positions.slice()
    beep(880)
  }
}

// ── 렌더링 ────────────────────────────────────
interface StarFieldStar { x: number; y: number; r: number; tw: number }
let starField: { w: number; h: number; stars: StarFieldStar[] } | null = null

function render(
  canvas: HTMLCanvasElement,
  landmarks: { x: number; y: number }[][],
  handedness: { categoryName: string }[][],
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  drawNightSky(ctx, w, h)
  drawConstellation(ctx, w, h)
  drawHands(ctx, w, h, landmarks, handedness)
}

function drawNightSky(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = ctx.createRadialGradient(w * 0.3, h * 0.15, 0, w * 0.3, h * 0.15, Math.max(w, h) * 0.85)
  bg.addColorStop(0, '#182a55')
  bg.addColorStop(1, '#070b1a')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  const neb = ctx.createRadialGradient(w * 0.75, h * 0.7, 0, w * 0.75, h * 0.7, Math.max(w, h) * 0.55)
  neb.addColorStop(0, 'rgba(100,120,200,0.16)')
  neb.addColorStop(1, 'rgba(100,120,200,0)')
  ctx.fillStyle = neb
  ctx.fillRect(0, 0, w, h)

  if (!starField || starField.w !== w || starField.h !== h) {
    const stars: StarFieldStar[] = []
    const count = Math.round((w * h) / 9000)
    for (let i = 0; i < count; i++) {
      stars.push({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.3 + 0.3, tw: Math.random() * Math.PI * 2 })
    }
    starField = { w, h, stars }
  }
  const t = performance.now() / 1000
  for (const s of starField.stars) {
    const a = 0.35 + 0.35 * Math.sin(t * 1.4 + s.tw)
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0.15, a)})`
    ctx.beginPath()
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
    ctx.fill()
  }
}

function glow(ctx: CanvasRenderingContext2D, color: string, blur: number, fn: () => void) {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = blur
  fn()
  ctx.restore()
}
function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function drawConstellation(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const targets = layoutConstellation(shape.value.pts, w, h)

  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  targets.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()
  ctx.restore()

  targets.forEach((p, i) => {
    const active = !!round.activeMask[i]
    if (active || round.done) {
      glow(ctx, '#ffffff', 14, () => dot(ctx, p.x, p.y, 6, '#ffffff'))
      glow(ctx, '#C6FF5E', 12, () => {
        ctx.strokeStyle = '#C6FF5E'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2)
        ctx.stroke()
      })
    } else {
      glow(ctx, 'rgba(255,255,255,0.45)', 6, () => dot(ctx, p.x, p.y, 3.5, 'rgba(255,255,255,0.85)'))
    }
    ctx.fillStyle = active ? '#ffffff' : 'rgba(255,255,255,0.5)'
    ctx.font = 'bold 11px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(String(i + 1), p.x, p.y - 16)
  })
}

function drawHands(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  landmarksList: { x: number; y: number }[][],
  handednessList: { categoryName: string }[][],
) {
  landmarksList.forEach((lm, idx) => {
    const cat = handednessList[idx]?.[0]?.categoryName
    const prefix = cat === 'Right' ? 'R' : 'L'
    glow(ctx, 'rgba(255,255,255,0.45)', 4, () => {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'
      ctx.lineWidth = 2
      for (const [a, b] of HAND_CONN) {
        const pa = lm[a]
        const pb = lm[b]
        if (!pa || !pb) continue
        ctx.beginPath()
        ctx.moveTo((1 - pa.x) * w, pa.y * h)
        ctx.lineTo((1 - pb.x) * w, pb.y * h)
        ctx.stroke()
      }
    })
    FINGER_TIPS.forEach((tipIdx, fi) => {
      const slotKey = (prefix + (fi + 1)) as SlotKey
      const p = lm[tipIdx]
      if (!p) return
      const isMatched = round.matchedSlots.has(slotKey)
      const color = isMatched ? SLOT_COLOR[slotKey] : FINGER_IDLE_COLOR
      const r = SLOT_RADIUS[slotKey]
      if (isMatched) glow(ctx, color, 12, () => dot(ctx, (1 - p.x) * w, p.y * h, r, color))
      else dot(ctx, (1 - p.x) * w, p.y * h, r, color)
    })
  })
}

// ── 효과음 ────────────────────────────────────
let audioCtx: AudioContext | null = null
function beep(freq = 660, dur = 0.08) {
  try {
    audioCtx = audioCtx ?? new AudioContext()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.type = 'triangle'
    o.frequency.value = freq
    g.gain.setValueAtTime(0.18, audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur)
    o.connect(g)
    g.connect(audioCtx.destination)
    o.start()
    o.stop(audioCtx.currentTime + dur)
  } catch {
    /* 오디오 미지원 환경 무시 */
  }
}

const resultTier = computed(() => (score.value === null ? '' : scoreTier(score.value)))

/** GAME_END 항목의 평균 점수 — score는 매치 총점이라 완성 개수로 나눈다 */
function entryAvg(r: GameResultEntry): number {
  return r.completedCount ? Math.round(r.score / r.completedCount) : 0
}
</script>

<template>
  <div class="fs-shell">
    <canvas ref="canvasRef" class="fs-canvas" />

    <!-- 상단 바: 별자리 이름 · 홀드 진행 · 타이머 -->
    <div class="fs-topbar">
      <span class="fs-name"
        >✨ {{ shape.name
        }}{{ isMultiplayer || soloMode === 'challenge' ? ` · 완성 ${match.count}` : '' }}</span
      >
      <div class="fs-hold">
        <div class="fs-hold-track"><div class="fs-hold-fill" :style="{ width: `${Math.round(holdProgress * 100)}%` }" /></div>
      </div>
      <span class="fs-timer">{{ phase === 'playing' ? timeLeftSec.toFixed(1) + 's' : '--' }}</span>
      <button class="fs-close" title="게임 종료" @click="emit('close')">✕</button>
    </div>

    <!-- 별자리 완성 배너 — 화면 전환 없이 즉시 다음 별자리로 넘어가므로 잠깐만 띄운다 -->
    <div v-if="completeFlash" class="fs-flash">
      🌟 {{ completeFlash.count }}번째 완성! +{{ completeFlash.gain }}점
    </div>

    <!-- 하단 바: 손 인식 상태 · 진행 -->
    <div class="fs-bottombar">
      <span :class="{ on: rDetected }">오른손 {{ rDetected ? '✓' : '—' }}</span>
      <span :class="{ on: lDetected }">왼손 {{ lDetected ? '✓' : '—' }}</span>
      <span class="fs-progress">별 {{ hitCount }} / {{ shape.pts.length }}</span>
    </div>

    <!-- 솔로 대기 화면: 도전 모드(런) + 연습(별자리 선택) -->
    <div v-if="phase === 'ready'" class="fs-overlay">
      <p class="fs-guide">
        별자리를 만들고 {{ HOLD_SECONDS }}초 유지하면 완성 — 즉시 다음 별자리!<br />{{
          MATCH_SECONDS
        }}초 동안 최대한 많이 완성해 보세요.
      </p>
      <button class="fs-start" :disabled="!gotFrame" @click="startChallengeRun">
        ⚔️ {{ MATCH_SECONDS }}초 도전
      </button>
      <p class="fs-sub">
        처음 3개는 쉬움·보통 별자리만 나와요{{
          bestRecord.count > 0
            ? ` · 🏆 최고 ${bestRecord.count}개 · 평균 ${averageScore(bestRecord)}점`
            : ''
        }}
      </p>
      <div class="fs-shapes">
        <button
          v-for="c in CONSTELLATIONS"
          :key="c.key"
          :class="{ on: c.key === shapeKey }"
          @click="shapeKey = c.key"
        >
          {{ c.name }}
        </button>
      </div>
      <p v-if="hand.error.value" class="fs-warn">{{ hand.error.value }}</p>
      <p v-else-if="hand.isLoading.value" class="fs-warn">손 인식 모델 로딩 중…</p>
      <p v-else-if="!gotFrame" class="fs-warn">카메라 영상을 기다리는 중… (카메라가 켜져 있어야 해요)</p>
      <button class="fs-quit" :disabled="!gotFrame" @click="startSoloRound">🚀 연습 라운드</button>
    </div>

    <!-- 멀티 카운트다운 -->
    <div v-if="phase === 'countdown'" class="fs-overlay">
      <p class="fs-guide">
        별을 모두 켠 채 {{ HOLD_SECONDS }}초 유지하면 완성, 즉시 다음 별자리 —<br />
        {{ MATCH_SECONDS }}초 동안 최대한 많이 완성하세요!
      </p>
      <p class="fs-countdown">{{ countdownLeft }}</p>
      <p v-if="!gotFrame" class="fs-warn">카메라 영상을 기다리는 중… (카메라가 켜져 있어야 해요)</p>
    </div>

    <!-- 결과 화면 -->
    <div v-if="phase === 'result'" class="fs-overlay">
      <!-- 멀티: GAME_END 순위 (도착 전엔 집계 중) -->
      <template v-if="isMultiplayer">
        <template v-if="results">
          <p class="fs-tier">🏆 최종 순위</p>
          <ol class="fs-ranking">
            <li v-for="r in results" :key="r.userId" :class="{ me: r.userId === myUserId }">
              <span class="fs-rank">{{ r.rank }}</span>
              <span class="fs-rname">{{ r.nickname }}</span>
              <span class="fs-rscore">{{
                r.finished ? `${r.completedCount ?? 0}개 · 평균 ${entryAvg(r)}점` : '미제출'
              }}</span>
            </li>
          </ol>
          <button class="fs-quit" @click="emit('close')">대기실로 돌아가기</button>
        </template>
        <template v-else>
          <p class="fs-tier">⏱ {{ MATCH_SECONDS }}초 종료!</p>
          <p class="fs-score">{{ match.count }}<small>개</small></p>
          <p class="fs-sub">평균 {{ averageScore(match) }}점 · 🌟 다른 참가자를 기다리는 중…</p>
        </template>
      </template>

      <!-- 솔로 -->
      <template v-else>
        <!-- 도전: 60초 매치 종료 -->
        <template v-if="soloMode === 'challenge'">
          <p class="fs-tier">⏱ {{ MATCH_SECONDS }}초 종료!</p>
          <p class="fs-score">{{ match.count }}<small>개</small></p>
          <p class="fs-sub">
            평균 {{ averageScore(match) }}점 ·
            {{
              isNewBest
                ? '🏆 신기록 달성!'
                : `🏆 최고 ${bestRecord.count}개 · 평균 ${averageScore(bestRecord)}점`
            }}
          </p>
          <div class="fs-actions">
            <button class="fs-start" @click="startChallengeRun">🔁 다시 도전</button>
            <button class="fs-quit" @click="emit('close')">나가기</button>
          </div>
        </template>
        <!-- 연습 -->
        <template v-else>
          <p class="fs-tier">{{ resultTier }}</p>
          <p class="fs-score">{{ score }}<small>점</small></p>
          <p class="fs-sub">{{ shape.name }} · 별 {{ round.bestCount }} / {{ shape.pts.length }}</p>
          <div class="fs-actions">
            <button class="fs-start" @click="startSoloRound">🔁 다시 하기</button>
            <button class="fs-quit" @click="emit('close')">나가기</button>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.fs-shell {
  position: absolute;
  inset: 0;
  background: #0f0a22;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-family: var(--font-pixel);
  color: #f4f0ff;
}
.fs-canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.fs-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: linear-gradient(rgba(15, 10, 34, 0.85), rgba(15, 10, 34, 0));
}
.fs-name { font-size: 10px; color: #c6ff5e; white-space: nowrap; }
.fs-hold { flex: 1; }
.fs-hold-track { height: 8px; background: rgba(255, 255, 255, 0.12); border-radius: 6px; overflow: hidden; }
.fs-hold-fill { height: 100%; background: linear-gradient(90deg, #c6ff5e, #ffd23f); transition: width 0.05s linear; }
.fs-timer { font-size: 11px; min-width: 52px; text-align: right; color: #ff5d73; }
.fs-flash {
  position: absolute;
  top: 44px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 14px;
  font-size: 9px;
  color: #0f2405;
  background: #c6ff5e;
  border-radius: 999px;
  pointer-events: none;
}
.fs-close {
  width: 26px; height: 26px; border: 2px solid rgba(255, 255, 255, 0.35); border-radius: 8px;
  background: rgba(15, 10, 34, 0.6); color: #f4f0ff; font-size: 10px; cursor: pointer;
}

.fs-bottombar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 14px;
  padding: 10px 14px;
  font-size: 8px;
  color: #9c8fc4;
  background: linear-gradient(rgba(15, 10, 34, 0), rgba(15, 10, 34, 0.85));
}
.fs-bottombar .on { color: #c6ff5e; }
.fs-progress { margin-left: auto; color: #f4f0ff; }

.fs-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: rgba(15, 10, 34, 0.72);
  text-align: center;
  padding: 20px;
}
.fs-guide { font-size: 10px; line-height: 2; margin: 0; }
.fs-countdown { font-size: 56px; color: #ffd23f; margin: 0; }
.fs-shapes { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.fs-shapes button {
  padding: 8px 12px; font-family: inherit; font-size: 9px; cursor: pointer;
  background: rgba(255, 255, 255, 0.08); color: #9c8fc4;
  border: 2px solid rgba(255, 255, 255, 0.18); border-radius: 10px;
}
.fs-shapes button.on { background: #c6ff5e; color: #0f2405; border-color: #c6ff5e; }
.fs-warn { font-size: 8px; color: #ffd3da; margin: 0; }
.fs-start {
  padding: 12px 20px; font-family: inherit; font-size: 10px; font-weight: 700; cursor: pointer;
  background: #ff5d73; color: #20090f; border: none; border-radius: 12px;
}
.fs-start:disabled { opacity: 0.45; cursor: not-allowed; }
.fs-quit {
  padding: 12px 20px; font-family: inherit; font-size: 10px; cursor: pointer;
  background: transparent; color: #f4f0ff; border: 2px solid rgba(255, 255, 255, 0.3); border-radius: 12px;
}
.fs-actions { display: flex; gap: 10px; }
.fs-tier { font-size: 14px; margin: 0; }
.fs-score { font-size: 40px; color: #c6ff5e; margin: 0; }
.fs-score small { font-size: 12px; margin-left: 4px; }
.fs-sub { font-size: 9px; color: #9c8fc4; margin: 0; }

.fs-ranking {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 240px;
  max-height: 50%;
  overflow-y: auto;
}
.fs-ranking li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  font-size: 9px;
  background: rgba(255, 255, 255, 0.07);
  border: 2px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
}
.fs-ranking li.me { border-color: #c6ff5e; background: rgba(198, 255, 94, 0.12); }
.fs-rank { color: #ffd23f; min-width: 18px; }
.fs-rname { flex: 1; text-align: left; }
.fs-rscore { color: #c6ff5e; }
</style>
