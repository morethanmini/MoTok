<script setup lang="ts">
/**
 * 모션 낚시 — 정식 게임 화면 (게임⑤, S15P11A706-49).
 *
 * 계측 화면(`/dev/fishing-game`)과 **판정은 완전히 같고 스킨만 다르다**. 문턱 상수를 여기서
 * 다시 적지 않고 `DEFAULT_CAST`·`DEFAULT_HOOK`·`DEFAULT_PUMP`를 그대로 쓰는 게 핵심이다 —
 * 값이 갈리는 순간 계측 화면에서 튜닝한 결과가 정식 화면에 반영되지 않고, 계측 화면은 죽는다.
 *
 * 한 컴포넌트가 두 자리에서 돈다(게임④ BodyFitGame과 같은 방식):
 *   게임룸  — 부모가 셀프 타일의 <video>를 넘겨준다. 카메라를 새로 열지 않는다
 *   dev 라우트 — video prop이 없으므로 직접 카메라를 연다
 *
 * 게임룸은 이 컴포넌트의 **캔버스만** 화면공유로 송출한다. 그래서 HUD·점수를 DOM이 아니라
 * 캔버스에 그린다(cozy 스킨의 drawHud) — DOM에 두면 다른 참가자 타일에서 사라진다.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  preloadPoseLandmarker,
  usePoseLandmarker,
  type PoseLandmarkerResult,
} from '@/composables/usePoseLandmarker'
import { createCast, DEFAULT_CAST } from './cast'
import { createHook, DEFAULT_HOOK } from './hook'
import { createPump, DEFAULT_PUMP } from './pump'
import { createLoop, DEFAULT_LOOP, type LoopState } from './loop'
import { depthFromHands } from './depth'
import { aimFromHands, createNormalizer, SHOULDER, VIS_MIN, WRIST } from './normalize'
import { drawFrame } from './render/drawFrame'
import { cozySkin } from './render/skins/cozy'
import type { Splash } from './render/types'

const props = defineProps<{
  /** 게임룸 셀프 타일의 <video> — 있으면 카메라를 새로 열지 않고 재사용한다 */
  video?: HTMLVideoElement | null
  /** 방 안 셀프 타일을 채우는가. dev 라우트는 자체 페이지라 false */
  embedded?: boolean
  /**
   * 릴을 돌리는 손. 고정값이다 — "움직임이 큰 쪽 자동 선택"은 실측 3/3 실패했다(2026-07-30).
   * 대를 잡은 손도 함께 움직이고, 왼손 세션에서는 반대 손이 오히려 더 움직였다.
   */
  crankSide?: 'right' | 'left'
}>()

const emit = defineEmits<{
  close: []
  /** 점수가 바뀔 때마다 — 게임룸 스코어보드가 쓴다 */
  progress: [score: number]
}>()

const W = DEFAULT_LOOP.width
const H = DEFAULT_LOOP.height

const pose = usePoseLandmarker()
const canvasRef = ref<HTMLCanvasElement>()
const videoRef = ref<HTMLVideoElement>()
const camError = ref<string | null>(null)
const loadProgress = ref(0)

// 계측 화면과 같은 문턱을 쓴다 — 여기서 덮어쓰지 않는다
const cast = createCast(DEFAULT_CAST)
const hook = createHook(DEFAULT_HOOK)
const pump = createPump(DEFAULT_PUMP)
const loop = createLoop(DEFAULT_LOOP, 1)
/** 어깨 너비 런닝 중앙값 — 모든 문턱의 분모 */
const norm = createNormalizer()

