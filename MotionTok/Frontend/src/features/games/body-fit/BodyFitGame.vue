<script setup lang="ts">
/**
 * 게임④ 몸 끼워 맞추기 — 인게임 화면 (기획 §6-3, S15P11A706-47).
 *
 * 모톡 UI 템플릿(tokens.css 픽셀 테마)을 따른다: 크림 배경·잉크 보더·하드섀도 카드,
 * 3D 무대는 뷰포트 카드 안쪽에만 어둡게 들어간다.
 *
 * 지금은 1인 로컬 루프(내 포즈 → 출제 → 내가 통과)로 동작한다 — 멀티(출제자 로테이션·
 * 서버 타이머)는 -86/-48에서 세션 이벤트에 연결한다. 화면 구성 요소(게이지·타이머·
 * 썸네일·접근 바·등급 팝업·캠 스켈레톤 PiP)는 멀티에서도 그대로 쓰인다.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { GameResultEntry } from '@/api/types'
import { usePoseLandmarker, type PoseLandmarkerResult } from '@/composables/usePoseLandmarker'
import type { ActiveGameSession } from '../session'
import { defaultConfig, type DifficultyKey, type Grade } from './config'
import { PoseSmoother } from './oneEuro'
import { AvatarRig } from './avatarRig'
import {
  createSkeletonState,
  normalizePose,
  solveSkeleton,
  type LandmarkPoint,
  type SolvedSkeleton,
} from './skeleton'
import { drawSilhouette } from './silhouette'
import { holeMarginFor, judgeRound, type RoundJudgment } from './judge'
import { createStage, type Stage } from './stage'
import { createWall, type WallHandle } from './wall'

const props = defineProps<{
  /** 게임룸 셀프 타일의 <video> — 있으면 카메라를 새로 열지 않고 재사용한다 (게임① 패턴) */
  video?: HTMLVideoElement | null
  /** 멀티플레이 세션(GAME_START). null이면 솔로 모드(개발 라우트) */
  session?: ActiveGameSession | null
  /** GAME_END 순위 — 도착 전까지 "집계 중" 표시 */
  results?: GameResultEntry[] | null
  myUserId?: string | null
  /** POSE_SET으로 도착한 출제 포즈(랜드마크 JSON) — 벽 생성 입력 */
  challenge?: string | null
}>()
const emit = defineEmits<{
  close: []
  /** 멀티: 내가 출제자일 때 캡처한 포즈(랜드마크 JSON) → 부모가 STOMP 발신 */
  'pose-submit': [pose: string]
  /** 멀티: 판정 확정 → 부모가 finish 발신. 솔로: 토스트용 */
  finished: [payload: { score: number; grade: Grade; iou: number }]
}>()

const cfg = reactive(defaultConfig())
const pose = usePoseLandmarker()
const isMultiplayer = computed(() => !!props.session)
const isSetter = computed(
  () => !!props.session?.setterUserId && props.session.setterUserId === props.myUserId,
)

const videoRef = ref<HTMLVideoElement>()
const glCanvasRef = ref<HTMLCanvasElement>()
const viewportRef = ref<HTMLDivElement>()
const pipOverlayRef = ref<HTMLCanvasElement>()
const thumbRef = ref<HTMLCanvasElement>()

type Phase = 'idle' | 'wait' | 'setting' | 'incoming' | 'result'
const phase = ref<Phase>('idle')
const round = ref(0)
const timerSec = ref(0)
const approachPct = ref(0)
const tracked = ref(false)
const camError = ref<string | null>(null)
const judgment = ref<RoundJudgment | null>(null)
/** 접근 중 실시간 판정(스로틀) — 게이지·빨강 세그먼트용 */
const liveIou = ref(0)
const totalScore = ref(0)
const history = ref<{ round: number; grade: Grade; iou: number }[]>([])

const GRADE_COLOR: Record<Grade, string> = {
  PERFECT: 'var(--c-violet)',
  GREAT: 'var(--c-mint)',
  PASS: 'var(--c-yellow)',
  FAIL: 'var(--c-coral)',
}
const GRADE_POINTS: Record<Grade, number> = { PERFECT: 100, GREAT: 85, PASS: 70, FAIL: 0 }

