<script setup lang="ts">
/**
 * 벽 랩 (/dev/wall-lab) — 게임④ 단계 B: 벽·구멍·판정 1인 로컬 플레이 (S15P11A706-47, -46).
 *
 * 루프: [포즈 캡처 3초] 내 포즈가 벽 구멍이 된다 → [접근 7초] 벽이 다가온다,
 * 같은 구멍에 다시 몸을 끼운다 → [판정] 도달 순간 프레임 1장 — 통과(구멍 기준)와
 * 등급(원본 IoU)을 따로 계산 (§7-1) → 삐져나온 세그먼트는 빨강 (§7-4).
 *
 * 벽 구멍은 CSG가 아니라 alphaMap(§8) — 실루엣 래스터라이저가 그린 캔버스를
 * 그대로 텍스처로 쓰고, 판정 마스크도 같은 함수로 그린다.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as THREE from 'three'
import { usePoseLandmarker, type PoseLandmarkerResult } from '@/composables/usePoseLandmarker'
import { defaultConfig, type DifficultyKey, type Grade } from './config'
import { PoseSmoother } from './oneEuro'
import { AvatarRig } from './avatarRig'
import { normalizePose, type SolvedSkeleton } from './skeleton'
import { holeMarginFor, judgeRound, type RoundJudgment } from './judge'
import { createStage, type Stage } from './stage'
import { createWall, type WallHandle } from './wall'

const cfg = reactive(defaultConfig())
const pose = usePoseLandmarker()

const videoRef = ref<HTMLVideoElement>()
const glCanvasRef = ref<HTMLCanvasElement>()
const stageRef = ref<HTMLDivElement>()

type Phase = 'idle' | 'pose' | 'approach' | 'result'
const phase = ref<Phase>('idle')
const countdown = ref(0)
const approachPct = ref(0)
const tracked = ref(false)
const camError = ref<string | null>(null)
const judgment = ref<RoundJudgment | null>(null)

const GRADE_COLOR: Record<Grade, string> = {
  PERFECT: '#22D3EE',
  GREAT: '#B6F03C',
  PASS: '#FBBF24',
  FAIL: '#FF4D6A',
}

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

const statusText = computed(() => {
  if (camError.value) return camError.value
  if (pose.error.value) return pose.error.value
  if (pose.isLoading.value) return '포즈 모델 로딩 중…'
  if (!tracked.value) return '사람이 인식되지 않았어요'
  if (phase.value === 'pose') return '구멍이 될 포즈를 취하세요!'
  if (phase.value === 'approach') return '벽이 다가옵니다 — 구멍에 몸을 끼우세요!'
  return '시작을 누르면 3초 뒤 내 포즈가 벽 구멍이 됩니다'
})

// ── three.js 씬 ──
let stage: Stage | null = null
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let rig: AvatarRig
let wall: WallHandle
let rafId = 0
let resizeObs: ResizeObserver | null = null
let stream: MediaStream | null = null

const smoother = new PoseSmoother(cfg.filter)

// 라운드 상태 (반응형 불필요)
let setterPose: SolvedSkeleton | null = null
let holeMargin = 0
let captureAt = 0
let approachStart = 0
const WALL_START_Z = -12

function initThree(canvas: HTMLCanvasElement) {
  // 공용 무대(stage.ts) — 조명·IBL·포디움·안개는 랩과 본 게임이 공유한다
  stage = createStage(canvas)
  scene = stage.scene
  camera = stage.camera

  rig = new AvatarRig(cfg.avatar)
  scene.add(rig.group)
  stage.setFloorY(rig.floorY)

  wall = createWall()
  scene.add(wall.mesh)
}

function startRound() {
  if (!tracked.value || phase.value === 'pose' || phase.value === 'approach') return
  judgment.value = null
  rig.setOverflow([])
  captureAt = performance.now() + 3000
  phase.value = 'pose'
}

function easeIn(t: number): number {
  return Math.pow(t, 2.5) // 막판 급가속 (UI 스펙 §7 근사)
}

function tick(now: number) {
  if (phase.value === 'pose') {
    countdown.value = Math.max(0, Math.ceil((captureAt - now) / 1000))
    if (now >= captureAt && rig.lastSolved) {
      setterPose = rig.lastSolved
      holeMargin = holeMarginFor(setterPose, cfg)
      wall.build(setterPose, holeMargin, cfg)
      wall.mesh.position.z = WALL_START_Z
      wall.mesh.visible = true
      approachStart = now
      phase.value = 'approach'
    }
  } else if (phase.value === 'approach') {
    const t = Math.min(1, (now - approachStart) / cfg.wall.approachMs)
    approachPct.value = Math.round(t * 100)
    wall.mesh.position.z = WALL_START_Z * (1 - easeIn(t))
    if (t >= 1 && setterPose && rig.lastSolved) {
      const result = judgeRound(rig.lastSolved, setterPose, holeMargin, cfg)
      judgment.value = result
      rig.setOverflow(result.overflow)
      phase.value = 'result'
    }
  } else if (phase.value === 'result') {
    // 통과하면 벽이 아바타를 지나쳐 뒤로 사라진다
    if (judgment.value?.passed && wall.mesh.visible) {
      wall.mesh.position.z += 0.12
      if (wall.mesh.position.z > 4) wall.mesh.visible = false
    }
  }
}

function renderLoop() {
  rafId = requestAnimationFrame(renderLoop)
  if (!stage) return
  tick(performance.now())
  // 패럴랙스: 아바타가 기울면 카메라가 살짝 따라 돈다 — 시점 변화가 입체감을 만든다
  camera.position.x += (rig.group.position.x * 0.35 - camera.position.x) * 0.06
  camera.lookAt(0, -0.5, 0)
  stage.render()
}

function onPose(result: PoseLandmarkerResult) {
  const lm = result.landmarks[0]
  tracked.value = !!lm
  if (!lm) return
  const smoothed = smoother.apply(lm, performance.now())
  const normalized = normalizePose(smoothed, true) // 벽 게임은 미러 고정 (셀프뷰 표준)
  if (normalized) rig.updatePose(normalized)
}

onMounted(async () => {
  const canvas = glCanvasRef.value!
  const stageEl = stageRef.value!
  initThree(canvas)

  const resize = () => {
    const w = stageEl.clientWidth
    const h = stageEl.clientHeight
    if (!w || !h || !stage) return
    stage.setSize(w, h)
  }
  resizeObs = new ResizeObserver(resize)
  resizeObs.observe(stageEl)
  resize()
  renderLoop()

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    })
  } catch {
    camError.value = '카메라를 열 수 없어요 — 브라우저 권한을 확인해 주세요'
    return
  }
  const video = videoRef.value!
  video.srcObject = stream
  await video.play().catch(() => {})
  await pose.start(video, onPose)
})

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
  <div class="lab">
    <header class="bar">
      <h1>벽 랩 <small>게임④ 단계 B · S15P11A706-47/-46</small></h1>
      <p class="status">{{ statusText }}</p>
    </header>

    <div class="body">
      <div ref="stageRef" class="stage">
        <canvas ref="glCanvasRef"></canvas>
        <div v-if="phase === 'pose' && countdown > 0" class="countdown">{{ countdown }}</div>
        <div v-if="phase === 'approach'" class="approach-bar">
          <div class="fill" :style="{ width: approachPct + '%' }"></div>
        </div>
        <div v-if="judgment" class="grade" :style="{ color: GRADE_COLOR[judgment.grade] }">
          <strong>{{ judgment.grade }}</strong>
          <span
            >일치율 {{ judgment.iou.toFixed(0) }}% · 삐져나옴
            {{ (judgment.outsideRatio * 100).toFixed(1) }}%</span
          >
        </div>
      </div>

      <aside class="panel">
        <video ref="videoRef" class="cam mirrored" muted playsinline></video>
        <button class="btn primary" :disabled="!tracked || phase === 'pose' || phase === 'approach'" @click="startRound">
          {{ phase === 'result' ? '다시 도전' : '시작 (3초 뒤 포즈 캡처)' }}
        </button>
        <section>
          <h2>난이도</h2>
          <div class="diff-buttons">
            <button
              v-for="d in DIFFICULTIES"
              :key="d.key"
              class="btn"
              :class="{ active: difficulty === d.key }"
              @click="setDifficulty(d.key)"
            >
              {{ d.label }}
            </button>
          </div>
          <label>
            <span
              >면적비 K <b>×{{ cfg.judge.K.toFixed(2) }}</b></span
            >
            <input v-model.number="cfg.judge.K" type="range" min="1.1" max="2.5" step="0.05" />
          </label>
          <p class="hint">
            구멍 면적 = 포즈 면적 × K. 다음 라운드부터 적용. 통과 여부는 구멍 기준,
            등급은 원본 실루엣 IoU 기준 — 유령 실루엣에 맞추면 PERFECT.
          </p>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.lab {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0a0a1f;
  color: #fff;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid #2a2850;
}
.bar h1 {
  font-size: 20px;
  font-weight: 700;
}
.bar h1 small {
  margin-left: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #9a97c0;
}
.status {
  font-size: 14px;
  color: #9a97c0;
}
.body {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 16px;
  padding: 16px;
}
.stage {
  position: relative;
  flex: 1;
  min-width: 0;
  border-radius: 16px;
  overflow: hidden;
  background: #0d0c24;
}
.stage canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.countdown {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 120px;
  font-weight: 800;
  color: #b6f03c;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}
.approach-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
}
.approach-bar .fill {
  height: 100%;
  background: #ff4d6a;
  transition: width 100ms linear;
}
.grade {
  position: absolute;
  top: 24px;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  pointer-events: none;
}
.grade strong {
  font-size: 56px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
}
.grade span {
  font-size: 15px;
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.panel {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}
.cam {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 12px;
  background: #14132e;
  object-fit: cover;
}
.mirrored {
  transform: scaleX(-1);
}
section h2 {
  font-size: 13px;
  font-weight: 700;
  color: #9a97c0;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
label {
  display: block;
  margin-bottom: 10px;
  font-size: 13px;
}
label span {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  color: #9a97c0;
}
label span b {
  color: #fff;
  font-variant-numeric: tabular-nums;
}
label input[type='range'] {
  width: 100%;
  accent-color: #b6f03c;
}
.hint {
  font-size: 12px;
  color: #6b688f;
  line-height: 1.5;
}
.btn {
  padding: 10px 12px;
  border: 1px solid #2a2850;
  border-radius: 12px;
  background: #14132e;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
.btn.primary {
  background: #b6f03c;
  border-color: #b6f03c;
  color: #0a0a1f;
  font-weight: 700;
}
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.diff-buttons {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.diff-buttons .btn {
  flex: 1;
}
.diff-buttons .btn.active {
  border-color: #b6f03c;
  color: #b6f03c;
  font-weight: 700;
}
</style>