const st = ref<LoopState>(loop.state())
const aim = ref({ locked: false, x: W / 2 })
const reelRate = ref(0)
/** 추적 상태 — PiP 테두리 색이 이걸 따라간다. "왜 안 던져지지?"의 답을 상시 띄우는 용도 */
const trackOk = ref(false)
let marker: { x: number; y: number } | null = null
let splashes: Splash[] = []
let prevPhase = st.value.phase
/** 어깨 중점 x — 조준 0의 기준. 어깨를 놓친 프레임에는 직전 값을 유지한다 */
let bodyMidX = W / 2
/** 어깨 중점 y — 깊이 0.5의 기준. 어깨를 놓친 프레임에는 직전 값을 유지한다 */
let bodyMidY = H / 2
/**
 * 캐스팅용 어깨너비 래치 — 백스윙에 들어간 순간의 sw를 발사까지 고정한다.
 *
 * 팔을 올리면 어깨가 가려져 sw 관측이 21~28% 흔들린다(2026-07-30 실측: 던짐별 227/196/187/189px).
 * sw는 조준·낙하 문턱의 **분모**라, 백스윙 중에 흔들리면 착수점이 그만큼 밀린다. 백스윙 진입
 * 직전 값(팔을 들기 전, 가장 신뢰할 수 있는 관측)을 잡아두고 던지는 동안 그 값만 쓴다.
 * 판정 파일은 무수정 — cast.feed는 받은 sw를 쓸 뿐이다.
 */
let castSw = 0
/** 마지막 발사 파워 — 착수 물튀김 크기에만 쓴다(연출 전용, 거리와 무관) */
let lastPower = 0
/**
 * 화면 흔들림 0~1 — 매 프레임 감쇠한다.
 *
 * 초당 3씩 깎아 최대 세기에서 약 330ms 만에 멎는다. 더 길게 끌면 다음 동작을 조준하는 동안
 * 화면이 계속 떨려서 방해가 된다.
 */
let shake = 0
const SHAKE_DECAY_PER_SEC = 3

/** 물튀김 — 링 여러 개를 크기 차이를 두고 겹쳐야 "튀었다"로 읽힌다 */
function splash(x: number, y: number, radii: number[]) {
  for (const r of radii) splashes.push({ x, y, r, life: 0.6 })
}

const crank = computed(() => props.crankSide ?? 'right')

/** 캔버스에 그릴 문구. 짧게 유지한다 — 2~3m에서 읽혀야 한다 */
const hud = computed(() => {
  const s = st.value
  switch (s.phase) {
    case 'idle':
      return aim.value.locked ? '좌우로 조준하고 앞으로!' : '양손으로 대를 쥐고 뒤로'
    case 'casting':
      return '찌가 날아갑니다…'
    case 'waiting':
      return s.active?.interest === 'curious'
        ? '물고기가 미끼를 봤어요…'
        : '손 높이로 미끼 깊이를 조절!'
    case 'bite':
      return '입질! 손을 위로!'
    case 'fighting':
      return s.grace ? '걸렸다! 감으세요' : s.reeling ? '감기고 있다!' : '더 빨리!'
    case 'result':
      return s.last?.outcome === 'caught'
        ? `${s.last.name} +${s.last.score}`
        : s.last?.outcome === 'missed'
          ? '놓쳤다…'
          : '도망갔다…'
  }
})

let stream: MediaStream | null = null
let rafId = 0
let lastT = 0

