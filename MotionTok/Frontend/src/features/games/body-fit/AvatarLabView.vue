<script setup lang="ts">
/**
 * 아바타 랩 (/dev/avatar-lab) — 게임④ 단계 A 프로토타입 + 캘리브레이션 도구 (S15P11A706-136).
 *
 * 웹캠 → PoseLandmarker(33점) → One Euro Filter → 정규화 → three.js 캡슐 아바타.
 * 판단 목표: "아바타가 떨지 않고, 지연이 체감되지 않는가" (기획 초안 §11 — A가 판단 지점).
 *
 * 도구:
 *  - 튜닝 슬라이더: config.ts의 설정 객체를 직접 바인딩 (UI 스펙 §10)
 *  - FPS: MediaPipe 추론 시간과 three.js 렌더 시간을 분리 표기 (병목 판별)
 *  - 녹화/JSON export/재생: 필터 통과 "전" 원본 랜드마크를 저장 — 같은 녹화본으로
 *    필터 파라미터를 바꿔가며 재생해 오프라인 A/B 튜닝이 가능하다 (UI 스펙 §11)
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as THREE from 'three'
import {
  preloadPoseLandmarker,
  usePoseLandmarker,
  type PoseLandmarkerResult,
} from '@/composables/usePoseLandmarker'
import { defaultConfig } from './config'
import { PoseSmoother } from './oneEuro'
import { AvatarRig, normalizePose, type LandmarkPoint } from './avatarRig'

interface Frame {
  /** 녹화 시작 기준 경과 ms */
  t: number
  lm: LandmarkPoint[]
}

const cfg = reactive(defaultConfig())
const pose = usePoseLandmarker()

const videoRef = ref<HTMLVideoElement>()
const glCanvasRef = ref<HTMLCanvasElement>()
const stageRef = ref<HTMLDivElement>()
/** 캠 PiP 위 랜드마크 디버그 오버레이 — 어디가 얼마나 인식되는지 점으로 표시 */
const overlayRef = ref<HTMLCanvasElement>()

const mirror = ref(true)
const mode = ref<'live' | 'replay'>('live')
const tracked = ref(false)
const camError = ref<string | null>(null)
const loadProgress = ref(0)

const recording = ref(false)
const recCount = ref(0)
const hasClip = ref(false)

const stats = reactive({ inferMs: '–', poseFps: 0, renderMs: '–', renderFps: 0 })
/** 부위별 랜드마크 신뢰도(좌우 평균) — 하반신이 왜 안 잡히는지 눈으로 확인용 */
const vis = reactive({ shoulder: '–', elbow: '–', wrist: '–', hip: '–', knee: '–' })

const statusText = computed(() => {
  if (camError.value) return camError.value
  if (pose.error.value) return pose.error.value
  if (pose.isLoading.value) return `포즈 모델 로딩 중… ${Math.round(loadProgress.value * 100)}%`
  if (mode.value === 'replay') return '녹화 재생 중 (라이브 입력 무시)'
  if (recording.value) return `녹화 중 — ${recCount.value} 프레임`
  return tracked.value ? '라이브 추적 중' : '사람이 인식되지 않았어요 — 상반신이 보이게 앉아주세요'
})

// ── three.js 씬 (반응형으로 만들 필요 없는 것들은 전부 plain 변수) ──
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let ground: THREE.Mesh
let rig: AvatarRig
let rafId = 0
let resizeObs: ResizeObserver | null = null
let stream: MediaStream | null = null
let statsTimer = 0

const smoother = new PoseSmoother(cfg.filter)

// 성능 카운터 — 500ms 창으로 집계해서 stats에 밀어넣는다
let inferSum = 0
let inferN = 0
let renderSum = 0
let renderN = 0

/** 마지막 원본 랜드마크 — 신뢰도 표기(flushStats)용 */
let lastLm: LandmarkPoint[] | null = null

// 녹화·재생 버퍼 (프레임 배열은 반응형에 넣지 않는다 — 30fps push에 프록시 비용 불필요)
let recFrames: Frame[] = []
let recStart = 0
let clip: Frame[] | null = null
let replayStart = 0
let replayPtr = 0
let lastReplayT = Infinity