const DIFFICULTIES: { key: DifficultyKey; label: string }[] = [
  { key: 'easy', label: '쉬움' },
  { key: 'normal', label: '보통' },
  { key: 'hard', label: '어려움' },
]
const difficulty = ref<DifficultyKey>('easy')

/** 난이도 = 구멍 여유(K) + 벽 속도. 다음 라운드부터 적용된다 */
function setDifficulty(key: DifficultyKey) {
  difficulty.value = key
  cfg.judge.K = cfg.difficulty[key].K
  cfg.wall.approachMs = cfg.difficulty[key].approachMs
}

const phaseLabel = computed(() => {
  if (phase.value === 'wait') return '곧 시작합니다 — 카메라 앞에 준비!'
  if (phase.value === 'setting') {
    if (!isMultiplayer.value || isSetter.value) return '포즈를 취하세요! 이 포즈가 벽 구멍이 됩니다'
    return '출제자가 포즈를 만드는 중 — 따라할 준비!'
  }
  if (phase.value === 'incoming') return '벽이 다가옵니다 — 구멍에 맞추세요!'
  if (phase.value === 'result') return isMultiplayer.value && !props.results ? '집계 중…' : '판정!'
  return tracked.value ? '시작을 누르면 3초 뒤 내 포즈가 벽이 됩니다' : '카메라 앞에 서주세요'
})

const gaugeGrade = computed<Grade>(() => {
  const iou = liveIou.value
  if (iou >= cfg.judge.grade.perfect) return 'PERFECT'
  if (iou >= cfg.judge.grade.great) return 'GREAT'
  if (iou >= cfg.judge.grade.pass) return 'PASS'
  return 'FAIL'
})

/** 원형 게이지 — 반지름 52, 둘레 기준 dashoffset */
const GAUGE_R = 52
const GAUGE_C = 2 * Math.PI * GAUGE_R
const gaugeOffset = computed(() => GAUGE_C * (1 - Math.min(liveIou.value, 100) / 100))
const gaugeTicks = computed(() => [
  { pct: cfg.judge.grade.pass, label: 'PASS' },
  { pct: cfg.judge.grade.great, label: 'GREAT' },
  { pct: cfg.judge.grade.perfect, label: 'PERFECT' },
])

// ── three.js / 게임 상태 (비반응형) ──
let stage: Stage | null = null
let rig: AvatarRig
let wall: WallHandle
let rafId = 0
let resizeObs: ResizeObserver | null = null
let stream: MediaStream | null = null
const smoother = new PoseSmoother(cfg.filter)

let setterPose: SolvedSkeleton | null = null
let holeMargin = 0
let captureAt = 0
let approachStart = 0
let resultAt = 0
let lastLiveJudge = 0
const WALL_START_Z = -12

// ── 멀티 라운드 상태 (서버 타임라인 기반, -86) ──
/** 출제 페이즈 길이 — 서버 BODY_FIT_SETTING_MILLIS와 동기화 */
const SETTING_MS = 5000
/** 필터 통과된 마지막 랜드마크 — 출제 캡처(전송) 원본 */
let lastSmoothed: LandmarkPoint[] | null = null
let poseSubmitted = false
let finishedSent = false

/** 멀티: 서버 보정 시각 (게임① 패턴) */
function serverNow(): number {
  return Date.now() + (props.session?.clockOffset ?? 0)
}

/** 랜드마크 → 전송 포맷: [[x,y,z,visibility]×33], 소수 4자리 (~2KB, §9-2) */
function serializePose(lm: LandmarkPoint[]): string {
  const r = (v: number) => Math.round(v * 10000) / 10000
  return JSON.stringify(lm.map((p) => [r(p.x), r(p.y), r(p.z ?? 0), r(p.visibility ?? 0)]))
}

function parsePose(json: string): LandmarkPoint[] {
  const raw = JSON.parse(json) as number[][]
  return raw.map((p) => ({ x: p[0] ?? 0, y: p[1] ?? 0, z: p[2], visibility: p[3] }))
}

