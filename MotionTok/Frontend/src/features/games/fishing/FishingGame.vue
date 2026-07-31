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
 * 게임룸은 이 컴포넌트의 **캔버스만** 화면공유로 송출한다. 그래서 관전자에게 보여야 하는
 * 것(점수)은 캔버스에 그리고(cozy 스킨의 drawHud), 플레이어 본인만 보면 되는 것(안내 문구·캠)은
 * 캔버스 위 최상단 DOM 바에 둔다 — 물속을 가려 시야를 망치던 걸 밖으로 뺐다(2026-07-31).
 *
 * 두 가지 생명주기로 돈다(게임①과 같은 계약):
 *   솔로(session=null)   — 시간 제한 없이 계속. dev 라우트·서버 미연동 폴백
 *   멀티(session 제공)   — 서버 권위 타이머(S15P11A706-116). startAt까지 입력을 막고,
 *                          endAt에 총점을 제출하며(finished), 순위는 results prop으로 받는다
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  preloadPoseLandmarker,
  usePoseLandmarker,
  type PoseLandmarkerResult,
} from '@/composables/usePoseLandmarker'
import type { GameResultEntry } from '@/api/types'
import EarnedPoints from '../EarnedPoints.vue'
import type { ActiveGameSession } from '../session'
import { createCast, DEFAULT_CAST } from './cast'
import { createHook, DEFAULT_HOOK } from './hook'
import { createPump, DEFAULT_PUMP } from './pump'
import { createLoop, DEFAULT_LOOP, type LoopConfig, type LoopState } from './loop'
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
  /** 멀티플레이 세션(GAME_START). null이면 솔로 — 시간 제한 없이 계속 낚는다 */
  session?: ActiveGameSession | null
  /** GAME_END 순위 — 도착 전까지 "집계 중" 표시 */
  results?: GameResultEntry[] | null
  /** 순위에서 내 행을 강조하기 위한 참가자 id */
  myUserId?: string | null
}>()

const emit = defineEmits<{
  close: []
  /**
   * 물고기를 낚을 때마다 — 게임룸 스코어보드가 쓴다.
   *
   * 점수는 누적이라 서버 progress의 starsLit(0~10 클램프)에 실을 수 없다. 그래서 부모는
   * 마리 수만 중계하고(completedCount 자리), 총점은 종료 시 finished로 한 번 제출한다.
   */
  progress: [score: number, caught: number]
  /** 멀티 종료 집계 — totalScore가 서버 순위 입력이고 caught는 점수 상한의 근거다 */
  finished: [payload: { totalScore: number; caught: number }]
}>()

/**
 * 무대 설정 — **폭이 가변이다.**
 *
 * 640×480 고정이면 와이드한 타일에서 좌우에 레터박스가 생긴다(실기 지적 2026-07-31).
 * 높이는 480으로 고정하고(깊이 층·수면 y가 이 값을 기준으로 잡혀 있다) 폭만 컨테이너 비율에
 * 맞춰 늘린다. 폭은 착수 거리·배경 폭에만 쓰여서 늘려도 판정이 안 흔들린다.
 *
 * 같은 객체를 loop와 drawFrame이 함께 본다 — 여기서 width를 갈면 둘 다 다음 프레임부터 따라온다.
 */
const cfg: LoopConfig = { ...DEFAULT_LOOP }
const H = cfg.height
/** 템플릿의 canvas 비트맵 폭 바인딩용 — cfg.width와 항상 같이 갱신한다 */
const stageW = ref(cfg.width)

/** 컨테이너 비율에 맞춰 무대 폭을 다시 잡는다. 바뀔 때만 갱신(매 프레임 호출 아님) */
function fitStage(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return
  // 상·하한을 둔다 — 극단적인 비율에서 물고기 밀도가 이상해지지 않게
  const w = Math.round(Math.min(1280, Math.max(560, H * (r.width / r.height))))
  if (w === cfg.width) return
  cfg.width = w
  stageW.value = w
}

const pose = usePoseLandmarker()
const canvasRef = ref<HTMLCanvasElement>()
const videoRef = ref<HTMLVideoElement>()
const camError = ref<string | null>(null)
const loadProgress = ref(0)

// 계측 화면과 같은 문턱을 쓴다 — 여기서 덮어쓰지 않는다
const cast = createCast(DEFAULT_CAST)
const hook = createHook(DEFAULT_HOOK)
const pump = createPump(DEFAULT_PUMP)
const loop = createLoop(cfg, 1)
/** 어깨 너비 런닝 중앙값 — 모든 문턱의 분모 */
const norm = createNormalizer()