function initThree(canvas: HTMLCanvasElement) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0d0c24) // --bg-sunken (UI 스펙 §1-1)

  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50)
  camera.position.set(0, 0.3, 4.8)
  camera.lookAt(0, -0.5, 0)

  // 순백 매트 재질이 살아나는 부드러운 조명 (§5-2)
  scene.add(new THREE.HemisphereLight(0xbdc7ff, 0x1a1836, 1.1))
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(2.5, 4, 3)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = -3
  sun.shadow.camera.right = 3
  sun.shadow.camera.top = 3
  sun.shadow.camera.bottom = -3
  sun.shadow.camera.near = 0.5
  sun.shadow.camera.far = 12
  scene.add(sun)
  // 림 라이트 — 뒤쪽 역광이 캡슐 윤곽을 배경에서 띄운다 (입체감)
  const rim = new THREE.DirectionalLight(0x7f9dff, 1.4)
  rim.position.set(-2, 2.5, -3.5)
  scene.add(rim)

  rig = new AvatarRig(cfg.avatar)
  scene.add(rig.group)

  // 접지 그림자만 받는 투명 바닥
  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = rig.floorY
  ground.receiveShadow = true
  scene.add(ground)
}

function renderLoop() {
  rafId = requestAnimationFrame(renderLoop)
  if (!renderer) return
  if (mode.value === 'replay') stepReplay(performance.now())
  // 패럴랙스: 아바타가 기울면 카메라가 살짝 따라 돈다 — 시점 변화가 입체감을 만든다
  camera.position.x += (rig.group.position.x * 0.35 - camera.position.x) * 0.06
  camera.lookAt(0, -0.5, 0)
  const t0 = performance.now()
  renderer.render(scene, camera)
  renderSum += performance.now() - t0
  renderN++
}

function flushStats() {
  stats.inferMs = inferN ? (inferSum / inferN).toFixed(1) : '–'
  stats.renderMs = renderN ? (renderSum / renderN).toFixed(2) : '–'
  stats.poseFps = inferN * 2 // 500ms 창 → ×2
  stats.renderFps = renderN * 2
  inferSum = inferN = renderSum = renderN = 0

  const pair = (a: number, b: number) => {
    if (!lastLm) return '–'
    const va = lastLm[a]?.visibility ?? 0
    const vb = lastLm[b]?.visibility ?? 0
    return ((va + vb) / 2).toFixed(2)
  }
  vis.shoulder = pair(11, 12)
  vis.elbow = pair(13, 14)
  vis.wrist = pair(15, 16)
  vis.hip = pair(23, 24)
  vis.knee = pair(25, 26)
}

/** 신뢰도별 점 색 — 초록: 판정 사용 / 노랑: 경계(어깨 기준 미달) / 빨강: 무시(MIN_VIS 미만) */
function drawOverlay(lm: LandmarkPoint[] | null) {
  const canvas = overlayRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!lm) return
  for (const p of lm) {
    const v = p.visibility ?? 0
    ctx.fillStyle = v >= 0.5 ? '#b6f03c' : v >= 0.3 ? '#fbbf24' : '#ff4d6a'
    ctx.beginPath()
    ctx.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** 랜드마크 한 세트를 필터 → 정규화 → 리그에 반영 */
function feed(lm: LandmarkPoint[], tMs: number) {
  const smoothed = smoother.apply(lm, tMs)
  const normalized = normalizePose(smoothed, mirror.value)
  if (normalized) rig.updatePose(normalized)
}

function onPose(result: PoseLandmarkerResult, inferenceMs: number) {
  inferSum += inferenceMs
  inferN++
  const lm = result.landmarks[0]
  tracked.value = !!lm
  lastLm = lm ?? null
  drawOverlay(lastLm)
  if (!lm) return
  if (recording.value) {
    // 필터 "전" 원본을 저장한다 — 재생 시 그때그때의 필터 설정을 다시 통과시키기 위해
    recFrames.push({
      t: performance.now() - recStart,
      lm: lm.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })),
    })
    recCount.value = recFrames.length
  }
  if (mode.value === 'live') feed(lm, performance.now())
}

// ── 녹화 / 내보내기 / 재생 ──────────────────────
function toggleRecording() {
  if (recording.value) {
    recording.value = false
    if (recFrames.length) {
      clip = recFrames
      hasClip.value = true
    }
  } else {
    recFrames = []
    recCount.value = 0
    recStart = performance.now()
    recording.value = true
  }
}