function applyDifficulty(key: string | null | undefined) {
  const k = (key ?? 'easy') as DifficultyKey
  if (cfg.difficulty[k]) setDifficulty(k)
}
/** 캠 PiP 스켈레톤 연결선 (상반신 + 힙 라인) */
const PIP_BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
]

function initThree(canvas: HTMLCanvasElement) {
  stage = createStage(canvas)
  rig = new AvatarRig(cfg.avatar)
  stage.scene.add(rig.group)
  stage.setFloorY(rig.floorY)
  wall = createWall()
  stage.scene.add(wall.mesh)
}

function startRound() {
  if (!tracked.value || phase.value === 'setting' || phase.value === 'incoming') return
  judgment.value = null
  liveIou.value = 0
  rig.setOverflow([])
  round.value += 1
  captureAt = performance.now() + 3000
  phase.value = 'setting'
}

function easeIn(t: number): number {
  return Math.pow(t, 2.5) // 막판 급가속 (UI 스펙 §7 근사)
}

/** 캡처된 출제 포즈를 좌상단 목표 썸네일에 그린다 (§6-7 — 벽이 다가오면 구멍이 안 보인다) */
function drawThumbnail(setter: SolvedSkeleton) {
  const canvas = thumbRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  drawSilhouette(ctx, setter, cfg, 0)
}

/** 실시간 판정(4Hz) — 게이지 갱신 + 삐져나온 세그먼트 즉시 빨강 (§7-4) */
function liveJudge(now: number) {
  if (setterPose && rig.lastSolved && now - lastLiveJudge > 250) {
    lastLiveJudge = now
    const live = judgeRound(rig.lastSolved, setterPose, holeMargin, cfg)
    liveIou.value = live.iou
    rig.setOverflow(live.overflow)
  }
}

function finalizeJudgment(): RoundJudgment {
  const result =
    setterPose && rig.lastSolved
      ? judgeRound(rig.lastSolved, setterPose, holeMargin, cfg)
      : { outsideRatio: 1, passed: false, iou: 0, grade: 'FAIL' as Grade, overflow: [] }
  judgment.value = result
  liveIou.value = result.iou
  rig.setOverflow(result.overflow)
  return result
}

/** 솔로 모드(개발 라우트) — 로컬 타이머 루프 */
function tickSolo(now: number) {
  if (phase.value === 'setting') {
    timerSec.value = Math.max(0, Math.ceil((captureAt - now) / 1000))
    if (now >= captureAt && rig.lastSolved) {
      setterPose = rig.lastSolved
      holeMargin = holeMarginFor(setterPose, cfg)
      wall.build(setterPose, holeMargin, cfg)
      wall.mesh.position.z = WALL_START_Z
      wall.mesh.visible = true
      drawThumbnail(setterPose)
      approachStart = now
      lastLiveJudge = 0
      phase.value = 'incoming'
    }
  } else if (phase.value === 'incoming') {
    const t = Math.min(1, (now - approachStart) / cfg.wall.approachMs)
    timerSec.value = Math.max(0, Math.ceil((cfg.wall.approachMs - (now - approachStart)) / 1000))
    approachPct.value = Math.round(t * 100)
    wall.mesh.position.z = WALL_START_Z * (1 - easeIn(t))
    liveJudge(now)

    if (t >= 1 && setterPose && rig.lastSolved) {
      const result = finalizeJudgment()
      totalScore.value += GRADE_POINTS[result.grade]
      history.value.unshift({ round: round.value, grade: result.grade, iou: result.iou })
      emit('finished', { score: GRADE_POINTS[result.grade], grade: result.grade, iou: result.iou })
      resultAt = now
      phase.value = 'result'
    }
  } else if (phase.value === 'result') {
    if (judgment.value?.passed && wall.mesh.visible) {
      wall.mesh.position.z += 0.12
      if (wall.mesh.position.z > 4) wall.mesh.visible = false
    }
    if (now - resultAt > 3000) {
      wall.mesh.visible = false
      phase.value = 'idle'
    }
  }
}

