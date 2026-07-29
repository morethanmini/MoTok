<script setup lang="ts">
/**
 * 낚시 게임 (/dev/fishing-game) — 게임⑤ 세 동작을 이어붙인 실제 루프 (S15P11A706-10).
 *
 * 랩(/dev/fishing-lab)은 판정 하나하나를 재는 도구이고, 여기는 **재미를 판단하는 화면**이다.
 * 캐스팅을 따로 재봤을 때 "맛이 없다"고 나온 이유가 판정이 아니라 목적(조준→착수→대기→입질)이
 * 없어서였다(2026-07-29 실기 지적) — 그 사슬을 붙인다.
 *
 * 페이즈별로 활성 판정이 하나뿐이라 서로 오발하지 않는다:
 *   IDLE  → 캐스팅(cast.ts)
 *   BITE  → 훅킹(hook.ts)
 *   FIGHT → 펌핑(pump.ts) → 힘겨루기(fight.ts)
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  preloadPoseLandmarker,
  usePoseLandmarker,
  type PoseLandmarkerResult,
} from '@/composables/usePoseLandmarker'
import { createCast, DEFAULT_CAST } from './cast'
import { createHook, DEFAULT_HOOK } from './hook'
import { createPump, DEFAULT_PUMP } from './pump'
import { createLoop, DEFAULT_LOOP, type LoopState } from './loop'

const WRIST = { left: 15, right: 16 } as const
const SHOULDER = { left: 11, right: 12 } as const
const VIS_MIN = 0.5

const W = DEFAULT_LOOP.width
const H = DEFAULT_LOOP.height
const WATER_Y = DEFAULT_LOOP.waterY

const handSide = ref<'right' | 'left'>('right')
const pose = usePoseLandmarker()
const videoRef = ref<HTMLVideoElement>()
const canvasRef = ref<HTMLCanvasElement>()
const camError = ref<string | null>(null)
const loadProgress = ref(0)

const castCfg = reactive({ ...DEFAULT_CAST })
const hookCfg = reactive({ ...DEFAULT_HOOK })
/**
 * 진폭 문턱을 90 → 30으로 낮춘다. DEFAULT_PUMP의 90은 **손목 y** 진폭(실측 191~358px)에
 * 맞춘 값이고, 여기서 먹이는 건 양손 사이 거리다. 원을 그리면 거리 변화가 그보다 작다.
 * 랩은 y 기반 비교를 계속하므로 DEFAULT_PUMP 자체는 그대로 둔다.
 */
const pumpCfg = reactive({ ...DEFAULT_PUMP, minAmpPx: 30 })
const cast = createCast(castCfg)
const hook = createHook(hookCfg)
const pump = createPump(pumpCfg)
const loop = createLoop(DEFAULT_LOOP, 1)

/** 렌더·표시용 스냅샷 — tick 후 매 프레임 갱신 */
const st = ref<LoopState>(loop.state())
/** 조준 상태 — IDLE에서 조준선에 쓴다. 조준은 좌우만(거리 제어 없음) */
const aim = reactive({ locked: false, x: 0 })
const reelRate = ref(0)
/** 손목 화면 좌표 — 캠 오버레이 마커 */
let wrist: { x: number; y: number } | null = null
/** 물보라·이펙트 */
let splashes: { x: number; y: number; r: number; life: number }[] = []
/** 마지막 페이즈 — 전환 시점에 판정기를 리셋하기 위한 비교값 */
let prevPhase = st.value.phase

