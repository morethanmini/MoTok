<script setup lang="ts">
/**
 * 낚시 조준 랩 (/dev/fishing-aim-lab) — 좌우 조준 도달 범위 실측 (S15P11A706-49).
 *
 * ── 왜 별도 랩인가 ──
 * 조준은 이 게임에서 **유일하게 어깨너비 정규화를 안 쓰는 판정**이다. 게임은 손 중점 x를
 * 카메라 프레임 x 그대로 화면 x에 쓴다:
 *
 *   midX = ((1 - wl.x) * W + (1 - wr.x) * W) / 2
 *
 * 2~3m 거리에서 사람 손은 프레임 좌우 끝까지 못 간다. 그래서 화면 가운데 일부만 조준되고
 * "좌우로 화면 끝까지 안 간다"가 된다(2026-07-30 지적).
 *
 * ── 무엇을 재는가 ──
 * 몸 중심(어깨 중점)에서 손 중점이 **실제로 얼마나 벗어날 수 있는가**를 어깨너비 배수로 잰다.
 * 그 도달 범위가 화면 반폭에 대응하도록 이득을 잡으면 조준이 화면 전체를 덮는다.
 *
 *   offSw   = (손중점x - 어깨중점x) / 어깨너비
 *   조준x   = W/2 + (offSw / spanSw) * (W/2)
 *
 * `spanSw`가 정하려는 값이다 — "몸 중심에서 이만큼 벗어나면 화면 끝".
 *
 * ── 어깨너비를 중앙값으로 쓰는 이유 ──
 * 큰 랩에서 어깨너비 변동이 18~21%로 나왔다(경고 등급). 평균은 그 흔들림을 그대로 받는다.
 * 분모가 흔들리면 offSw도 같이 흔들려 도달 범위를 잘못 잰다. `normalize.ts`와 같은 런닝
 * 중앙값을 쓴다.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  preloadPoseLandmarker,
  usePoseLandmarker,
  type PoseLandmarkerResult,
} from '@/composables/usePoseLandmarker'
import { createNormalizer, SHOULDER, VIS_MIN, WRIST } from './normalize'

const W = 640
const H = 480
/** 스윕 측정 시간(ms) — 좌우 왕복 두어 번 할 시간 */
const SWEEP_MS = 6000

const pose = usePoseLandmarker()
const videoRef = ref<HTMLVideoElement>()
const canvasRef = ref<HTMLCanvasElement>()
const camError = ref<string | null>(null)
const loadProgress = ref(0)

const norm = createNormalizer()

/** 조준 이득 후보 — 화면에서 돌려보며 감을 잡는다 */
const spanSw = ref(0.85)

const m = reactive({
  /** 어깨너비 런닝 중앙값(px) */
  sw: 0,
  swMin: 0,
  swMax: 0,
  /** 몸 중심 x, 손 중점 x (캔버스 px) */
  bodyX: 0,
  handX: 0,
  /** 몸 중심에서 벗어난 거리 (어깨너비 배수). 양수 = 화면 오른쪽 */
  offSw: 0,
  offMin: 0,
  offMax: 0,
  /** 게임 현재 방식 — 손 중점이 프레임 폭의 몇 %인지 */
  rawPct: 50,
  rawMin: 100,
  rawMax: 0,
  frames: 0,
  /** 양손+어깨를 다 본 프레임 */
  okFrames: 0,
})

/** 스윕 측정 — 버튼을 누른 뒤 SWEEP_MS 동안의 도달 범위만 따로 본다 */
const sweep = reactive({
  running: false,
  leftMs: 0,
  offMin: 0,
  offMax: 0,
  rawMin: 100,
  rawMax: 0,
  done: false,
})
let sweepUntil = 0

/** 정규화 방식으로 계산한 조준 x */
function aimXFrom(off: number): number {
  const x = W / 2 + (off / spanSw.value) * (W / 2)
  return Math.min(W, Math.max(0, x))
}