/** 멀티 모드 — 서버 타임라인(startAt=출제 시작, endAt=벽 도착)에 페이즈를 맞춘다 */
function tickMulti(now: number) {
  const s = props.session!
  const srv = serverNow()
  const settingEnd = s.startAt + SETTING_MS

  if (srv < s.startAt) {
    phase.value = 'wait'
    timerSec.value = Math.max(0, Math.ceil((s.startAt - srv) / 1000))
    return
  }
  if (srv < settingEnd) {
    phase.value = 'setting'
    timerSec.value = Math.max(0, Math.ceil((settingEnd - srv) / 1000))
    // 출제자: 마감 직전 프레임을 캡처해 전송 — 서버가 POSE_SET으로 전원에게 재방송
    if (isSetter.value && !poseSubmitted && srv >= settingEnd - 150 && lastSmoothed) {
      poseSubmitted = true
      emit('pose-submit', serializePose(lastSmoothed))
    }
    return
  }
  if (srv < s.endAt) {
    phase.value = 'incoming'
    timerSec.value = Math.max(0, Math.ceil((s.endAt - srv) / 1000))
    const t = Math.min(1, (srv - settingEnd) / Math.max(1, s.endAt - settingEnd))
    approachPct.value = Math.round(t * 100)
    if (wall.mesh.visible) wall.mesh.position.z = WALL_START_Z * (1 - easeIn(t))
    liveJudge(now)
    return
  }
  // 벽 도착 — 프레임 1장 판정, 1회만 제출 (서버도 최초 1회만 수리)
  if (!finishedSent) {
    finishedSent = true
    const result = finalizeJudgment()
    emit('finished', { score: GRADE_POINTS[result.grade], grade: result.grade, iou: result.iou })
  }
  phase.value = 'result'
  if (judgment.value?.passed && wall.mesh.visible) {
    wall.mesh.position.z += 0.12
    if (wall.mesh.position.z > 4) wall.mesh.visible = false
  }
}

function renderLoop() {
  rafId = requestAnimationFrame(renderLoop)
  if (!stage) return
  if (isMultiplayer.value && props.session) tickMulti(performance.now())
  else tickSolo(performance.now())
  const camera = stage.camera
  camera.position.x += (rig.group.position.x * 0.35 - camera.position.x) * 0.06
  camera.lookAt(0, -0.5, 0)
  stage.render()
}

// 멀티: 세션 시작 → 난이도 적용 + 라운드 상태 초기화
watch(
  () => props.session,
  (s) => {
    if (!s) return
    applyDifficulty(s.difficulty)
    judgment.value = null
    liveIou.value = 0
    setterPose = null
    poseSubmitted = false
    finishedSent = false
    round.value = 1
    if (wall) wall.mesh.visible = false
    rig?.setOverflow([])
  },
  { immediate: true },
)

// 멀티: POSE_SET 도착 → 전원이 같은 렌더 함수로 같은 벽을 만든다 (§9-2)
watch(
  () => props.challenge,
  (ch) => {
    if (!ch || !isMultiplayer.value || !wall) return
    try {
      const normalized = normalizePose(parsePose(ch), true)
      if (!normalized) return
      setterPose = solveSkeleton(normalized, cfg.avatar, createSkeletonState())
      holeMargin = holeMarginFor(setterPose, cfg)
      wall.build(setterPose, holeMargin, cfg)
      wall.mesh.position.z = WALL_START_Z
      wall.mesh.visible = true
      drawThumbnail(setterPose)
      lastLiveJudge = 0
    } catch {
      /* 손상된 포즈 payload — 벽 없이 진행되면 도착 시 FAIL 처리된다 */
    }
  },
)

/** 캠 PiP 스켈레톤 오버레이 — "내 몸 → 인식 → 아바타" 인과 증명 (§6-3) */
function drawPip(lm: LandmarkPoint[] | null) {
  const canvas = pipOverlayRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!lm) return
  const px = (p: LandmarkPoint): [number, number] => [p.x * canvas.width, p.y * canvas.height]
  ctx.strokeStyle = '#48c8a4'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  for (const [a, b] of PIP_BONES) {
    const pa = lm[a]
    const pb = lm[b]
    if (!pa || !pb || (pa.visibility ?? 0) < 0.3 || (pb.visibility ?? 0) < 0.3) continue
    ctx.beginPath()
    ctx.moveTo(...px(pa))
    ctx.lineTo(...px(pb))
    ctx.stroke()
  }
  ctx.fillStyle = '#48c8a4'
  for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24]) {
    const p = lm[i]
    if (!p || (p.visibility ?? 0) < 0.3) continue
    ctx.beginPath()
    ctx.arc(...px(p), 4, 0, Math.PI * 2)
    ctx.fill()
  }
}