const hud = computed(() => {
  const s = st.value
  switch (s.phase) {
    case 'idle':
      return aim.locked
        ? '조준 잠김 — 손을 빠르게 내려꽂아 던지세요'
        : '손목을 어깨보다 위로 올려 조준하세요'
    case 'casting':
      return '찌가 날아갑니다…'
    case 'waiting':
      return s.active?.interest === 'curious'
        ? '물고기가 찌를 봤어요…'
        : s.active
          ? '물고기가 다가옵니다!'
          : '입질을 기다립니다…'
    case 'bite':
      return '입질! 손을 위로 번쩍!'
    case 'fighting':
      return s.grace ? '걸렸다! 감으세요' : s.reeling ? '감기고 있다!' : 'DANGER — 더 빨리!'
    case 'result':
      return s.last?.outcome === 'caught'
        ? `${s.last.name} 낚았다! +${s.last.score}`
        : s.last?.outcome === 'missed'
          ? '챔질 실패… 놓쳤다'
          : `${s.last?.name ?? ''} 도망갔다…`
  }
})

let stream: MediaStream | null = null
let rafId = 0
let lastT = 0

function onPose(result: PoseLandmarkerResult) {
  const lm = result.landmarks?.[0]
  const now = performance.now()
  const phase = loop.state().phase

  /*
   * 릴 감기는 **양손 사이 거리**의 왕복으로 잰다 (2026-07-29 실측으로 y에서 교체).
   *
   * 손으로 그린 원은 화면에 가로로 납작하게 찍힌다 — 랩이 실측한 궤도 종횡비가 0.55다.
   * 그래서 y만 보는 판정은 실제 크랭크 동작의 y 진폭이 문턱(90px)을 못 넘어 **한 번도
   * 안 세어졌다**(같은 동작에 y 0.00/s vs 양손 거리 0.96/s). y로 재려면 팔 전체를 415px
   * 흔들어야 했고 그게 지속 속도 0.8/s 상한과 "팔 아프다"의 원인이었다.
   *
   * 2D 거리는 x 성분을 포함하므로 납작한 원도 잡는다. 그리고 화면 안내("빙글빙글 돌려요")와
   * 실제 동작이 처음으로 일치한다 — 지금까지는 안내는 원인데 판정은 위아래였다.
   *
   * 두 신호의 rate는 같은 진동 주파수를 읽으므로 속도 자체는 차이가 없다. 이득은
   * "잡을 수 있는 동작의 범위"다.
   *
   * 단일 손목 판정보다 **앞에** 둔다 — 주 손목을 놓친 프레임에도 rate를 0으로 내려야 한다.
   */
  if (phase === 'fighting') {
    const wl = lm?.[WRIST.left]
    const wr = lm?.[WRIST.right]
    if (wl && wr && (wl.visibility ?? 0) >= VIS_MIN && (wr.visibility ?? 0) >= VIS_MIN) {
      // 거울 반전은 차이값에서 상쇄되므로 raw x를 그대로 쓴다
      const dist = Math.hypot((wr.x - wl.x) * W, (wr.y - wl.y) * H)
      reelRate.value = pump.feed(dist, now).rate
    } else {
      // 한 손이라도 놓치면 감기를 멈춘다. feed를 건너뛰면 마지막 rate가 남아서
      // 손을 내려도 게이지가 계속 찬다.
      reelRate.value = 0
    }
  }

  const w = lm?.[WRIST[handSide.value]]
  const sh = lm?.[SHOULDER[handSide.value]]
  if (!w || (w.visibility ?? 0) < VIS_MIN) {
    wrist = null
    return
  }
  const x = (1 - w.x) * W
  const y = w.y * H
  wrist = { x, y }

  // 페이즈별로 하나만 — 서로 오발하지 않는다
  if (phase === 'idle' && sh) {
    const c = cast.feed(x, y, sh.y * H, now)
    aim.locked = c.phase === 'armed'
    if (c.aimX !== null) aim.x = c.aimX
    // 조준은 발사 시점에 판정기가 확정한 값을 쓴다(내려꽂는 동안의 흔들림 배제)
    if (c.fired !== null) loop.cast(c.firedAimX, c.fired)
  } else if (phase === 'bite') {
    if (hook.feed(y, now).fired) loop.hook()
  }
}

function spawnSplash(x: number, y: number) {
  splashes.push({ x, y, r: 6, life: 0.6 })
}