function exportJson() {
  if (!clip) return
  const data = {
    version: 1,
    createdAt: new Date().toISOString(),
    frames: clip.map((f) => ({
      t: Math.round(f.t * 10) / 10,
      lm: f.lm.map((p) => [p.x, p.y, p.z ?? 0, p.visibility ?? 0]),
    })),
  }
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `pose-rec-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

async function importJson(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const data = JSON.parse(await file.text()) as { frames?: { t: number; lm: number[][] }[] }
    const frames: Frame[] = (data.frames ?? []).map((f) => ({
      t: f.t,
      lm: f.lm.map((p) => ({ x: p[0] ?? 0, y: p[1] ?? 0, z: p[2], visibility: p[3] })),
    }))
    if (!frames.length) throw new Error('empty recording')
    clip = frames
    hasClip.value = true
    startReplay()
  } catch {
    camError.value = '녹화 JSON을 읽지 못했어요 — 이 랩에서 내보낸 파일인지 확인해 주세요'
    setTimeout(() => (camError.value = null), 4000)
  }
}

function startReplay() {
  if (!clip?.length) return
  if (recording.value) toggleRecording()
  mode.value = 'replay'
  smoother.reset()
  replayStart = performance.now()
  replayPtr = 0
  lastReplayT = Infinity
}

function stopReplay() {
  mode.value = 'live'
  smoother.reset()
}

function toggleReplay() {
  if (mode.value === 'replay') stopReplay()
  else startReplay()
}

function stepReplay(now: number) {
  const frames = clip
  if (!frames?.length) return
  const duration = Math.max(frames[frames.length - 1]!.t, 1)
  const t = (now - replayStart) % duration
  if (t < lastReplayT) {
    // 루프 한 바퀴 — 필터 시간축이 끊기므로 리셋
    replayPtr = 0
    smoother.reset()
  }
  lastReplayT = t
  while (replayPtr < frames.length - 1 && frames[replayPtr]!.t < t) replayPtr++
  feed(frames[replayPtr]!.lm, now)
}

// ── 라이프사이클 ────────────────────────────────
watch(cfg.avatar, () => {
  rig.applyConfig(cfg.avatar)
  ground.position.y = rig.floorY
})
// cfg.filter는 PoseSmoother가 참조로 들고 있어 즉시 반영 — watch 불필요.
// 미러 전환은 필터 상태만 끊어준다 (x가 점프하므로)
watch(mirror, () => smoother.reset())

onMounted(async () => {
  const canvas = glCanvasRef.value!
  const stage = stageRef.value!
  initThree(canvas)

  const resize = () => {
    const w = stage.clientWidth
    const h = stage.clientHeight
    if (!w || !h || !renderer) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resizeObs = new ResizeObserver(resize)
  resizeObs.observe(stage)
  resize()
  renderLoop()
  statsTimer = window.setInterval(flushStats, 500)

  preloadPoseLandmarker((f) => (loadProgress.value = f))
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
  window.clearInterval(statsTimer)
  cancelAnimationFrame(rafId)
  stream?.getTracks().forEach((t) => t.stop())
  resizeObs?.disconnect()
  rig?.dispose()
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <div class="lab">
    <header class="bar">
      <h1>아바타 랩 <small>게임④ 단계 A · S15P11A706-136</small></h1>
      <div class="stats">
        <span
          >추론 <b>{{ stats.inferMs }}</b> ms · <b>{{ stats.poseFps }}</b> fps</span
        >
        <span
          >렌더 <b>{{ stats.renderMs }}</b> ms · <b>{{ stats.renderFps }}</b> fps</span
        >
      </div>
    </header>

    <div class="body">
      <div ref="stageRef" class="stage">
        <canvas ref="glCanvasRef"></canvas>
      </div>

      <aside class="panel">
        <div class="cam-wrap">
          <video ref="videoRef" class="cam" :class="{ mirrored: mirror }" muted playsinline></video>
          <canvas
            ref="overlayRef"
            class="cam-overlay"
            :class="{ mirrored: mirror }"
            width="640"
            height="480"
          ></canvas>
        </div>
        <p class="legend">
          <i class="dot g"></i> ≥0.5 판정 사용 <i class="dot y"></i> 0.3~0.5 경계
          <i class="dot r"></i> &lt;0.3 무시
        </p>
        <p class="vis">
          신뢰도 — 어깨 {{ vis.shoulder }} · 팔꿈치 {{ vis.elbow }} · 손목 {{ vis.wrist }} · 엉덩이
          {{ vis.hip }} · 무릎 {{ vis.knee }}
        </p>
        <p class="status">{{ statusText }}</p>

        <button class="btn" @click="mirror = !mirror">좌우 미러 {{ mirror ? 'ON' : 'OFF' }}</button>

        <section>
          <h2>One Euro Filter</h2>
          <label>
            <span
              >minCutoff <b>{{ cfg.filter.minCutoff.toFixed(2) }}</b></span
            >
            <input v-model.number="cfg.filter.minCutoff" type="range" min="0.1" max="5" step="0.05" />
          </label>
          <label>
            <span
              >beta <b>{{ cfg.filter.beta.toFixed(2) }}</b></span
            >
            <input v-model.number="cfg.filter.beta" type="range" min="0" max="2" step="0.01" />
          </label>
        </section>

        <section>
          <h2>아바타 비율</h2>
          <label>
            <span
              >팔다리 길이 <b>×{{ cfg.avatar.limbScale.toFixed(2) }}</b></span
            >
            <input v-model.number="cfg.avatar.limbScale" type="range" min="0.8" max="2" step="0.05" />
          </label>
          <label>
            <span
              >캡슐 두께 <b>{{ cfg.avatar.capsuleRadius.toFixed(3) }}</b></span
            >
            <input
              v-model.number="cfg.avatar.capsuleRadius"
              type="range"
              min="0.06"
              max="0.3"
              step="0.005"
            />
          </label>
          <label>
            <span
              >머리 크기 <b>{{ cfg.avatar.headRadius.toFixed(2) }}</b></span
            >
            <input v-model.number="cfg.avatar.headRadius" type="range" min="0.2" max="0.7" step="0.01" />
          </label>
          <label>
            <span
              >허리 기울기 증폭 <b>×{{ cfg.avatar.leanGain.toFixed(2) }}</b></span
            >
            <input v-model.number="cfg.avatar.leanGain" type="range" min="1" max="3" step="0.05" />
          </label>
        </section>

        <section>
          <h2>녹화 · 캘리브레이션</h2>
          <div class="rec-buttons">
            <button class="btn" :disabled="mode === 'replay'" @click="toggleRecording">
              {{ recording ? `녹화 중지 (${recCount})` : '● 녹화' }}
            </button>
            <button class="btn" :disabled="!hasClip" @click="exportJson">JSON 내보내기</button>
            <button class="btn" :disabled="!hasClip" @click="toggleReplay">
              {{ mode === 'replay' ? '■ 재생 중지' : '▶ 재생' }}
            </button>
            <label class="btn file">
              JSON 불러오기
              <input type="file" accept=".json,application/json" @change="importJson" />
            </label>
          </div>
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
.stats {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: #9a97c0;
  font-variant-numeric: tabular-nums;
}
.stats b {
  color: #b6f03c;
}
.body {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 16px;
  padding: 16px;
}
.stage {
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
.panel {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}
.cam-wrap {
  position: relative;
}
.cam {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 12px;
  background: #14132e;
  object-fit: cover;
}
.cam-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.mirrored {
  transform: scaleX(-1);
}
.legend,
.vis {
  font-size: 12px;
  color: #9a97c0;
  font-variant-numeric: tabular-nums;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  vertical-align: baseline;
}
.dot.g {
  background: #b6f03c;
}
.dot.y {
  background: #fbbf24;
}
.dot.r {
  background: #ff4d6a;
}
.status {
  font-size: 13px;
  color: #9a97c0;
  min-height: 1.4em;
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
.btn {
  padding: 8px 12px;
  border: 1px solid #2a2850;
  border-radius: 12px;
  background: #14132e;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.btn:hover:not(:disabled) {
  background: #1e1c42;
}
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.rec-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.btn.file {
  position: relative;
  overflow: hidden;
}
.btn.file input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
</style>