function onPose(result: PoseLandmarkerResult) {
  const lm = result.landmarks[0]
  tracked.value = !!lm
  drawPip(lm ?? null)
  if (!lm) return
  const smoothed = smoother.apply(lm, performance.now())
  lastSmoothed = smoothed
  const normalized = normalizePose(smoothed, true) // 셀프뷰 표준 — 미러 고정
  if (normalized) rig.updatePose(normalized)
}

onMounted(async () => {
  const canvas = glCanvasRef.value!
  const viewport = viewportRef.value!
  initThree(canvas)

  const resize = () => {
    const w = viewport.clientWidth
    const h = viewport.clientHeight
    if (!w || !h || !stage) return
    stage.setSize(w, h)
  }
  resizeObs = new ResizeObserver(resize)
  resizeObs.observe(viewport)
  resize()
  renderLoop()

  // 멀티(게임룸): 셀프 타일 비디오를 재사용 — 카메라를 새로 열지 않는다 (S15P11A706-33 패턴)
  if (props.video && isMultiplayer.value) {
    const pip = videoRef.value!
    pip.srcObject = props.video.srcObject
    pip.play().catch(() => {})
    await pose.start(props.video, onPose)
    return
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    })
  } catch {
    camError.value = '카메라를 열 수 없어요'
    return
  }
  const video = videoRef.value!
  video.srcObject = stream
  await video.play().catch(() => {})
  await pose.start(video, onPose)
})

/** 게임룸이 게임 화면을 captureStream으로 송출할 수 있게 3D 캔버스를 노출 (게임① 패턴) */
defineExpose({ canvas: glCanvasRef })

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  stream?.getTracks().forEach((t) => t.stop())
  resizeObs?.disconnect()
  rig?.dispose()
  wall?.dispose()
  stage?.dispose()
  stage = null
})
</script>