/** 현재 방식이 덮는 화면 폭 비율(%) — 손 중점을 그대로 화면 x로 쓴 결과 */
const rawCoverage = computed(() =>
  m.rawMax > m.rawMin ? Math.round(m.rawMax - m.rawMin) : 0,
)

/** 정규화 방식이 덮는 화면 폭 비율(%) */
const normCoverage = computed(() => {
  if (m.offMax <= m.offMin) return 0
  const a = aimXFrom(m.offMin)
  const b = aimXFrom(m.offMax)
  return Math.round(((b - a) / W) * 100)
})

/**
 * 권장 spanSw — 도달 범위의 큰 쪽에 10% 여유를 뺀 값.
 *
 * 여유를 두는 이유는 끝까지 뻗은 자세를 매번 재현할 수 없기 때문이다. 최대 도달값을 그대로
 * 쓰면 "화면 끝"에 닿으려면 항상 최대로 뻗어야 한다.
 */
const suggest = computed(() => {
  const src = sweep.done ? sweep : m
  const reach = Math.max(Math.abs(src.offMin), Math.abs(src.offMax))
  return reach > 0 ? +(reach * 0.9).toFixed(2) : 0
})

const verdict = computed(() => {
  if (m.okFrames < 30) return { cls: 'wait', text: '측정 중 — 양손과 어깨가 다 보여야 한다' }
  if (rawCoverage.value >= 85) return { cls: 'ok', text: '현재 방식으로도 화면을 덮는다' }
  return {
    cls: 'warn',
    text: `현재 방식은 화면 폭의 ${rawCoverage.value}%만 덮는다 — 정규화 필요`,
  }
})

let stream: MediaStream | null = null
let rafId = 0
let marks: { lw: P; rw: P; ls: P; rs: P } | null = null
type P = { x: number; y: number }

function onPose(result: PoseLandmarkerResult) {
  const lm = result.landmarks?.[0]
  m.frames++

  const wl = lm?.[WRIST.left]
  const wr = lm?.[WRIST.right]
  const sl = lm?.[SHOULDER.left]
  const sr = lm?.[SHOULDER.right]

  const wristsOk =
    !!wl && !!wr && (wl.visibility ?? 0) >= VIS_MIN && (wr.visibility ?? 0) >= VIS_MIN
  const shouldersOk =
    !!sl && !!sr && (sl.visibility ?? 0) >= VIS_MIN && (sr.visibility ?? 0) >= VIS_MIN

  if (!wristsOk || !shouldersOk) {
    marks = null
    return
  }

  // 캔버스 좌표 — 캠을 좌우 반전해 보여주므로 x도 반전한다
  const lw = { x: (1 - wl!.x) * W, y: wl!.y * H }
  const rw = { x: (1 - wr!.x) * W, y: wr!.y * H }
  const ls = { x: (1 - sl!.x) * W, y: sl!.y * H }
  const rs = { x: (1 - sr!.x) * W, y: sr!.y * H }
  marks = { lw, rw, ls, rs }

  const width = Math.hypot(rs.x - ls.x, rs.y - ls.y)
  norm.push(width)
  m.swMin = m.swMin === 0 ? width : Math.min(m.swMin, width)
  m.swMax = Math.max(m.swMax, width)
  if (!norm.ready()) return
  m.sw = norm.sw()
  m.okFrames++

  m.bodyX = (ls.x + rs.x) / 2
  m.handX = (lw.x + rw.x) / 2
  m.offSw = (m.handX - m.bodyX) / m.sw
  m.offMin = Math.min(m.offMin, m.offSw)
  m.offMax = Math.max(m.offMax, m.offSw)

  m.rawPct = (m.handX / W) * 100
  m.rawMin = Math.min(m.rawMin, m.rawPct)
  m.rawMax = Math.max(m.rawMax, m.rawPct)

  if (sweep.running) {
    sweep.offMin = Math.min(sweep.offMin, m.offSw)
    sweep.offMax = Math.max(sweep.offMax, m.offSw)
    sweep.rawMin = Math.min(sweep.rawMin, m.rawPct)
    sweep.rawMax = Math.max(sweep.rawMax, m.rawPct)
  }
}