function onPose(result: PoseLandmarkerResult) {
  const lm = result.landmarks?.[0]
  const now = performance.now()
  const phase = loop.state().phase

  // 분모 먼저 — 어깨를 못 본 프레임에는 직전 중앙값을 그대로 쓴다
  const sl = lm?.[SHOULDER.left]
  const sr = lm?.[SHOULDER.right]
  if (sl && sr && (sl.visibility ?? 0) >= VIS_MIN && (sr.visibility ?? 0) >= VIS_MIN) {
    norm.push(Math.hypot((sr.x - sl.x) * W, (sr.y - sl.y) * H))
    // 조준 0·깊이 0.5의 기준 — 어깨를 놓친 프레임에는 직전 값을 그대로 쓴다
    bodyMidX = ((1 - sl.x) * W + (1 - sr.x) * W) / 2
    bodyMidY = (sl.y * H + sr.y * H) / 2
  }
  const sw = norm.ready() ? norm.sw() : 0

  const wl = lm?.[WRIST.left]
  const wr = lm?.[WRIST.right]
  const leftOk = !!wl && (wl.visibility ?? 0) >= VIS_MIN
  const rightOk = !!wr && (wr.visibility ?? 0) >= VIS_MIN

  if (phase === 'fighting') {
    // 릴 감기 — 크랭크 손 손목 y의 왕복. 궤도가 세로로 긴 타원이라 x는 신호가 아니다
    const cw = crank.value === 'right' ? wr : wl
    const ok = crank.value === 'right' ? rightOk : leftOk
    if (cw && ok) {
      const y = cw.y * H
      marker = { x: (1 - cw.x) * W, y }
      reelRate.value = pump.feed(y, sw, now).rate
    } else {
      // 손을 놓치면 감기를 멈춘다. feed를 건너뛰면 마지막 rate가 남아 손을 내려도 게이지가 찬다
      marker = null
      reelRate.value = 0
    }
    return
  }

  // 캐스팅·훅킹 — 양손 손목의 중점. 한 손이라도 놓치면 판정이 멈춰 "양손으로 쥐었는지"가
  // 자동 검증된다
  if (!wl || !wr || !leftOk || !rightOk) {
    marker = null
    return
  }
  const midX = ((1 - wl.x) * W + (1 - wr.x) * W) / 2
  const midY = (wl.y * H + wr.y * H) / 2
  marker = { x: midX, y: midY }

  if (phase === 'idle') {
    // 백스윙 전에는 매 프레임 갱신, 백스윙에 들어가면 그 값으로 고정 (castSw 주석 참고)
    if (!aim.value.locked || !(castSw > 0)) castSw = sw
    // 조준 → 착수 거리. 스윙은 발사 게이트일 뿐, 파워는 거리에 관여하지 않는다
    const c = cast.feed(aimFromHands(midX, bodyMidX, castSw, W), midY, castSw, now)
    aim.value = { locked: c.phase === 'back', x: c.aimX ?? aim.value.x }
    // 조준은 발사 시점에 판정기가 확정한 값을 쓴다(내려꽂는 동안의 흔들림 배제)
    if (c.fired !== null) {
      lastPower = c.fired
      loop.cast(c.firedAimX)
    }
  } else if (phase === 'waiting') {
    // 양손 높이 → 미끼 깊이. 비어 있던 waiting 6초가 조작 구간이 된다
    loop.steer(depthFromHands(midY, bodyMidY, sw))
  } else if (phase === 'bite') {
    if (hook.feed(midY, sw, now).fired) loop.hook()
  }
}

function frame(now: number) {
  rafId = requestAnimationFrame(frame)
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0
  lastT = now

  if (dt > 0) {
    loop.tick(dt, st.value.phase === 'fighting' ? reelRate.value : 0)
    const s = loop.state()

    // 페이즈 전환 — 판정기를 초기화해 이전 동작이 새 페이즈로 새지 않게 한다
    if (s.phase !== prevPhase) {
      // 착수 — 파워는 여기서만 쓰인다. 세게 던질수록 물튀김이 크다(거리는 조준이 정했다)
      if (s.phase === 'waiting') {
        const k = 0.8 + lastPower * 0.7
        splash(s.bobber.x, s.bobber.y, [4 * k, 10 * k])
      }
      if (s.phase === 'bite') {
        hook.reset()
        // 물고기가 찌를 물어채는 순간. 흔들림이 "지금이다"를 몸으로 알려준다
        splash(s.bobber.x, s.bobber.y, [3, 8])
        shake = 0.55
      }
      if (s.phase === 'fighting') pump.reset()
      if (s.phase === 'idle') {
        cast.reset()
        aim.value = { locked: false, x: aim.value.x }
      }
      if (s.phase === 'result' && s.last?.outcome === 'caught') {
        // 포획 — 제일 큰 연출. 링 3겹 + 최대 세기 흔들림
        splash(s.bobber.x, s.bobber.y, [4, 12, 20])
        shake = 1
        emit('progress', s.score)
      }
      prevPhase = s.phase
    }
    st.value = s

    if (shake > 0) shake = Math.max(0, shake - dt * SHAKE_DECAY_PER_SEC)

    for (const p of splashes) {
      p.life -= dt
      p.r += dt * 90
    }
    splashes = splashes.filter((p) => p.life > 0)
  }

  // 추적 상태 — onPose가 프레임마다 marker를 갱신하므로 여기서 읽기만 한다
  trackOk.value = marker !== null

  const ctx = canvasRef.value?.getContext('2d')
  if (ctx) {
    drawFrame(ctx, cozySkin, DEFAULT_LOOP, {
      state: st.value,
      aim: aim.value,
      marker,
      splashes,
      video: videoRef.value ?? props.video ?? null,
      tMs: now,
      hud: hud.value,
      shake,
    })
  }
}