const st = ref<LoopState>(loop.state())
const aim = ref({ locked: false, x: cfg.width / 2 })
const reelRate = ref(0)
/** 크랭크 손을 놓쳤을 때 마지막 rate를 유지하는 상한(ms) — onPose의 유지 로직 주석 참고 */
const REEL_HOLD_MS = 200
/** 크랭크 손을 마지막으로 정상 관측한 시각 */
let lastReelAt = 0
/** 추적 상태 — PiP 테두리 색이 이걸 따라간다. "왜 안 던져지지?"의 답을 상시 띄우는 용도 */
const trackOk = ref(false)
let marker: { x: number; y: number } | null = null
let splashes: Splash[] = []
let prevPhase = st.value.phase
/** 어깨 중점 x — 조준 0의 기준. 어깨를 놓친 프레임에는 직전 값을 유지한다 */
let bodyMidX = cfg.width / 2
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

// ── 멀티플레이: 서버 권위 타이머 (S15P11A706-116) ──────────
/** 멀티 진행 단계. 솔로(session=null)는 항상 'playing' — 총 시간이 없다 */
const mpPhase = ref<'countdown' | 'playing' | 'result'>('playing')
const countdownLeft = ref(0)
const timeLeftSec = ref(0)
let finishEmitted = false
let mpTicker = 0

/** 서버 보정 시각 — 솔로에서는 쓰지 않는다 */
function serverNow(): number {
  return Date.now() + (props.session?.clockOffset ?? 0)
}

watch(
  () => props.session,
  (session) => {
    clearInterval(mpTicker)
    finishEmitted = false
    if (!session) {
      mpPhase.value = 'playing'
      return
    }
    // 이전 판의 점수·낚은 목록이 남아 있으면 그대로 제출된다 — 세션마다 초기화한다
    loop.reset()
    mpPhase.value = serverNow() >= session.startAt ? 'playing' : 'countdown'
    timeLeftSec.value = Math.max(0, (session.endAt - serverNow()) / 1000)
    mpTicker = window.setInterval(mpTick, 100)
  },
  { immediate: true },
)

function mpTick() {
  const session = props.session
  if (!session) return
  const now = serverNow()
  if (mpPhase.value === 'countdown') {
    countdownLeft.value = Math.max(1, Math.ceil((session.startAt - now) / 1000))
    if (now >= session.startAt) mpPhase.value = 'playing'
    return
  }
  if (mpPhase.value === 'playing') {
    timeLeftSec.value = Math.max(0, (session.endAt - now) / 1000)
    if (now >= session.endAt) finalizeRound()
  }
}

/** 시간 종료(또는 서버 조기 정산) — 총점을 한 번만 제출하고 결과 화면으로 넘긴다 */
function finalizeRound() {
  mpPhase.value = 'result'
  if (finishEmitted) return
  finishEmitted = true
  const s = loop.state()
  emit('finished', { totalScore: s.score, caught: s.caught.length })
}

// GAME_END 순위 도착(전원 제출로 인한 조기 정산 포함) → 결과 화면
watch(
  () => props.results,
  (results) => {
    if (results) finalizeRound()
  },
)

/** 판정을 돌리는 구간인가 — 카운트다운 중·종료 후에는 멈춘다 */
const inputOpen = computed(() => mpPhase.value === 'playing')