function startSweep() {
  Object.assign(sweep, {
    running: true,
    done: false,
    offMin: 0,
    offMax: 0,
    rawMin: 100,
    rawMax: 0,
    leftMs: SWEEP_MS,
  })
  sweepUntil = performance.now() + SWEEP_MS
}

function resetAll() {
  norm.reset()
  Object.assign(m, {
    sw: 0,
    swMin: 0,
    swMax: 0,
    bodyX: 0,
    handX: 0,
    offSw: 0,
    offMin: 0,
    offMax: 0,
    rawPct: 50,
    rawMin: 100,
    rawMax: 0,
    frames: 0,
    okFrames: 0,
  })
  Object.assign(sweep, { running: false, done: false, offMin: 0, offMax: 0, rawMin: 100, rawMax: 0, leftMs: 0 })
}

/* ────────────────────────── 렌더 ────────────────────────── */

function frame(now: number) {
  rafId = requestAnimationFrame(frame)

  if (sweep.running) {
    sweep.leftMs = Math.max(0, sweepUntil - now)
    if (sweep.leftMs === 0) {
      sweep.running = false
      sweep.done = true
    }
  }

  const cv = canvasRef.value
  const ctx = cv?.getContext('2d')
  const video = videoRef.value
  if (!cv || !ctx) return

  ctx.fillStyle = '#0b1330'
  ctx.fillRect(0, 0, W, H)
  if (video && video.readyState >= 2) {
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.translate(W, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, W, H)
    ctx.restore()
  }

  if (marks) {
    // 어깨선
    ctx.strokeStyle = '#3ddcff'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(marks.ls.x, marks.ls.y)
    ctx.lineTo(marks.rs.x, marks.rs.y)
    ctx.stroke()

    // 몸 중심 세로선 — 조준 0의 기준
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.setLineDash([6, 6])
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(m.bodyX, 0)
    ctx.lineTo(m.bodyX, H)
    ctx.stroke()
    ctx.setLineDash([])

    // 손 중점
    ctx.fillStyle = '#FFD23F'
    ctx.beginPath()
    ctx.arc(m.handX, (marks.lw.y + marks.rw.y) / 2, 9, 0, Math.PI * 2)
    ctx.fill()

    // 도달 범위 — 몸 중심 기준 좌우 최대
    if (m.sw > 0) {
      ctx.strokeStyle = 'rgba(255,210,63,0.5)'
      ctx.lineWidth = 2
      for (const off of [m.offMin, m.offMax]) {
        const x = m.bodyX + off * m.sw
        ctx.beginPath()
        ctx.moveTo(x, 40)
        ctx.lineTo(x, H - 90)
        ctx.stroke()
      }
    }
  }

  // ── 하단 비교 바 두 줄 ──
  drawBar(ctx, H - 66, '현재(프레임 x 직결)', m.rawPct / 100, m.rawMin / 100, m.rawMax / 100, '#FF5D73')
  drawBar(
    ctx,
    H - 30,
    `정규화(span ×${spanSw.value.toFixed(2)})`,
    aimXFrom(m.offSw) / W,
    aimXFrom(m.offMin) / W,
    aimXFrom(m.offMax) / W,
    '#C6FF5E',
  )
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  y: number,
  label: string,
  cur: number,
  lo: number,
  hi: number,
  color: string,
) {
  const x0 = 14
  const w = W - 28
  ctx.fillStyle = 'rgba(11,19,48,0.78)'
  ctx.fillRect(x0, y, w, 22)
  // 도달 범위
  if (hi > lo) {
    ctx.fillStyle = color + '55'
    ctx.fillRect(x0 + w * lo, y, w * (hi - lo), 22)
  }
  ctx.strokeStyle = 'rgba(244,240,255,0.28)'
  ctx.lineWidth = 1
  ctx.strokeRect(x0, y, w, 22)
  // 현재 위치
  ctx.fillStyle = color
  ctx.fillRect(x0 + w * Math.min(1, Math.max(0, cur)) - 2, y - 3, 4, 28)
  ctx.fillStyle = '#f4f0ff'
  ctx.font = '11px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(label, x0 + 6, y + 15)
}