/** 게임룸이 게임 화면을 captureStream으로 송출할 수 있게 캔버스를 노출 (게임①④와 같은 패턴) */
defineExpose({ canvas: canvasRef })

onMounted(async () => {
  lastT = 0
  frame(performance.now())
  preloadPoseLandmarker((f) => (loadProgress.value = f))

  // 게임룸: 셀프 타일 비디오를 재사용 — 카메라를 새로 열지 않는다.
  // PiP는 같은 스트림을 다시 재생한다. 캔버스에 안 그리므로 다른 참가자에겐 안 나간다
  if (props.video) {
    const pip = videoRef.value!
    pip.srcObject = props.video.srcObject
    pip.play().catch(() => {})
    if (!(await pose.start(props.video, onPose)) && !(await pose.start(props.video, onPose))) {
      camError.value = pose.error.value ?? '자세 인식 모델을 불러오지 못했어요'
    }
    return
  }

  // dev 라우트: 직접 카메라를 연다
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
  <div class="game" :class="{ embedded }">
    <canvas ref="canvasRef" :width="W" :height="H" />
    <!-- 캠 PiP — 캔버스 밖 DOM. 프레이밍 확인용이라 나한테만 보이면 되고, 송출(캔버스)엔 안 섞인다 -->
    <video ref="videoRef" playsinline muted class="pip" :class="{ lost: !trackOk }" />

    <p class="notice" v-if="camError || pose.error.value">{{ camError || pose.error.value }}</p>
    <p class="notice" v-else-if="pose.isLoading.value">
      낚시터 준비 중… {{ Math.round(loadProgress * 100) }}%
    </p>

    <button type="button" class="close" @click="emit('close')">그만하기</button>
  </div>
</template>

<style scoped>
.game {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 16px;
  /* 페이지 배경은 크림 + 도트 — 방 밖에서 열었을 때 로비와 같은 세계로 보인다 */
  background-color: var(--c-cream);
  background-image: radial-gradient(rgba(56, 38, 61, 0.1) 1px, transparent 1px);
  background-size: 18px 18px;
  font-family: var(--font-pixel);
  overflow: hidden;
}
/* 게임룸 셀프 타일 위 오버레이 — 자체 페이지가 아니라 타일을 채운다 */
.game.embedded {
  position: absolute;
  inset: 0;
  min-height: 0;
  height: 100%;
  padding: 0;
  z-index: 5;
  border-radius: inherit;
}
canvas {
  display: block;
  width: min(640px, 100%);
  height: auto;
  border: var(--border-thick);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
}
.game.embedded canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border: none;
  border-radius: inherit;
  box-shadow: none;
}
/* 캠 PiP — 우하단 구석. 좌상단은 그만하기, 우상단은 점수, 하단 중앙은 HUD 배너 자리다.
   테두리는 UI 크롬 규약(잉크 + 하드 섀도우), 바깥 링이 추적 상태다(민트=잡힘 / 코랄=놓침) */
.pip {
  position: absolute;
  right: 14px;
  bottom: 14px;
  width: 110px;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  transform: scaleX(-1);
  background: #000;
  border: var(--border);
  border-radius: var(--radius-sm);
  box-shadow:
    0 0 0 3px var(--c-mint),
    var(--shadow-sm);
  pointer-events: none;
}
.pip.lost {
  box-shadow:
    0 0 0 3px var(--c-coral),
    var(--shadow-sm);
}
.notice {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  margin: 0;
  padding: 12px 20px;
  background: var(--c-paper);
  border: var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  color: var(--c-ink);
  font-size: 15px;
  text-align: center;
}
.close {
  position: absolute;
  top: 14px;
  left: 14px;
  padding: 7px 14px;
  background: var(--c-paper);
  color: var(--c-ink);
  border: var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: var(--t-fast);
}
.close:hover {
  transform: translate(-2px, -2px);
  box-shadow: var(--shadow-md);
}
.close:focus-visible {
  outline: 3px solid var(--c-blue);
  outline-offset: 2px;
}
</style>