/** 최상단 UI 바에 띄우는 문구. 짧게 유지한다 — 2~3m에서 읽혀야 한다 */
const hud = computed(() => {
  const s = st.value
  // 남은 시간은 템플릿의 .clock 요소가 따로 그린다 — 한 줄에 문자열로 섞으면 둘 다 안 읽힌다
  const clock = ''
  switch (s.phase) {
    case 'idle':
      return clock + (aim.value.locked ? '좌우로 조준하고 앞으로!' : '양손으로 대를 쥐고 뒤로')
    case 'casting':
      return clock + '찌가 날아갑니다…'
    case 'waiting':
      return (
        clock +
        (s.active?.interest === 'curious'
          ? '물고기가 미끼를 봤어요…'
          : '손 높이로 미끼 깊이를 조절!')
      )
    case 'bite':
      return clock + '입질! 손을 위로!'
    case 'fighting':
      return clock + (s.grace ? '걸렸다! 감으세요' : s.reeling ? '감기고 있다!' : '더 빨리!')
    case 'result':
      return (
        clock +
        (s.last?.outcome === 'caught'
          ? `${s.last.name} +${s.last.score}`
          : s.last?.outcome === 'missed'
            ? '놓쳤다…'
            : '도망갔다…')
      )
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
    norm.push(Math.hypot((sr.x - sl.x) * cfg.width, (sr.y - sl.y) * H))
    // 조준 0·깊이 0.5의 기준 — 어깨를 놓친 프레임에는 직전 값을 그대로 쓴다
    bodyMidX = ((1 - sl.x) * cfg.width + (1 - sr.x) * cfg.width) / 2
    bodyMidY = (sl.y * H + sr.y * H) / 2
  }
  const sw = norm.ready() ? norm.sw() : 0

  // 카운트다운 중·라운드 종료 후에는 판정을 돌리지 않는다. 어깨너비(모든 문턱의 분모)는 위에서
  // 계속 모으므로, 3초 카운트다운이 곧 정규화 워밍업 구간이 된다.
  if (!inputOpen.value) {
    marker = null
    reelRate.value = 0
    return
  }

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
      marker = { x: (1 - cw.x) * cfg.width, y }
      reelRate.value = pump.feed(y, sw, now).rate
      lastReelAt = now
    } else {
      marker = null
      /*
       * 손을 놓쳤다고 곧바로 0을 박지 않는다 — REEL_HOLD_MS 동안은 마지막 rate를 유지한다.
       *
       * 팔을 돌리면 손목이 몸에 가려지는 각도가 반드시 생겨서 visibility가 한두 프레임씩
       * 떨어진다. 0을 넣으면 fight가 그 프레임을 "안 감았다"로 읽고 drain(gain의 1.5배)으로
       * 역주행한다 — 실기 지적 2026-07-31 "릴 감을 때 끊김"의 주범이다. 플레이어는 계속
       * 돌리고 있는데 신호만 끊긴 것이라, 유지가 맞다.
       *
       * 상한을 두는 이유는 반대 방향 오류를 막기 위해서다 — 손을 정말 내렸을 때도 게이지가
       * 계속 차면 안 된다. 200ms면 인식 실패(1~4프레임)는 덮고 실제 정지는 못 덮는다.
       */
      if (now - lastReelAt > REEL_HOLD_MS) reelRate.value = 0
    }
    return
  }

  // 캐스팅·훅킹 — 양손 손목의 중점. 한 손이라도 놓치면 판정이 멈춰 "양손으로 쥐었는지"가
  // 자동 검증된다
  if (!wl || !wr || !leftOk || !rightOk) {
    marker = null
    return
  }
  const midX = ((1 - wl.x) * cfg.width + (1 - wr.x) * cfg.width) / 2
  const midY = (wl.y * H + wr.y * H) / 2
  marker = { x: midX, y: midY }

  if (phase === 'idle') {
    // 백스윙 전에는 매 프레임 갱신, 백스윙에 들어가면 그 값으로 고정 (castSw 주석 참고)
    if (!aim.value.locked || !(castSw > 0)) castSw = sw
    // 조준 → 착수 거리. 스윙은 발사 게이트일 뿐, 파워는 거리에 관여하지 않는다
    const c = cast.feed(aimFromHands(midX, bodyMidX, castSw, cfg.width), midY, castSw, now)
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
        emit('progress', s.score, s.caught.length)
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
    drawFrame(ctx, cozySkin, cfg, {
      state: st.value,
      aim: aim.value,
      marker,
      splashes,
      video: videoRef.value ?? props.video ?? null,
      tMs: now,
      // 안내 문구는 캔버스에 안 그린다 — 아래 DOM 바로 뺐다(시야 확보, 실기 지적 2026-07-31).
      // 빈 문자열이면 cozy.drawHud가 배너를 건너뛰고 앵글러·점수 배지만 그린다(점수는 관전자용).
      hud: '',
      shake,
    })
  }
}

/** 게임룸이 게임 화면을 captureStream으로 송출할 수 있게 캔버스를 노출 (게임①④와 같은 패턴) */
defineExpose({ canvas: canvasRef })

let stageRO: ResizeObserver | null = null

onMounted(async () => {
  lastT = 0
  // 캔버스가 놓인 칸의 비율을 따라간다 — 레터박스 없이 꽉 채우려면 무대 비율이 같아야 한다
  const host = canvasRef.value?.parentElement
  if (host) {
    fitStage(host)
    if (typeof ResizeObserver !== 'undefined') {
      stageRO = new ResizeObserver(() => fitStage(host))
      stageRO.observe(host)
    }
  }
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
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: DEFAULT_LOOP.width, height: H } })
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
  stageRO?.disconnect()
  cancelAnimationFrame(rafId)
  pose.stop()
  stream?.getTracks().forEach((t) => t.stop())
  clearInterval(mpTicker)
})
</script>