/* ────────────────────────── 로그 ────────────────────────── */

const copied = ref(false)
function logText(): string {
  const n = (v: number) => v.toFixed(2)
  const src = sweep.done ? sweep : m
  return [
    `[낚시 조준 랩 실측] ${m.okFrames}f 유효 / ${m.frames}f`,
    `어깨너비: 중앙값=${Math.round(m.sw)}px (관측 ${Math.round(m.swMin)}~${Math.round(m.swMax)}, 변동=${m.sw > 0 ? Math.round(((m.swMax - m.swMin) / m.sw) * 100) : 0}%)`,
    `벗어남(offSw): 현재=${n(m.offSw)} 도달 ${n(m.offMin)} ~ ${n(m.offMax)}`,
    sweep.done ? `스윕 구간: ${n(sweep.offMin)} ~ ${n(sweep.offMax)} (raw ${Math.round(sweep.rawMin)}~${Math.round(sweep.rawMax)}%)` : '스윕 미측정',
    `현재 방식 커버리지 = ${rawCoverage.value}% (프레임 ${Math.round(m.rawMin)}~${Math.round(m.rawMax)}%)`,
    `정규화 커버리지 = ${normCoverage.value}% (span ×${spanSw.value.toFixed(2)})`,
    `권장 AIM_SPAN_SW = ${suggest.value}  ← 도달 ${n(Math.max(Math.abs(src.offMin), Math.abs(src.offMax)))} × 0.9`,
    `판정: ${verdict.value.text}`,
  ].join('\n')
}
async function copyLog() {
  try {
    await navigator.clipboard.writeText(logText())
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1500)
  } catch {
    raw.value = logText()
    showRaw.value = true
  }
}
const showRaw = ref(false)
const raw = ref('')

onMounted(async () => {
  frame(performance.now())
  preloadPoseLandmarker((f) => (loadProgress.value = f))
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: W, height: H } })
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
  pose.stop()
  stream?.getTracks().forEach((t) => t.stop())
})
</script>

<template>
  <div class="lab">
    <header>
      <h1>낚시 조준 랩 <small>좌우 도달 범위 · S15P11A706-49</small></h1>
      <button type="button" class="go" :disabled="sweep.running" @click="startSweep">
        {{ sweep.running ? `측정 중 ${(sweep.leftMs / 1000).toFixed(1)}s` : '좌우 스윕 측정 (6초)' }}
      </button>
      <button type="button" @click="resetAll">초기화</button>
      <button type="button" class="copy" @click="copyLog">{{ copied ? '복사됨 ✓' : '기록 복사' }}</button>
    </header>

    <p class="err" v-if="camError || pose.error.value">{{ camError || pose.error.value }}</p>
    <p class="err" v-else-if="pose.isLoading.value">
      포즈 모델 로딩 중… {{ Math.round(loadProgress * 100) }}%
    </p>

    <canvas ref="canvasRef" :width="W" :height="H" />
    <video ref="videoRef" playsinline muted class="hidden-video" />

    <section class="panel" :class="verdict.cls">
      <p class="verdict">{{ verdict.text }}</p>
      <dl>
        <dt>어깨너비 중앙값</dt>
        <dd>{{ Math.round(m.sw) }}px <em>({{ Math.round(m.swMin) }}~{{ Math.round(m.swMax) }})</em></dd>
        <dt>벗어남 offSw</dt>
        <dd>
          {{ m.offSw.toFixed(2) }}
          <em>도달 {{ m.offMin.toFixed(2) }} ~ {{ m.offMax.toFixed(2) }}</em>
        </dd>
        <dt>현재 방식 커버리지</dt>
        <dd :class="{ bad: rawCoverage < 85 }">{{ rawCoverage }}%</dd>
        <dt>정규화 커버리지</dt>
        <dd :class="{ good: normCoverage >= 85 }">{{ normCoverage }}%</dd>
        <dt>권장 AIM_SPAN_SW</dt>
        <dd class="good">{{ suggest || '–' }}</dd>
      </dl>

      <label class="slider">
        조준 이득 span ×{{ spanSw.toFixed(2) }}
        <input v-model.number="spanSw" type="range" min="0.3" max="1.6" step="0.05" />
      </label>
    </section>

    <ol class="guide">
      <li><b>양손을 모아</b> 낚싯대를 쥔 자세로 선다 — 어깨와 양 손목이 다 보여야 잰다</li>
      <li><b>좌우 스윕 측정</b>을 누르고 6초 동안 손을 <b>좌우로 최대한</b> 두어 번 왕복한다</li>
      <li>아래 두 바를 비교한다 — 빨강이 현재 방식, 초록이 정규화 방식이다</li>
      <li>초록 바가 화면을 거의 다 덮는 <b>span</b> 값을 찾는다. 권장값이 시작점이다</li>
    </ol>

    <textarea v-if="showRaw" class="rawbox" readonly rows="10" :value="raw" />
  </div>