function frame(now: number) {
  rafId = requestAnimationFrame(frame)
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0
  lastT = now

  if (dt > 0) {
    loop.tick(dt, st.value.phase === 'fighting' ? reelRate.value : 0)
    const s = loop.state()

    // 페이즈 전환 처리 — 판정기를 초기화해 이전 동작이 새 페이즈로 새지 않게 한다
    if (s.phase !== prevPhase) {
      if (s.phase === 'waiting') spawnSplash(s.bobber.x, s.bobber.y)
      if (s.phase === 'bite') hook.reset()
      if (s.phase === 'fighting') pump.reset()
      if (s.phase === 'idle') {
        cast.reset()
        aim.locked = false
      }
      if (s.phase === 'result' && s.last?.outcome === 'caught') spawnSplash(s.bobber.x, s.bobber.y)
      prevPhase = s.phase
    }
    st.value = s

    for (const p of splashes) {
      p.life -= dt
      p.r += dt * 90
    }
    splashes = splashes.filter((p) => p.life > 0)
  }

  draw()
}

function draw() {
  const cv = canvasRef.value
  const video = videoRef.value
  const ctx = cv?.getContext('2d')
  if (!cv || !ctx || !video) return
  const s = st.value

  // 하늘·바다
  const sky = ctx.createLinearGradient(0, 0, 0, WATER_Y)
  sky.addColorStop(0, '#1c2a5e')
  sky.addColorStop(1, '#2a3f8c')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, WATER_Y)
  const sea = ctx.createLinearGradient(0, WATER_Y, 0, H)
  sea.addColorStop(0, '#0f2f66')
  sea.addColorStop(1, '#081735')
  ctx.fillStyle = sea
  ctx.fillRect(0, WATER_Y, W, H - WATER_Y)

  // 캠 — 물 위에 반투명으로 겹친다(기획 §게임 화면 구성: 내 캠은 반투명)
  if (video.readyState >= 2) {
    ctx.save()
    ctx.globalAlpha = 0.18
    ctx.translate(W, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, W, H)
    ctx.restore()
  }

  // 수면선
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, WATER_Y)
  ctx.lineTo(W, WATER_Y)
  ctx.stroke()

  for (const f of s.fishes) drawFish(ctx, f, s)
  drawSplashes(ctx)
  if (s.bobber.visible) drawBobber(ctx, s)
  if (s.phase === 'idle' && aim.locked) drawAim(ctx)
  if (wrist) drawWristMarker(ctx, s)
  drawGauges(ctx, s)
}