<template>
  <div class="game" :class="{ embedded: isMultiplayer }">
    <header class="topbar">
      <span class="pill round-pill">{{ round }} 라운드</span>
      <span class="pill phase-pill">{{ camError ?? phaseLabel }}</span>
      <span
        v-if="phase === 'wait' || phase === 'setting' || phase === 'incoming'"
        class="pill timer-pill"
        :class="{ urgent: phase === 'incoming' && timerSec <= 2 }"
        >00:{{ String(timerSec).padStart(2, '0') }}</span
      >
      <span class="pill setter-pill">
        👑 출제자 {{ isMultiplayer ? (isSetter ? '나!' : '상대') : '나 (솔로)' }}
      </span>
    </header>

    <div class="main">
      <div class="center">
        <div ref="viewportRef" class="viewport">
          <canvas ref="glCanvasRef" class="gl-canvas"></canvas>

          <canvas v-show="phase === 'incoming'" ref="thumbRef" class="thumb" width="96" height="96"></canvas>

          <div class="pip">
            <video ref="videoRef" class="pip-video mirrored" muted playsinline></video>
            <canvas ref="pipOverlayRef" class="pip-overlay mirrored" width="640" height="480"></canvas>
            <span class="pip-label">● 내 캠 · {{ tracked ? '인식 중' : '인식 안 됨' }}</span>
          </div>

          <div v-if="phase === 'setting'" class="countdown">{{ timerSec }}</div>

          <div v-if="judgment" class="grade-pop" :style="{ color: GRADE_COLOR[judgment.grade] }">
            <strong>{{ judgment.grade }}</strong>
            <span>일치율 {{ judgment.iou.toFixed(0) }}%</span>
          </div>

          <div v-if="phase === 'incoming'" class="approach-bar" :class="{ urgent: timerSec <= 2 }">
            <div class="fill" :style="{ width: approachPct + '%' }"></div>
          </div>
        </div>
      </div>

      <aside class="side">
        <div class="card gauge-card">
          <h3>통과율</h3>
          <svg viewBox="0 0 120 120" class="gauge">
            <circle cx="60" cy="60" :r="GAUGE_R" class="track" />
            <circle
              cx="60"
              cy="60"
              :r="GAUGE_R"
              class="fill"
              :stroke="GRADE_COLOR[gaugeGrade]"
              :stroke-dasharray="GAUGE_C"
              :stroke-dashoffset="gaugeOffset"
            />
            <line
              v-for="tick in gaugeTicks"
              :key="tick.label"
              x1="60"
              y1="4"
              x2="60"
              y2="12"
              class="tick"
              :transform="`rotate(${(tick.pct / 100) * 360} 60 60)`"
            />
            <text x="60" y="64" class="gauge-num" :fill="GRADE_COLOR[gaugeGrade]">
              {{ Math.round(liveIou) }}<tspan class="pct">%</tspan>
            </text>
          </svg>
          <p class="gauge-hint">PASS {{ cfg.judge.grade.pass }} · GREAT {{ cfg.judge.grade.great }} · PERFECT {{ cfg.judge.grade.perfect }}</p>
        </div>

        <div class="card score-card">
          <h3>내 점수</h3>
          <p class="score">{{ totalScore }}<small>점</small></p>
          <ul class="history">
            <li v-for="h in history.slice(0, 5)" :key="h.round">
              <span>{{ h.round }}R</span>
              <b :style="{ color: GRADE_COLOR[h.grade] }">{{ h.grade }}</b>
              <span>{{ h.iou.toFixed(0) }}%</span>
            </li>
          </ul>
        </div>

        <button
          v-if="!isMultiplayer"
          class="btn-start"
          :disabled="!tracked || phase === 'setting' || phase === 'incoming'"
          @click="startRound"
        >
          ▶ {{ round === 0 ? '시작' : '다음 라운드' }}
        </button>

        <div v-if="!isMultiplayer" class="card diff-card">
          <h3>난이도</h3>
          <div class="diff-buttons">
            <button
              v-for="d in DIFFICULTIES"
              :key="d.key"
              class="diff-btn"
              :class="{ active: difficulty === d.key }"
              @click="setDifficulty(d.key)"
            >
              {{ d.label }} {{ (cfg.difficulty[d.key].approachMs / 1000).toFixed(0) }}s
            </button>
          </div>
        </div>
      </aside>
    </div>

    <!-- 멀티: GAME_END 순위 오버레이 -->
    <div v-if="results" class="results-overlay">
      <div class="results-card">
        <h2>🏁 라운드 결과</h2>
        <ol class="results-list">
          <li v-for="r in results" :key="r.userId" :class="{ me: r.userId === myUserId }">
            <span class="rank">{{ r.rank }}위</span>
            <span class="name">{{ r.nickname }}</span>
            <b class="pts">{{ r.score }}점</b>
          </li>
        </ol>
        <button class="btn-start" @click="emit('close')">닫기</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.game {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100vh;
  padding: 16px;
  background: var(--c-cream);
  color: var(--c-ink);
  font-family: var(--font-pixel);
}
/* 게임룸 셀프 타일 위 오버레이(멀티) — 자체 페이지가 아니라 타일을 채운다 */
.game.embedded {
  position: absolute;
  inset: 0;
  height: 100%;
  z-index: 5;
  border-radius: inherit;
}
.results-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  background: rgba(56, 38, 61, 0.45);
}
.results-card {
  min-width: 300px;
  padding: 20px;
  background: var(--c-paper);
  border: var(--border-thick);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.results-card h2 {
  font-size: 18px;
  font-weight: 800;
}
.results-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.results-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: var(--border);
  border-radius: var(--radius-sm);
  background: var(--c-paper);
  font-size: 14px;
}
.results-list li.me {
  background: var(--c-mint-soft);
}
.results-list .rank {
  font-weight: 800;
  width: 34px;
}
.results-list .name {
  flex: 1;
}
.results-list .pts {
  font-variant-numeric: tabular-nums;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.pill {
  padding: 7px 14px;
  background: var(--c-paper);
  border: var(--border);
  border-radius: 999px;
  box-shadow: var(--shadow-sm);
  font-size: 14px;
  font-weight: 700;
}
.round-pill {
  background: var(--c-mint-soft);
}
.phase-pill {
  flex: 1;
  text-align: center;
}
.timer-pill {
  font-variant-numeric: tabular-nums;
  background: var(--c-paper);
}
.timer-pill.urgent {
  background: var(--c-coral);
  color: #fff;
}
.setter-pill {
  background: var(--c-yellow);
}
.main {
  display: flex;
  gap: 14px;
  flex: 1;
  min-height: 0;
}
.center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  border: var(--border-thick);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  background: #0d0c24;
}
/* 3D 캔버스에만 — .viewport canvas로 잡으면 썸네일·PiP 오버레이 캔버스까지 늘어난다 */
.gl-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.thumb {
  position: absolute;
  top: 12px;
  left: 12px;
  width: 96px;
  height: 96px;
  background: rgba(13, 12, 36, 0.7);
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-radius: var(--radius-sm);
}
.pip {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 180px;
  border: var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  background: #000;
}
.pip-video {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
}
.pip-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: calc(100% - 22px);
  pointer-events: none;
}
.mirrored {
  transform: scaleX(-1);
}
.pip-label {
  display: block;
  padding: 3px 8px;
  background: var(--c-paper);
  font-size: 11px;
  font-weight: 700;
}
.countdown {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 120px;
  font-weight: 800;
  color: var(--c-yellow);
  text-shadow: 4px 4px 0 var(--c-ink);
  pointer-events: none;
}
.grade-pop {
  position: absolute;
  top: 20px;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  pointer-events: none;
}
.grade-pop strong {
  font-size: 54px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-shadow: 4px 4px 0 rgba(0, 0, 0, 0.55);
}
.grade-pop span {
  font-size: 14px;
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.approach-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 8px;
  background: rgba(255, 255, 255, 0.12);
}
.approach-bar .fill {
  height: 100%;
  background: var(--c-mint);
  transition: width 100ms linear;
}
.approach-bar.urgent .fill {
  background: var(--c-coral);
}
.side {
  width: 250px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
.card {
  padding: 14px;
  background: var(--c-paper);
  border: var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-md);
}
.card h3 {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--c-muted);
}
.gauge {
  display: block;
  width: 150px;
  margin: 0 auto;
}
.gauge .track {
  fill: none;
  stroke: var(--c-mint-soft);
  stroke-width: 11;
}
.gauge .fill {
  fill: none;
  stroke-width: 11;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 60px 60px;
  transition: stroke-dashoffset 250ms linear, stroke 250ms linear;
}
.gauge .tick {
  stroke: var(--c-ink);
  stroke-width: 2;
}
.gauge-num {
  font-size: 30px;
  font-weight: 800;
  text-anchor: middle;
  font-variant-numeric: tabular-nums;
}
.gauge-num .pct {
  font-size: 14px;
}
.gauge-hint {
  margin-top: 6px;
  text-align: center;
  font-size: 11px;
  color: var(--c-muted);
}
.score {
  font-size: 30px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.score small {
  font-size: 14px;
  margin-left: 2px;
}
.history {
  margin-top: 8px;
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.history li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}
.btn-start {
  padding: 13px;
  background: var(--c-green);
  color: #fff;
  border: var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  font-family: inherit;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  transition: var(--t-fast);
}
.btn-start:hover:not(:disabled) {
  transform: translate(-1px, -1px);
  box-shadow: var(--shadow-lg);
}
.btn-start:active:not(:disabled) {
  transform: translate(2px, 2px);
  box-shadow: none;
}
.btn-start:disabled {
  opacity: 0.5;
  cursor: default;
}
.diff-buttons {
  display: flex;
  gap: 6px;
}
.diff-btn {
  flex: 1;
  padding: 8px 4px;
  background: var(--c-paper);
  border: var(--border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: var(--t-fast);
}
.diff-btn.active {
  background: var(--c-mint);
  color: #fff;
  box-shadow: var(--shadow-sm);
}
</style>