</template>

<style scoped>
.lab {
  min-height: 100vh;
  background: #0b1330;
  color: #f4f0ff;
  font-family: system-ui, sans-serif;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}
header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  width: min(640px, 100%);
}
h1 {
  font-size: 18px;
  margin: 0;
  flex: 1 1 100%;
}
h1 small {
  font-size: 11px;
  color: #93a1c9;
  font-weight: 400;
  margin-left: 6px;
}
button {
  background: #1c2a5e;
  color: #f4f0ff;
  border: 1px solid rgba(244, 240, 255, 0.14);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
button.go {
  background: #3ddcff;
  border-color: #3ddcff;
  color: #06243a;
  font-weight: 700;
}
button.copy {
  background: #c6ff5e;
  border-color: #c6ff5e;
  color: #101a12;
  font-weight: 700;
}
canvas {
  display: block;
  width: min(640px, 100%);
  height: auto;
  border: 1px solid rgba(244, 240, 255, 0.12);
  border-radius: 12px;
}
.hidden-video {
  position: absolute;
  width: 2px;
  height: 2px;
  opacity: 0;
}
.panel {
  width: min(640px, 100%);
  background: #101a3d;
  border: 1px solid rgba(244, 240, 255, 0.1);
  border-left: 6px solid #4d5f92;
  border-radius: 12px;
  padding: 12px 14px;
}
.panel.ok {
  border-left-color: #c6ff5e;
}
.panel.warn {
  border-left-color: #ffd23f;
}
.panel.wait {
  border-left-color: #4d5f92;
}
.verdict {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 14px;
  margin: 0;
  font-size: 12.5px;
}
dt {
  color: #93a1c9;
}
dd {
  margin: 0;
  font-family: ui-monospace, monospace;
}
dd em {
  color: #93a1c9;
  font-style: normal;
  font-size: 11px;
  margin-left: 6px;
}
dd.bad {
  color: #ff5d73;
}
dd.good {
  color: #c6ff5e;
}
.slider {
  display: block;
  margin-top: 12px;
  font-size: 12px;
  color: #93a1c9;
}
.slider input {
  display: block;
  width: 100%;
  margin-top: 4px;
}
.guide {
  width: min(640px, 100%);
  font-size: 12.5px;
  color: #93a1c9;
  line-height: 1.7;
  margin: 0;
  padding-left: 1.2em;
}
.guide b {
  color: #f4f0ff;
}
.err {
  color: #ffd3da;
  font-size: 13px;
  margin: 0;
}
.rawbox {
  width: min(640px, 100%);
  background: #0d1128;
  color: #f4f0ff;
  border: 1px solid rgba(198, 255, 94, 0.4);
  border-radius: 10px;
  padding: 10px 12px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.55;
}
</style>