function drawFish(ctx: CanvasRenderingContext2D, f: LoopState['fishes'][number], s: LoopState) {
  const r = 8 + (1 - f.spec.requiredRate) * 14
  const isActive = f === s.active
  ctx.save()
  ctx.translate(f.x, f.y)
  if (f.dir < 0) ctx.scale(-1, 1)
  ctx.fillStyle = isActive ? '#FFD23F' : '#3ddcff'
  ctx.globalAlpha = f.interest === 'none' ? 0.75 : 1
  ctx.beginPath()
  ctx.moveTo(-r * 0.9, 0)
  ctx.lineTo(-r * 1.6, -r * 0.55)
  ctx.lineTo(-r * 1.6, r * 0.55)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(0, 0, r, r * 0.6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#0d1020'
  ctx.beginPath()
  ctx.arc(r * 0.5, -r * 0.12, r * 0.11, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // 관심 단계 표시 — 대기의 긴장감을 눈에 보이게 한다
  if (f.interest === 'curious') drawMark(ctx, f.x, f.y - r - 12, '?', '#FFD23F')
  else if (f.interest === 'approaching' && s.phase === 'waiting')
    drawMark(ctx, f.x, f.y - r - 12, '!', '#FF9F43')
  else if (isActive && s.phase === 'bite') drawMark(ctx, f.x, f.y - r - 14, '!!', '#FF5D73')
}

function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  ctx.save()
  ctx.font = 'bold 20px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 12
  ctx.fillText(text, x, y)
  ctx.restore()
}

function drawBobber(ctx: CanvasRenderingContext2D, s: LoopState) {
  const shake = s.phase === 'bite' ? Math.sin(performance.now() * 0.03) * 4 : 0
  const bx = s.bobber.x
  const by = s.bobber.y + shake
  // 낚싯줄 — 화면 아래 중앙(앵글러)에서 찌까지
  ctx.strokeStyle = 'rgba(244,240,255,0.5)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(W / 2, H - 12)
  ctx.lineTo(bx, by)
  ctx.stroke()
  ctx.fillStyle = '#FF5D73'
  ctx.beginPath()
  ctx.arc(bx, by - 4, 7, Math.PI, 0)
  ctx.fill()
  ctx.fillStyle = '#F4F0FF'
  ctx.beginPath()
  ctx.arc(bx, by + 2, 7, 0, Math.PI)
  ctx.fill()
}

/**
 * 조준 미리보기 — 좌우 조준선과, 착수 가능 범위(가까이~멀리)를 함께 보여준다.
 * 거리는 스윙 최고 속도로 정해지므로 미리보기 게이지가 없다(cast.ts 주석 ③) — 대신 "이 선
 * 위 어딘가에 떨어진다"는 범위를 보여줘서 세게/약하게 던지는 감을 잡게 한다.
 */
function drawAim(ctx: CanvasRenderingContext2D) {
  const nearY = H - DEFAULT_LOOP.landNearMarginPx
  const farY = WATER_Y + DEFAULT_LOOP.landFarMarginPx
  ctx.save()
  // 착수 가능 범위 — 세로 막대
  ctx.strokeStyle = 'rgba(198,255,94,0.35)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(aim.x, farY)
  ctx.lineTo(aim.x, nearY)
  ctx.stroke()
  // 던지는 라인
  ctx.strokeStyle = '#C6FF5E'
  ctx.lineWidth = 2
  ctx.setLineDash([5, 5])
  ctx.beginPath()
  ctx.moveTo(W / 2, H - 12)
  ctx.lineTo(aim.x, nearY)
  ctx.stroke()
  ctx.setLineDash([])
  // 양 끝 표시 — 위가 멀리, 아래가 가까이
  const pulse = 5 + Math.sin(performance.now() / 160) * 2
  for (const y of [farY, nearY]) {
    ctx.beginPath()
    ctx.arc(aim.x, y, pulse, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(198,255,94,0.8)'
  ctx.font = '10px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('세게', aim.x, farY - 10)
  ctx.fillText('약하게', aim.x, nearY + 18)
  ctx.restore()
}

function drawSplashes(ctx: CanvasRenderingContext2D) {
  ctx.save()
  ctx.strokeStyle = 'rgba(191,233,255,0.7)'
  ctx.lineWidth = 3
  for (const p of splashes) {
    ctx.globalAlpha = Math.max(0, p.life / 0.6)
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

function drawWristMarker(ctx: CanvasRenderingContext2D, s: LoopState) {
  if (!wrist) return
  const color =
    s.phase === 'bite' ? '#FF5D73' : s.phase === 'fighting' && s.reeling ? '#C6FF5E' : '#3ddcff'
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = 14
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(wrist.x, wrist.y, 8, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawGauges(ctx: CanvasRenderingContext2D, s: LoopState) {
  if (s.phase === 'fighting') {
    const w = W - 40
    ctx.fillStyle = 'rgba(11,19,48,0.7)'
    ctx.fillRect(20, H - 34, w, 16)
    ctx.fillStyle = s.reeling ? '#C6FF5E' : '#FF5D73'
    ctx.fillRect(20, H - 34, w * s.progress, 16)
    ctx.strokeStyle = 'rgba(244,240,255,0.3)'
    ctx.lineWidth = 1
    ctx.strokeRect(20, H - 34, w, 16)
  }
  if (s.phase === 'bite') {
    const w = W - 40
    const p = s.biteLeftSec / DEFAULT_LOOP.biteWindowSec
    ctx.fillStyle = 'rgba(11,19,48,0.7)'
    ctx.fillRect(20, H - 34, w, 10)
    ctx.fillStyle = '#FFD23F'
    ctx.fillRect(20, H - 34, w * p, 10)
  }
}

onMounted(async () => {
  lastT = 0
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
  <div class="game">
    <header>
      <h1>낚시 <small>게임⑤ · S15P11A706-10</small></h1>
      <span class="score">SCORE {{ st.score }}</span>
      <button type="button" @click="handSide = handSide === 'right' ? 'left' : 'right'">
        {{ handSide === 'right' ? '오른손' : '왼손' }}
      </button>
      <button type="button" @click="loop.reset()">다시</button>
    </header>

    <p class="err" v-if="camError || pose.error.value">{{ camError || pose.error.value }}</p>
    <p class="err" v-else-if="pose.isLoading.value">
      포즈 모델 로딩 중… {{ Math.round(loadProgress * 100) }}%
    </p>

    <div class="stage">
      <canvas ref="canvasRef" :width="W" :height="H" />
      <video ref="videoRef" playsinline muted class="hidden-video" />
      <div class="hud" :class="st.phase">{{ hud }}</div>
    </div>

    <ol class="guide">
      <li>
        <b>던지기</b> — 손목을 어깨 위로 올리면 조준선이 뜬다. 손을 <b>좌우로 옮겨 조준</b>하고
        <b>내려꽂는 세기로 거리</b>가 정해진다(세게 = 멀리)
      </li>
      <li><b>기다리기</b> — 물고기가 <b>?</b> → <b>!</b> 로 다가온다</li>
      <li><b>챔질</b> — <b>!!</b> 가 뜨면 손을 위로 번쩍</li>
      <li>
        <b>감기</b> — 양손으로 낚싯대 잡고 <b>오른손으로 원을 그리듯</b> 릴을 돌린다. 멈추면
        도망간다
      </li>
    </ol>

    <div class="catches" v-if="st.caught.length">
      <span v-for="(c, i) in st.caught" :key="i" class="chip">{{ c.name }} +{{ c.score }}</span>
    </div>
  </div>
</template>

<style scoped>
.game {
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
  gap: 14px;
  width: min(640px, 100%);
}
h1 {
  font-size: 18px;
  margin: 0;
}
h1 small {
  font-size: 11px;
  color: #93a1c9;
  font-weight: 400;
  margin-left: 6px;
}
.score {
  margin-left: auto;
  font-family: ui-monospace, monospace;
  font-weight: 700;
  color: #c6ff5e;
}
button {
  background: #1c2a5e;
  color: #f4f0ff;
  border: 1px solid rgba(244, 240, 255, 0.14);
  border-radius: 8px;
  padding: 5px 11px;
  font-size: 12px;
  cursor: pointer;
}
.err {
  color: #ffd3da;
  font-size: 13px;
  margin: 0;
}
.stage {
  position: relative;
  border: 1px solid rgba(244, 240, 255, 0.12);
  border-radius: 12px;
  overflow: hidden;
}
canvas {
  display: block;
  width: min(640px, 100%);
  height: auto;
}
.hidden-video {
  position: absolute;
  width: 2px;
  height: 2px;
  opacity: 0;
  top: 0;
  left: 0;
}
.hud {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(11, 19, 48, 0.78);
  border: 1px solid rgba(244, 240, 255, 0.14);
  border-radius: 20px;
  padding: 7px 16px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.hud.bite {
  color: #ffd3da;
  border-color: rgba(255, 93, 115, 0.6);
  background: rgba(255, 59, 92, 0.28);
}
.hud.fighting {
  color: #dcf7b0;
  border-color: rgba(198, 255, 94, 0.5);
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
.catches {
  width: min(640px, 100%);
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  background: #152049;
  border: 1px solid rgba(244, 240, 255, 0.12);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11.5px;
  font-family: ui-monospace, monospace;
}
</style>