<template>
  <div class="game" :class="{ embedded }">
    <canvas ref="canvasRef" :width="stageW" :height="H" />

    <!--
      상단 안내 — 캔버스 위 오버레이다. 배경을 반투명으로 둬서 물속이 비쳐 보인다.
      한 번 별도 행(바)으로 분리해봤다가 되돌렸다(2026-07-31): 게임 화면이 그만큼 줄어들고
      시야가 오히려 좁아졌다. 가리지 않는 방법은 자리를 빼는 게 아니라 투명도였다.
    -->
    <div class="topbar">
      <!-- 최종 순위 화면에는 자체 나가기 버튼이 있다 — 둘 다 보이면 두 개가 된다 -->
      <button v-if="!results" type="button" class="close" @click="emit('close')">그만하기</button>
      <p class="hudtext" :class="{ hot: st.phase === 'bite' || st.phase === 'fighting' }">
        <span v-if="session && mpPhase === 'playing'" class="clock">
          ⏱{{ Math.ceil(timeLeftSec) }}
        </span>
        {{ hud }}
      </p>
    </div>

    <!-- 캠 — 오른쪽 하단. 캔버스에 안 그리므로 송출(관전자 화면)에는 안 섞인다 -->
    <video ref="videoRef" playsinline muted class="pip" :class="{ lost: !trackOk }" />

    <p class="notice" v-if="camError || pose.error.value">{{ camError || pose.error.value }}</p>
    <p class="notice" v-else-if="pose.isLoading.value">
      낚시터 준비 중… {{ Math.round(loadProgress * 100) }}%
    </p>

    <!-- 멀티 카운트다운 — 서버 startAt까지. 이 구간에는 판정이 멈춰 있다(onPose 가드) -->
    <div v-if="session && mpPhase === 'countdown'" class="ov">
      <p class="ov-guide">
        양손으로 대를 쥐고 뒤로 젖혀 던지고, 기다리는 동안 손 높이로 깊이를 맞춰요 —<br />
        깊은 층일수록 점수가 큰 물고기!
      </p>
      <p class="ov-count">{{ countdownLeft }}</p>
    </div>

    <!-- 멀티 결과 — GAME_END 순위가 오기 전에는 내 집계만 보여준다 -->
    <div v-if="session && mpPhase === 'result'" class="ov">
      <template v-if="results">
        <p class="ov-title">🏆 최종 순위</p>
        <ol class="ov-ranking">
          <li v-for="r in results" :key="r.userId" :class="{ me: r.userId === myUserId }">
            <span class="ov-rank">{{ r.rank }}</span>
            <span class="ov-name">{{ r.nickname }}</span>
            <span class="ov-score">{{ r.finished ? `${r.score}점` : '미제출' }}</span>
          </li>
        </ol>
        <EarnedPoints :results="results" :my-user-id="myUserId" />
        <button type="button" class="ov-quit" @click="emit('close')">대기실로 돌아가기</button>
      </template>
      <template v-else>
        <p class="ov-title">⏱ 낚시 종료!</p>
        <p class="ov-big">{{ st.score }}<small>점</small></p>
        <p class="ov-sub">{{ st.caught.length }}마리 · 🎣 다른 참가자를 기다리는 중…</p>
      </template>
    </div>

  </div>
</template>

<style scoped>
.game {
  position: relative;
  display: grid;
  /*
   * 캔버스 짤림을 만든 함정 두 개를 여기서 막는다(둘 다 2026-07-31 실측으로 잡았다).
   *
   * ① minmax(0, ...)의 **0**. 기본 트랙(auto)은 콘텐츠 최소 크기 아래로 안 줄어드는데,
   *    캔버스의 콘텐츠 기여는 고유 비율에서 역산한 높이다(폭 1024 → 768). 그래서 컨테이너가
   *    576으로 확정돼 있어도 행이 768로 커지고 overflow: hidden이 아래를 잘라냈다.
   *    0을 주면 행이 576으로 줄고, 그제서야 캔버스의 height: 100%가 576으로 해석된다.
   *    — 게임룸 .room-footer의 grid-template-columns 주석과 같은 함정이다.
   * ② place-items: center를 쓰면 안 된다. 아이템이 콘텐츠 크기가 되어 같은 역산이 다시 걸린다.
   *    늘려서 영역을 채우고, 가운데 정렬은 object-fit: contain에 맡긴다.
   */
  grid-template-rows: minmax(0, 1fr);
  grid-template-columns: minmax(0, 1fr);
  /* min-height면 컨테이너 높이 자체가 콘텐츠 기반이 되어 위 트랙 계산의 기준이 사라진다 */
  height: 100vh;
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
  height: 100%;
  z-index: 5;
  border-radius: inherit;
}
/*
 * 캔버스는 타일을 꽉 채우고 object-fit: contain이 4:3을 지킨다.
 * 고유 크기 + max-height 조합을 쓰면 위 주석의 짤림이 재발한다.
 */
canvas {
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: none;
  border-radius: inherit;
  box-shadow: none;
  object-fit: contain;
}

/* ── 상단 안내 오버레이 ── */
.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 6;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  /* 오른쪽은 캔버스에 그려지는 점수 배지 자리다 — 여기까지 문구가 오면 점수를 가린다
     (실기 지적 2026-07-31). 배지는 무대 우상단 고정이라 비율로 비워 두면 어느 크기에서도 안 겹친다 */
  padding: 12px clamp(96px, 14%, 170px) 12px 14px;
  /* 오버레이 전체가 클릭을 먹으면 아래 캔버스가 죽는다 — 버튼만 되살린다 */
  pointer-events: none;
}
.topbar .close {
  pointer-events: auto;
}
/* 안내 문구 — 반투명 배경. 물속이 비쳐 보여야 시야를 안 가린다 */
.hudtext {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 8px 14px;
  background: rgba(56, 38, 61, 0.42);
  backdrop-filter: blur(2px);
  border-radius: var(--radius-md);
  color: #fff;
  /* 반투명 위 글자는 그림자가 있어야 배경 밝기와 무관하게 읽힌다 */
  text-shadow: 0 2px 3px rgba(0, 0, 0, 0.55);
  font-size: clamp(13px, 1.8vw, 19px);
  line-height: 1.35;
  text-align: center;
}
/* 입질·힘겨루기 — 지금 뭘 해야 하는지가 제일 중요한 구간이라 불투명하게 띄운다 */
.hudtext.hot {
  background: rgba(239, 104, 114, 0.88);
  text-shadow: 0 2px 3px rgba(0, 0, 0, 0.4);
}
/* 남은 시간 — 문구와 같은 줄이지만 노란색으로 분리해 둘 다 읽히게 */
.clock {
  margin-right: 8px;
  color: var(--c-yellow);
  font-variant-numeric: tabular-nums;
}

/* 캠 — 오른쪽 하단. 좌상단은 그만하기, 상단은 안내, 우상단은 점수 배지가 쓴다.
   테두리는 UI 크롬 규약(잉크 + 하드 섀도우), 바깥 링이 추적 상태다(민트=잡힘 / 코랄=놓침) */
.pip {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 6;
  width: clamp(150px, 24%, 260px);
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
  /* 오버레이(.ov, z-index 6)보다 위 — 카운트다운·순위 대기 중에도 나갈 수 있어야 한다 */
  position: relative;
  z-index: 7;
  flex: none;
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

/* 멀티 오버레이 — 캔버스 위를 덮는다. 관전자에게는 안 보인다(캔버스만 송출) */
.ov {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  background: rgba(56, 38, 61, 0.74);
  color: var(--c-paper);
  text-align: center;
}
.ov-guide {
  margin: 0;
  font-size: 12px;
  line-height: 1.9;
}
.ov-count {
  margin: 0;
  font-size: 56px;
  color: var(--c-yellow);
}
.ov-title {
  margin: 0;
  font-size: 16px;
}
.ov-big {
  margin: 0;
  font-size: 44px;
  color: var(--c-yellow);
}
.ov-big small {
  font-size: 16px;
}
.ov-sub {
  margin: 0;
  font-size: 12px;
}
.ov-ranking {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 240px;
  max-height: 50%;
  overflow-y: auto;
}
.ov-ranking li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 2px solid rgba(255, 255, 255, 0.16);
  border-radius: var(--radius-sm);
}
.ov-ranking li.me {
  border-color: var(--c-mint);
  background: rgba(255, 255, 255, 0.16);
}
.ov-rank {
  min-width: 18px;
  color: var(--c-yellow);
}
.ov-name {
  flex: 1;
  text-align: left;
}
.ov-score {
  color: var(--c-mint);
}
.ov-quit {
  padding: 8px 16px;
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
.ov-quit:hover {
  transform: translate(-2px, -2px);
  box-shadow: var(--shadow-md);
}
.ov-quit:focus-visible {
  outline: 3px solid var(--c-blue);
  outline-offset: 2px;
}
</style>
