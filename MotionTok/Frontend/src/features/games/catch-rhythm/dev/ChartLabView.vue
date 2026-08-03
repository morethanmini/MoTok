<script setup lang="ts">
/**
 * 채보 랩 (/dev/chart-lab) — 곡 파일을 넣으면 분석해서 채보를 만드는 운영 도구.
 *
 * 난이도 두 갈래:
 * - EASY/NORMAL/HARD: 곡 분석(온셋)만으로 자동 생성
 * - SUPERHARD/EXTREME: **슬롯 채보** — 곡을 마디에 맞춰 ~10초 슬롯으로 쪼개고,
 *   슬롯마다 사람이 키보드로 리듬을 친다(앞뒤 문맥을 들려주되 슬롯 범위 입력만 기록).
 *   전 슬롯이 모여 하나의 채보가 되고, 아무 슬롯이나 다시 듣고 재녹음할 수 있다.
 *
 * 공통: 생성된 채보는 즉시 플레이(캐치/링)하거나 JSON으로 내보낸다.
 * CatchRhythmDevView처럼 카탈로그에 노출되지 않는 dev 라우트다.
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import CatchRhythmStage from '../CatchRhythmStage.vue'
import { DIFFICULTIES, type Difficulty } from '../generator/presets'
import { analyzeSong, type SongAnalysis } from '../analysis/analyzeSong'
import { correctTapTracks, HOLD_MIN_MS, type TapEvent } from '../analysis/tapBackbone'
import { formatSongAccentsSnippet } from '../analysis/accentExport'
import {
  generateSongCatchChart,
  generateSongRingChart,
  isTappedDifficulty,
  ringDraftToGameChart,
  songStartMs,
  type SongChartOptions,
  type SongDifficulty,
} from '../generator/songChart'
import type { Beatmap } from '../core/beatmap'
import type { RingBeatmap } from '../ring/ringLogic'

// ── 곡 로드·분석 ──
const fileName = ref<string | null>(null)
const fileUrl = ref<string | null>(null)
const audioBuffer = shallowRef<AudioBuffer | null>(null)
const analysis = shallowRef<SongAnalysis | null>(null)
const analyzing = ref(false)
const progress = ref(0)
const errorMsg = ref('')

// ── 옵션 (간소화: 난이도·시드·모드가 전부) ──
const difficulty = ref<SongDifficulty>('NORMAL')
const isTapped = computed(() => isTappedDifficulty(difficulty.value))
/** 스테이지 prop용 — 직접 찍는 난이도는 스테이지가 모르는 값이고, 커스텀 채보에선 안 쓴다 */
const stageDifficulty = computed<Difficulty>(() =>
  isTapped.value ? 'HARD' : (difficulty.value as Difficulty),
)
const seed = ref<string>('20260731')
const playMode = ref<'catch' | 'ring'>('catch')

// ── 플레이 ──
const running = ref(false)
const runKey = ref(0)
const playChart = shallowRef<Beatmap | RingBeatmap | null>(null)
const playDurationMs = ref(0)
const lastResult = ref<string | null>(null)

const waveCanvas = ref<HTMLCanvasElement | null>(null)
const zoomCanvas = ref<HTMLCanvasElement | null>(null)
const tapFile = ref<HTMLInputElement | null>(null)

const songLengthMs = () =>
  audioBuffer.value ? (audioBuffer.value.length / audioBuffer.value.sampleRate) * 1000 : 0

// ═══════════════════ 슬롯 채보 (SUPERHARD/EXTREME) ═══════════════════
// 탭은 **두 트랙**: 왼손(asdf…) / 오른손(jkl;…). 단일 스트림이면 동시 입력이
// 이중 입력 제거(100ms)에 접혀 동타·"홀드 중 다른 손 연주"가 불가능하다(실사용 발견).
// 두 트랙은 리듬 입력용일 뿐 — 게임 손·레인 배치는 여전히 생성기가 자유롭게 정한다.

type TapTrack = 'L' | 'R'
const tapsL = ref<TapEvent[]>([]) // 왼손 패스 → 생성기에는 perc 스트림으로
const tapsR = ref<TapEvent[]>([]) // 오른손 패스 → melody 스트림으로
const trackArr = (track: TapTrack) => (track === 'L' ? tapsL : tapsR)
const totalTaps = computed(() => tapsL.value.length + tapsR.value.length)

/** 왼손/오른손 키 배치 — 이 밖의 키는 무시한다(Backspace·Esc 제외) */
const LEFT_KEYS = new Set(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyQ', 'KeyW', 'KeyE', 'KeyR'])
const RIGHT_KEYS = new Set(['KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'KeyU', 'KeyI', 'KeyO', 'KeyP'])

const slotIdx = ref(0)
/**
 * 보정 모드 — 기본 '없음'(친 그대로). 지연 보정은 검출 온셋 기준이라 사람의 기준과
 * 다르면 전체가 통째로 밀린다(실사용: 70ms 일괄 밀림 → 퍼펙트가 느려 보임).
 */
const correction = ref<'none' | 'latency' | 'snap30' | 'snap70'>('none')
const correctionOpts = computed(() => ({
  applyLatency: correction.value !== 'none',
  snapWindowMs:
    correction.value === 'snap30' ? 30 : correction.value === 'snap70' ? 70 : 0,
}))

/** 슬롯 목표 길이 — 마디 단위로 맞추되 이 근처가 되게 */
const SLOT_TARGET_MS = 10_000
/** 녹음·듣기 때 슬롯 앞뒤로 들려주는 문맥 */
const CTX_BEFORE_MS = 3_000
const CTX_AFTER_MS = 1_500

interface Slot {
  from: number
  to: number
}

/** 곡을 마디(4박)에 맞춰 ~10초 슬롯으로 쪼갠다. 첫 슬롯은 인트로(격자 앞)까지 포함 */
const slots = computed<Slot[]>(() => {
  const a = analysis.value
  const len = songLengthMs()
  if (!a || len === 0) return []
  const measureMs = a.beatMs * 4
  const measuresPerSlot = Math.max(1, Math.round(SLOT_TARGET_MS / measureMs))
  const stepMs = measuresPerSlot * measureMs
  const out: Slot[] = []
  let from = 0
  for (let t = a.gridOriginMs + stepMs; t < len - 1000; t += stepMs) {
    out.push({ from, to: Math.round(t) })
    from = Math.round(t)
  }
  out.push({ from, to: Math.round(len) })
  return out
})

const currentSlot = computed<Slot | null>(() => slots.value[slotIdx.value] ?? null)

function slotDone(i: number): boolean {
  const s = slots.value[i]
  if (!s) return false
  return [...tapsL.value, ...tapsR.value].some((e) => e.t >= s.from && e.t < s.to)
}

const doneCount = computed(() => slots.value.filter((_, i) => slotDone(i)).length)

function selectSlot(i: number) {
  slotIdx.value = Math.max(0, Math.min(slots.value.length - 1, i))
  const s = slots.value[slotIdx.value]
  if (s) {
    selStartMs.value = s.from
    selEndMs.value = s.to
  }
  selectedTap.value = null
  drawWave()
}

/** 탭 보정 결과 — 직접 찍는 난이도에서만 쓴다. 왼손=perc, 오른손=melody 스트림으로 */
const backbone = computed(() => {
  if (!analysis.value || !isTapped.value || totalTaps.value === 0) return null
  return correctTapTracks(
    { perc: tapsL.value, melody: tapsR.value },
    analysis.value,
    correctionOpts.value,
  )
})

// ── 탭 자동 저장 — 곡 파일명 + 난이도별로 따로 산다 ──
const TAPS_STORE = 'chart-lab:slots:'
const tapsKey = () =>
  fileName.value && isTapped.value ? `${TAPS_STORE}${fileName.value}:${difficulty.value}` : null

watch([tapsL, tapsR], () => {
  const key = tapsKey()
  if (!key) return
  if (totalTaps.value === 0) localStorage.removeItem(key)
  else localStorage.setItem(key, JSON.stringify({ l: tapsL.value, r: tapsR.value }))
})

function loadTapsFromStore() {
  const key = tapsKey()
  if (!key) {
    tapsL.value = []
    tapsR.value = []
    return
  }
  try {
    const raw = localStorage.getItem(key)
    const json = raw ? (JSON.parse(raw) as { l?: unknown; r?: unknown; taps?: unknown }) : null
    if (json && (json.l !== undefined || json.r !== undefined)) {
      tapsL.value = parseTapList(json.l)
      tapsR.value = parseTapList(json.r)
    } else if (json?.taps !== undefined) {
      // 구버전(단일 스트림)은 왼손 트랙으로 승계한다
      tapsL.value = parseTapList(json.taps)
      tapsR.value = []
    } else {
      tapsL.value = []
      tapsR.value = []
    }
  } catch {
    tapsL.value = []
    tapsR.value = []
  }
}

watch(difficulty, () => {
  stopTapping()
  stopPreview()
  loadTapsFromStore()
  selectedTap.value = null
  if (isTapped.value && slots.value.length > 0) selectSlot(slotIdx.value)
  drawWave()
})

/** 구버전(숫자 배열)·현행({t, d} 배열) 둘 다 받는다 */
function parseTapList(raw: unknown): TapEvent[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((v): TapEvent | null => {
      if (typeof v === 'number') return { t: v, d: 0 }
      if (v && typeof v === 'object' && typeof (v as TapEvent).t === 'number') {
        return {
          t: (v as TapEvent).t,
          d: typeof (v as TapEvent).d === 'number' ? (v as TapEvent).d : 0,
        }
      }
      return null
    })
    .filter((v): v is TapEvent => v !== null)
}

// ── 슬롯 녹음 — 앞뒤 문맥을 들려주되 슬롯 범위 안의 입력만 기록한다 ──
const tapping = ref(false)
const tapPosMs = ref(0)
let tapCtx: AudioContext | null = null
let tapSource: AudioBufferSourceNode | null = null
let tapStartCtxSec = 0
let tapRaf = 0
/** 재생이 시작되는 파일 내 시각(문맥 포함) */
let playFromMs = 0
/** 입력을 기록으로 인정하는 범위 = 현재 슬롯 */
let recFromMs = 0
let recToMs = 0
const pendingDowns = new Map<string, { t: number; track: TapTrack }>()
/** 이번 세션에 확정된 탭의 트랙 순서 — Backspace 무르기가 마지막 것을 정확히 지운다 */
let pushHistory: TapTrack[] = []

function tapNowMs(): number {
  return tapCtx ? playFromMs + (tapCtx.currentTime - tapStartCtxSec) * 1000 : 0
}

function startSlotRecord() {
  const s = currentSlot.value
  if (!audioBuffer.value || !s || tapping.value) return
  stop()
  stopPreview()
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  tapCtx = new AudioContext()
  tapSource = tapCtx.createBufferSource()
  tapSource.buffer = audioBuffer.value
  tapSource.connect(tapCtx.destination)
  tapStartCtxSec = tapCtx.currentTime + 0.1
  playFromMs = Math.max(0, s.from - CTX_BEFORE_MS)
  recFromMs = s.from
  recToMs = s.to
  const playToMs = Math.min(songLengthMs(), s.to + CTX_AFTER_MS)
  tapSource.start(tapStartCtxSec, playFromMs / 1000, Math.max(0.05, (playToMs - playFromMs) / 1000))
  tapSource.onended = () => stopTapping()
  // 다시 친다 = 이 슬롯을 대체한다(양 트랙 모두) — 슬롯 밖은 보존
  tapsL.value = tapsL.value.filter((e) => e.t < s.from || e.t >= s.to)
  tapsR.value = tapsR.value.filter((e) => e.t < s.from || e.t >= s.to)
  selectedTap.value = null
  pendingDowns.clear()
  pushHistory = []
  tapping.value = true
  window.addEventListener('keydown', onTapKey)
  window.addEventListener('keyup', onTapKeyUp)
  const tick = () => {
    if (!tapping.value || !tapCtx) return
    tapPosMs.value = tapNowMs()
    drawZoom()
    tapRaf = requestAnimationFrame(tick)
  }
  tick()
}

function onTapKey(e: KeyboardEvent) {
  if (e.repeat) return
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if (e.code === 'Escape') {
    stopTapping()
    return
  }
  if (e.code === 'Backspace') {
    // 방금 친 게 틀렸을 때 — 녹음을 끊지 않고 마지막 탭만 무른다(그 탭의 트랙에서)
    e.preventDefault()
    const track = pushHistory.pop()
    if (track) {
      const arrRef = trackArr(track)
      arrRef.value = arrRef.value.slice(0, -1)
    }
    return
  }
  // 왼손(asdf…) / 오른손(jkl;…) 트랙 분기 — 그 밖의 키는 무시
  const track: TapTrack | null = LEFT_KEYS.has(e.code)
    ? 'L'
    : RIGHT_KEYS.has(e.code)
      ? 'R'
      : null
  if (track === null) return
  e.preventDefault()
  if (!tapCtx || pendingDowns.has(e.code)) return
  const ms = tapNowMs()
  // 문맥 구간의 입력은 버린다 — 슬롯 범위 안만 진짜 노트다
  if (ms < recFromMs || ms >= recToMs) return
  pendingDowns.set(e.code, { t: ms, track })
}

function onTapKeyUp(e: KeyboardEvent) {
  const down = pendingDowns.get(e.code)
  if (down === undefined) return
  pendingDowns.delete(e.code)
  if (!tapCtx) return
  const d = Math.max(0, tapNowMs() - down.t)
  const arrRef = trackArr(down.track)
  arrRef.value = [
    ...arrRef.value,
    { t: Math.round(down.t), d: d >= HOLD_MIN_MS ? Math.round(d) : 0 },
  ]
  pushHistory.push(down.track)
}

function stopTapping() {
  if (!tapping.value) return
  // 아직 눌린 채인 키(슬롯 끝까지 잡고 있던 홀드)는 지금 시각까지로 확정한다
  if (pendingDowns.size > 0 && tapCtx) {
    const now = tapNowMs()
    for (const down of pendingDowns.values()) {
      const d = Math.max(0, now - down.t)
      const arrRef = trackArr(down.track)
      arrRef.value = [
        ...arrRef.value,
        { t: Math.round(down.t), d: d >= HOLD_MIN_MS ? Math.round(d) : 0 },
      ]
    }
    pendingDowns.clear()
  }
  tapping.value = false
  window.removeEventListener('keydown', onTapKey)
  window.removeEventListener('keyup', onTapKeyUp)
  cancelAnimationFrame(tapRaf)
  try {
    tapSource?.stop()
  } catch {
    // 이미 끝났으면 무시
  }
  tapSource = null
  void tapCtx?.close()
  tapCtx = null
  drawWave()
}

// ── 듣기·미리듣기 ──
const previewing = ref(false)
const previewPosMs = ref(0)
let previewCtx: AudioContext | null = null
let previewSource: AudioBufferSourceNode | null = null
let previewFromMs = 0
let previewStartAtSec = 0
let previewRaf = 0

/**
 * range 재생. withTaps면 보정된 탭 위치에 비프를 얹는다(곡은 덕킹) —
 * "듣고 → 마우스로 고치고 → 다시 듣는" 루프의 심장.
 */
function playRange(from: number, to: number, withTaps: boolean) {
  if (!audioBuffer.value || previewing.value) return
  stop()
  stopTapping()
  previewCtx = new AudioContext()
  previewSource = previewCtx.createBufferSource()
  previewSource.buffer = audioBuffer.value
  const songGain = previewCtx.createGain()
  songGain.gain.value = withTaps ? 0.35 : 1 // 덕킹 — 비프가 곡에 묻히지 않게
  previewSource.connect(songGain).connect(previewCtx.destination)
  const startAt = previewCtx.currentTime + 0.08
  previewSource.onended = () => stopPreview()
  previewSource.start(startAt, from / 1000, Math.max(0.05, (to - from) / 1000))

  if (withTaps && backbone.value) {
    const beep = (atSec: number, freq: number, durSec: number, gain: number) => {
      if (!previewCtx) return
      const osc = previewCtx.createOscillator()
      const g = previewCtx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      g.gain.setValueAtTime(gain, atSec)
      g.gain.exponentialRampToValueAtTime(0.001, atSec + durSec)
      osc.connect(g).connect(previewCtx.destination)
      osc.start(atSec)
      osc.stop(atSec + durSec + 0.01)
    }
    for (const o of backbone.value.onsets) {
      if (o.timeMs < from || o.timeMs > to) continue
      const at = startAt + (o.timeMs - from) / 1000
      const isLeft = o.source === 'perc' // 왼손 트랙 — 낮은 음으로 구분
      beep(at, isLeft ? 700 : 1568, o.holdMs ? 0.12 : 0.05, 0.55)
      if (o.holdMs) beep(at + o.holdMs / 1000, isLeft ? 520 : 1175, 0.06, 0.4) // 홀드 끝 틱
    }
  }
  previewFromMs = from
  previewStartAtSec = startAt
  previewing.value = true
  const tick = () => {
    if (!previewing.value || !previewCtx) return
    previewPosMs.value = previewFromMs + Math.max(0, (previewCtx.currentTime - previewStartAtSec) * 1000)
    drawZoom()
    previewRaf = requestAnimationFrame(tick)
  }
  tick()
}

/** 현재 슬롯을 앞뒤 문맥 포함으로 듣는다 */
function listenSlot(withTaps: boolean) {
  const s = currentSlot.value
  if (!s) return
  playRange(
    Math.max(0, s.from - CTX_BEFORE_MS),
    Math.min(songLengthMs(), s.to + CTX_AFTER_MS),
    withTaps,
  )
}

function previewAll(withTaps: boolean) {
  playRange(0, songLengthMs(), withTaps)
}

function stopPreview() {
  if (!previewing.value) return
  previewing.value = false
  cancelAnimationFrame(previewRaf)
  try {
    previewSource?.stop()
  } catch {
    // 이미 끝났으면 무시
  }
  previewSource = null
  void previewCtx?.close()
  previewCtx = null
  drawZoom()
}

// ── 탭 미세수정 (확대 뷰와 연동) ──
const selectedTap = ref<{ track: TapTrack; index: number } | null>(null)

const selectedTapEvent = computed(() => {
  const sel = selectedTap.value
  if (!sel) return null
  return trackArr(sel.track).value[sel.index] ?? null
})

const latencyNow = () => backbone.value?.latencyMs ?? 0

const selectedTapMs = computed(() =>
  selectedTapEvent.value === null ? null : Math.round(selectedTapEvent.value.t - latencyNow()),
)

function selectTapNear(ms: number, tolMs = 80) {
  const lat = latencyNow()
  let best: { track: TapTrack; index: number } | null = null
  let bestDist = tolMs
  for (const track of ['L', 'R'] as const) {
    const arr = trackArr(track).value
    for (let i = 0; i < arr.length; i++) {
      const dist = Math.abs(arr[i]!.t - lat - ms)
      if (dist < bestDist) {
        bestDist = dist
        best = { track, index: i }
      }
    }
  }
  selectedTap.value = best
}

function editSelected(mutate: (e: TapEvent) => TapEvent) {
  const sel = selectedTap.value
  if (!sel) return
  const arrRef = trackArr(sel.track)
  if (arrRef.value[sel.index] === undefined) return
  const next = [...arrRef.value]
  next[sel.index] = mutate(next[sel.index]!)
  arrRef.value = next
  drawWave()
}

function nudgeTap(deltaMs: number) {
  editSelected((e) => ({ ...e, t: Math.max(0, e.t + deltaMs) }))
}

function adjustHold(deltaMs: number) {
  editSelected((e) => ({ ...e, d: Math.max(0, e.d + deltaMs) }))
}

function toggleHold() {
  editSelected((e) => ({ ...e, d: e.d >= HOLD_MIN_MS ? 0 : 600 }))
}

function deleteTap() {
  const sel = selectedTap.value
  if (!sel) return
  const arrRef = trackArr(sel.track)
  arrRef.value = arrRef.value.filter((_, idx) => idx !== sel.index)
  selectedTap.value = null
  drawWave()
}

function clearTaps() {
  tapsL.value = []
  tapsR.value = []
  selectedTap.value = null
  drawWave()
}

function exportTaps() {
  download(
    `${base()}-${difficulty.value}-taps.json`,
    JSON.stringify({
      audio: fileName.value,
      difficulty: difficulty.value,
      l: tapsL.value,
      r: tapsR.value,
    }),
  )
}

async function importTaps(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const json = JSON.parse(await file.text()) as {
      l?: unknown
      r?: unknown
      taps?: unknown
      perc?: unknown
      melody?: unknown
    }
    if (json.l !== undefined || json.r !== undefined) {
      tapsL.value = parseTapList(json.l)
      tapsR.value = parseTapList(json.r)
    } else {
      // 구버전: 단일 {taps} 또는 {perc, melody} — 왼손/오른손으로 승계
      tapsL.value = [...parseTapList(json.taps), ...parseTapList(json.perc)].sort(
        (a, b) => a.t - b.t,
      )
      tapsR.value = parseTapList(json.melody)
    }
    drawWave()
  } catch {
    errorMsg.value = '탭 파일을 읽을 수 없어요'
  }
  ;(e.target as HTMLInputElement).value = ''
}

// ═══════════════════ 곡 로드·분석·생성 ═══════════════════

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  errorMsg.value = ''
  analysis.value = null
  stop()
  stopTapping()
  stopPreview()
  if (fileUrl.value) URL.revokeObjectURL(fileUrl.value)
  fileUrl.value = URL.createObjectURL(file)
  fileName.value = file.name
  try {
    // 디코드 전용 컨텍스트 — 재생은 각 기능이 자기 컨텍스트로 한다
    const ctx = new AudioContext()
    audioBuffer.value = await ctx.decodeAudioData(await file.arrayBuffer())
    void ctx.close()
    loadTapsFromStore()
    slotIdx.value = 0
  } catch {
    errorMsg.value = '오디오를 디코드할 수 없어요 (mp3/ogg/wav 지원)'
    audioBuffer.value = null
  }
}

async function analyze() {
  if (!audioBuffer.value || analyzing.value) return
  analyzing.value = true
  progress.value = 0
  errorMsg.value = ''
  try {
    analysis.value = await analyzeSong(audioBuffer.value, (r) => (progress.value = r))
    if (isTapped.value) selectSlot(0)
  } catch (err) {
    errorMsg.value = `분석 실패: ${(err as Error).message}`
  } finally {
    analyzing.value = false
  }
  drawWave()
}

function randomSeed() {
  seed.value = String(Math.floor(Math.random() * 2 ** 31))
}

function options(): SongChartOptions {
  return {
    subdivision: 4,
    snap: 'free',
    title: fileName.value ? `${fileName.value} ${difficulty.value}` : undefined,
    backbone: backbone.value ? backbone.value.onsets : null,
  }
}

function buildCatch(): Beatmap | null {
  if (!analysis.value) return null
  return generateSongCatchChart(analysis.value, difficulty.value, seed.value, options())
}

function play() {
  const a = analysis.value
  if (!a || !fileUrl.value) return
  if (isTapped.value && !backbone.value) {
    errorMsg.value = '먼저 슬롯을 녹음하세요 — 직접 찍는 난이도는 탭이 곧 채보예요'
    return
  }
  const chart =
    playMode.value === 'catch'
      ? buildCatch()
      : ringDraftToGameChart(generateSongRingChart(a, difficulty.value, seed.value, options()), a)
  if (!chart || chart.notes.length === 0) {
    errorMsg.value = '채보에 노트가 없어요'
    return
  }
  stopPreview()
  stopTapping()
  playChart.value = chart
  playDurationMs.value = chart.durationMs + 2000
  lastResult.value = null
  runKey.value += 1
  running.value = true
}

function stop() {
  running.value = false
}

function onFinished(r: { score: number; maxCombo: number }) {
  lastResult.value = `${r.score.toLocaleString()}점 / 최대 콤보 ${r.maxCombo}`
}

// ── 내보내기 ──

function download(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

function base(): string {
  return (fileName.value ?? '곡').replace(/\.[^.]+$/, '')
}

function exportCatch() {
  const chart = buildCatch()
  if (chart) download(`${base()}-catch-${difficulty.value}.json`, JSON.stringify(chart, null, 2))
}

function exportRing() {
  if (!analysis.value) return
  const draft = generateSongRingChart(analysis.value, difficulty.value, seed.value, {
    ...options(),
    audio: fileName.value ? `audio/${fileName.value}` : null,
  })
  download(`${base()}-ring-${difficulty.value}.json`, JSON.stringify(draft, null, 2))
}

function exportAccents() {
  if (!analysis.value) return
  download(
    `${base()}-songAccents.ts.txt`,
    formatSongAccentsSnippet(analysis.value, fileName.value ?? '곡'),
    'text/plain',
  )
}

// ═══════════════════ 파형(전체)·확대 뷰 ═══════════════════

const selStartMs = ref<number | null>(null)
const selEndMs = ref<number | null>(null)
let dragStartMs: number | null = null
let dragged = false
let zoomDragging = false

function canvasMs(e: MouseEvent): number {
  const canvas = waveCanvas.value
  if (!canvas) return 0
  const rect = canvas.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  return ratio * songLengthMs()
}

function onWaveDown(e: MouseEvent) {
  if (!audioBuffer.value) return
  dragStartMs = canvasMs(e)
  dragged = false
}

function onWaveMove(e: MouseEvent) {
  if (dragStartMs === null) return
  const ms = canvasMs(e)
  if (dragged || Math.abs(ms - dragStartMs) > 80) {
    dragged = true
    selStartMs.value = Math.round(Math.min(dragStartMs, ms))
    selEndMs.value = Math.round(Math.max(dragStartMs, ms))
    drawWave()
  }
}

function onWaveUp(e: MouseEvent) {
  if (dragStartMs === null) return
  if (!dragged) {
    // 클릭 = 그 지점이 속한 슬롯 선택 (직접 찍는 난이도)
    const ms = canvasMs(e)
    if (isTapped.value) {
      const i = slots.value.findIndex((s) => ms >= s.from && ms < s.to)
      if (i >= 0) selectSlot(i)
    }
  }
  dragStartMs = null
  drawWave()
}

function onWaveLeave() {
  dragStartMs = null
}

function drawWave() {
  const canvas = waveCanvas.value
  const buffer = audioBuffer.value
  if (!canvas || !buffer) return
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const durationMs = songLengthMs()
  const msToX = (ms: number) => (ms / durationMs) * w

  // 파형
  const data = buffer.getChannelData(0)
  const mid = h * 0.55
  const amp = h * 0.4
  ctx.fillStyle = 'rgba(90, 130, 180, 0.5)'
  const samplesPerPx = data.length / w
  for (let x = 0; x < w; x++) {
    let min = 0
    let max = 0
    const s0 = Math.floor(x * samplesPerPx)
    const s1 = Math.min(data.length, Math.floor((x + 1) * samplesPerPx))
    const stride = Math.max(1, Math.floor((s1 - s0) / 24))
    for (let s = s0; s < s1; s += stride) {
      const v = data[s]!
      if (v < min) min = v
      if (v > max) max = v
    }
    ctx.fillRect(x, mid + min * amp, 1, Math.max(1, (max - min) * amp))
  }

  const a = analysis.value
  if (a) {
    // 온셋 (세기 = 막대 높이)
    for (const o of a.onsets) {
      const x = msToX(o.timeMs)
      const bar = Math.min(1, o.strength / 2) * (h * 0.4)
      ctx.fillStyle = o.bands.low > 0.45 ? 'rgba(255,150,60,0.7)' : 'rgba(120,220,160,0.7)'
      ctx.fillRect(x - 1, h - bar, 2, bar)
    }
  }

  // 슬롯 경계 + 완료 표시 (직접 찍는 난이도)
  if (isTapped.value) {
    slots.value.forEach((s, i) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'
      ctx.beginPath()
      const x = Math.round(msToX(s.from)) + 0.5
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
      if (slotDone(i)) {
        ctx.fillStyle = 'rgba(120,220,160,0.15)'
        ctx.fillRect(msToX(s.from), 0, msToX(s.to) - msToX(s.from), h)
      }
    })
  }

  // 탭 마커 (보정 후)
  if (backbone.value) {
    for (const o of backbone.value.onsets) {
      const x = msToX(o.timeMs)
      ctx.fillStyle = 'rgba(110,190,255,0.95)'
      ctx.fillRect(x - 1, 8, 2, h * 0.3)
      if (o.holdMs) {
        ctx.fillStyle = 'rgba(110,190,255,0.45)'
        ctx.fillRect(x, 12, Math.max(3, msToX(o.timeMs + o.holdMs) - x), 5)
      }
    }
  }

  // 선택 구간(현재 슬롯)
  if (selStartMs.value !== null && selEndMs.value !== null) {
    const x0 = msToX(selStartMs.value)
    const x1 = msToX(selEndMs.value)
    ctx.fillStyle = 'rgba(255, 207, 125, 0.12)'
    ctx.fillRect(x0, 0, x1 - x0, h)
    ctx.strokeStyle = 'rgba(255, 207, 125, 0.85)'
    ctx.lineWidth = 1.5
    for (const x of [x0, x1]) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
  }

  // 확대 뷰도 같이 — 캔버스가 이 프레임에 막 생겼을 수 있어 다음 프레임에 그린다
  requestAnimationFrame(() => drawZoom())
}

// ── 확대 편집 뷰 — "키보드로 찍고, 마우스로 세부 조정"의 마우스 절반 ──

function zoomRect(): { from: number; to: number } | null {
  if (selStartMs.value === null || selEndMs.value === null) return null
  return { from: selStartMs.value, to: selEndMs.value }
}

function zoomMsOf(e: MouseEvent): number | null {
  const r = zoomRect()
  const c = zoomCanvas.value
  if (!r || !c) return null
  const rect = c.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  return r.from + ratio * (r.to - r.from)
}

function drawZoom() {
  const c = zoomCanvas.value
  const buffer = audioBuffer.value
  const r = zoomRect()
  if (!c || !buffer || !r) return
  const dpr = window.devicePixelRatio || 1
  const w = c.clientWidth
  const h = c.clientHeight
  c.width = w * dpr
  c.height = h * dpr
  const ctx = c.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const span = Math.max(1, r.to - r.from)
  const msToX = (ms: number) => ((ms - r.from) / span) * w

  // 파형
  const data = buffer.getChannelData(0)
  const sr = buffer.sampleRate
  const mid = h * 0.5
  const amp = h * 0.42
  ctx.fillStyle = 'rgba(90, 130, 180, 0.45)'
  for (let x = 0; x < w; x++) {
    const t0 = r.from + (x / w) * span
    const t1 = r.from + ((x + 1) / w) * span
    const s0 = Math.max(0, Math.floor((t0 / 1000) * sr))
    const s1 = Math.min(data.length, Math.floor((t1 / 1000) * sr))
    let min = 0
    let max = 0
    const stride = Math.max(1, Math.floor((s1 - s0) / 32))
    for (let s = s0; s < s1; s += stride) {
      const v = data[s]!
      if (v < min) min = v
      if (v > max) max = v
    }
    ctx.fillRect(x, mid + min * amp, 1, Math.max(1, (max - min) * amp))
  }

  const a = analysis.value
  if (a) {
    // 격자 — 박은 진하게, 16분 칸은 연하게
    const stepMs = a.beatMs / 4
    for (let k = Math.floor((r.from - a.gridOriginMs) / stepMs); ; k++) {
      const t = a.gridOriginMs + k * stepMs
      if (t > r.to) break
      if (t < r.from) continue
      const beatIdx = k / 4
      const onBeat = Math.abs(beatIdx - Math.round(beatIdx)) < 1e-6
      ctx.strokeStyle = onBeat ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)'
      ctx.beginPath()
      const x = Math.round(msToX(t)) + 0.5
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
    // 검출 온셋 — 하단 짧은 틱(참고용)
    for (const o of a.onsets) {
      if (o.timeMs < r.from || o.timeMs > r.to) continue
      ctx.fillStyle = o.bands.low > 0.45 ? 'rgba(255,150,60,0.8)' : 'rgba(120,220,160,0.8)'
      ctx.fillRect(msToX(o.timeMs) - 1, h - 18, 2, 14)
    }
  }

  // 탭 마커 — 왼손 주황(위쪽 절반), 오른손 하늘(아래쪽 절반)으로 겹침 없이 보인다
  const lat = latencyNow()
  for (const track of ['L', 'R'] as const) {
    const arr = trackArr(track).value
    const color = track === 'L' ? 'rgba(255,150,80,0.95)' : 'rgba(110,190,255,0.95)'
    const yTop = track === 'L' ? 6 : h * 0.5
    const yLen = h * 0.5 - 22
    for (let i = 0; i < arr.length; i++) {
      const ev = arr[i]!
      const t = ev.t - lat
      if (t < r.from - 200 || t > r.to + 200) continue
      const x = msToX(t)
      if (ev.d >= HOLD_MIN_MS) {
        ctx.fillStyle = color.replace('0.95', '0.35')
        ctx.fillRect(x, yTop + 4, Math.max(3, msToX(t + ev.d) - x), 12)
      }
      ctx.fillStyle = color
      ctx.fillRect(x - 2, yTop, 4, yLen)
      if (selectedTap.value?.track === track && selectedTap.value.index === i) {
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.strokeRect(x - 5, yTop - 2, 10, yLen + 4)
      }
    }
  }

  // 재생 헤드
  const pos = tapping.value ? tapPosMs.value : previewing.value ? previewPosMs.value : null
  if (pos !== null && pos >= r.from && pos <= r.to) {
    ctx.strokeStyle = '#ff5370'
    ctx.lineWidth = 2
    ctx.beginPath()
    const x = msToX(pos)
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
}

function onZoomDown(e: MouseEvent) {
  const ms = zoomMsOf(e)
  const r = zoomRect()
  const c = zoomCanvas.value
  if (ms === null || !r || !c) return
  const tolMs = Math.max(8, (12 / c.clientWidth) * (r.to - r.from))
  selectTapNear(ms, tolMs)
  if (selectedTap.value !== null) zoomDragging = true
  drawZoom()
}

function onZoomMove(e: MouseEvent) {
  if (!zoomDragging) return
  const ms = zoomMsOf(e)
  if (ms === null) return
  editSelected((ev) => ({ ...ev, t: Math.max(0, Math.round(ms + latencyNow())) }))
  drawZoom()
}

function onZoomUp() {
  zoomDragging = false
}

/** 더블클릭 = 탭 추가 — 위쪽 절반 = 왼손, 아래쪽 절반 = 오른손 (마커 표시와 같은 규칙) */
function onZoomDbl(e: MouseEvent) {
  const ms = zoomMsOf(e)
  const c = zoomCanvas.value
  if (ms === null || !isTapped.value || !c) return
  const rect = c.getBoundingClientRect()
  const track: TapTrack = e.clientY - rect.top < rect.height / 2 ? 'L' : 'R'
  const arrRef = trackArr(track)
  arrRef.value = [...arrRef.value, { t: Math.round(ms + latencyNow()), d: 0 }]
  selectedTap.value = { track, index: arrRef.value.length - 1 }
  drawZoom()
}

watch([analysis, audioBuffer, backbone], drawWave)
window.addEventListener('resize', drawWave)
onBeforeUnmount(() => {
  stopTapping()
  stopPreview()
  window.removeEventListener('resize', drawWave)
  if (fileUrl.value) URL.revokeObjectURL(fileUrl.value)
})
</script>

<template>
  <main class="lab">
    <header class="bar">
      <h1>채보 랩 <small>곡 분석 → 자동/수제 채보</small></h1>
      <label class="file">
        곡 파일
        <input type="file" accept="audio/*" @change="onFile" />
      </label>
      <button type="button" class="primary" :disabled="!audioBuffer || analyzing" @click="analyze">
        {{ analyzing ? `분석 중 ${Math.round(progress * 100)}%` : '♪ 분석' }}
      </button>
      <template v-if="analysis">
        <span class="dim">BPM {{ analysis.bpm }} · 신뢰도 {{ analysis.confidence }}</span>
      </template>
    </header>

    <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

    <section v-if="analysis" class="controls main-row">
      <label>
        난이도
        <select v-model="difficulty" :disabled="running || tapping">
          <option v-for="d in DIFFICULTIES" :key="d" :value="d">{{ d }} (자동)</option>
          <option value="SUPERHARD">SUPER HARD (직접)</option>
          <option value="EXTREME">EXTREME (직접)</option>
        </select>
      </label>
      <label>
        시드
        <input v-model="seed" size="10" :disabled="running" />
      </label>
      <button type="button" :disabled="running" @click="randomSeed">🎲</button>
      <label>
        모드
        <select v-model="playMode" :disabled="running">
          <option value="catch">캐치</option>
          <option value="ring">링</option>
        </select>
      </label>
      <button v-if="!running" type="button" class="primary" @click="play">▶ 플레이</button>
      <button v-else type="button" @click="stop">중단</button>
      <span class="divider"></span>
      <button type="button" @click="exportCatch">캐치 JSON</button>
      <button type="button" @click="exportRing">링 JSON(에디터)</button>
      <button type="button" @click="exportAccents">songAccents</button>
      <span v-if="lastResult" class="result">{{ lastResult }}</span>
    </section>

    <section v-if="audioBuffer" class="wave-wrap">
      <canvas
        ref="waveCanvas"
        class="wave"
        @mousedown="onWaveDown"
        @mousemove="onWaveMove"
        @mouseup="onWaveUp"
        @mouseleave="onWaveLeave"
      ></canvas>
      <p class="legend">
        <span class="dot kick"></span>킥 온셋 <span class="dot mel"></span>온셋 ·
        <span class="dot tap"></span>내 탭 · 초록 배경 = 찍은 슬롯 · 클릭 = 슬롯 선택 · 드래그 = 구간 지정
      </p>
    </section>

    <!-- ── 슬롯 채보 워크플로 (SUPER HARD / EXTREME) ── -->
    <template v-if="analysis && isTapped">
      <section class="controls tapbox">
        <b>{{ difficulty }} 슬롯 채보</b>
        <span class="dim">
          {{ doneCount }}/{{ slots.length }} 슬롯 · 왼손(ASDF) {{ tapsL.length }} · 오른손(JKL;) {{ tapsR.length }}
        </span>
        <span v-if="backbone && correction !== 'none'" class="dim">
          · 지연 보정 {{ backbone.latencyMs }}ms · 온셋 일치 {{ Math.round(backbone.matchedRatio * 100) }}%
        </span>
        <label>
          보정
          <select v-model="correction" :disabled="tapping">
            <option value="none">없음 — 친 그대로</option>
            <option value="latency">지연만 제거</option>
            <option value="snap30">지연 + 온셋 스냅 ±30ms</option>
            <option value="snap70">지연 + 온셋 스냅 ±70ms</option>
          </select>
        </label>
        <button v-if="!previewing" type="button" :disabled="tapping || !totalTaps" @click="previewAll(true)">
          ♪ 전체 미리듣기
        </button>
        <button v-else type="button" @click="stopPreview">■ 정지</button>
        <button type="button" :disabled="!totalTaps" @click="exportTaps">탭 저장</button>
        <label>
          <button type="button" @click="tapFile?.click()">탭 불러오기</button>
          <input ref="tapFile" type="file" accept=".json" style="display: none" @change="importTaps" />
        </label>
        <button type="button" :disabled="!totalTaps" @click="clearTaps">전체 지우기</button>
      </section>

      <section class="slots">
        <button
          v-for="(s, i) in slots"
          :key="i"
          type="button"
          class="chip"
          :class="{ done: slotDone(i), active: i === slotIdx }"
          :disabled="tapping"
          @click="selectSlot(i)"
        >
          {{ i + 1 }}
        </button>
      </section>

      <section v-if="currentSlot" class="controls">
        <b class="slot-label">
          슬롯 {{ slotIdx + 1 }} — {{ (currentSlot.from / 1000).toFixed(1) }}~{{ (currentSlot.to / 1000).toFixed(1) }}s
        </b>
        <button v-if="!previewing" type="button" :disabled="tapping" @click="listenSlot(false)">
          ▶ 듣기 (앞뒤 포함)
        </button>
        <button v-if="!previewing" type="button" :disabled="tapping || !slotDone(slotIdx)" @click="listenSlot(true)">
          ♪ 미리듣기
        </button>
        <button v-if="previewing" type="button" @click="stopPreview">■ 정지</button>
        <button v-if="!tapping" type="button" class="primary" :disabled="running" @click="startSlotRecord">
          ● {{ slotDone(slotIdx) ? '재녹음' : '녹음' }} — 왼손 ASDF·오른손 JKL; · 누르면 홀드 · ⌫ 무르기 · Esc 종료
        </button>
        <button v-else type="button" @click="stopTapping">■ 정지 {{ (tapPosMs / 1000).toFixed(1) }}s</button>
        <button
          type="button"
          :disabled="tapping || slotIdx >= slots.length - 1"
          @click="selectSlot(slotIdx + 1)"
        >
          다음 슬롯 →
        </button>
      </section>

      <div v-if="selectedTap !== null && selectedTapMs !== null && selectedTapEvent" class="controls tapedit">
        <b>탭 미세수정</b>
        <span class="dim">
          {{ selectedTap.track === 'L' ? '왼손' : '오른손' }} ·
          {{ (selectedTapMs / 1000).toFixed(3) }}s ·
          {{ selectedTapEvent.d >= 250 ? `홀드 ${selectedTapEvent.d}ms` : '탭' }}
        </span>
        <button type="button" @click="nudgeTap(-20)">−20ms</button>
        <button type="button" @click="nudgeTap(-5)">−5ms</button>
        <button type="button" @click="nudgeTap(5)">+5ms</button>
        <button type="button" @click="nudgeTap(20)">+20ms</button>
        <button type="button" @click="toggleHold">{{ selectedTapEvent.d >= 250 ? '탭으로' : '홀드로' }}</button>
        <template v-if="selectedTapEvent.d >= 250">
          <button type="button" @click="adjustHold(-100)">홀드 −100</button>
          <button type="button" @click="adjustHold(100)">홀드 +100</button>
        </template>
        <button type="button" @click="deleteTap">삭제</button>
        <button type="button" @click="selectedTap = null">선택 해제</button>
      </div>
    </template>

    <section v-if="audioBuffer && selStartMs !== null && selEndMs !== null" class="wave-wrap">
      <canvas
        ref="zoomCanvas"
        class="zoom"
        @mousedown="onZoomDown"
        @mousemove="onZoomMove"
        @mouseup="onZoomUp"
        @mouseleave="onZoomUp"
        @dblclick="onZoomDbl"
      ></canvas>
      <p class="legend">
        <b>확대</b> — <span class="dot kick"></span>왼손(위) <span class="dot tap"></span>오른손(아래) ·
        마커 드래그 = 이동 · 더블클릭 = 탭 추가(위쪽 절반 = 왼손, 아래쪽 = 오른손) · 클릭 = 선택 · 격자 = 16분음표
      </p>
    </section>

    <section class="board-wrap">
      <CatchRhythmStage
        v-if="running && playChart && fileUrl && analysis"
        :key="runKey"
        :seed="seed"
        :difficulty="stageDifficulty"
        :duration-ms="playDurationMs"
        :mode="playMode"
        :chart="playChart"
        :song="{
          src: fileUrl,
          gridOriginMs: analysis.gridOriginMs,
          startMs: songStartMs(analysis),
        }"
        @finished="onFinished"
        @error="(m: string) => (errorMsg = m)"
      >
        <template #result-actions>
          <button type="button" class="primary" @click="play">다시</button>
        </template>
      </CatchRhythmStage>
      <div v-else class="idle">
        <p v-if="!audioBuffer">곡 파일을 올리면 시작해요 (파일은 서버로 전송되지 않아요)</p>
        <p v-else-if="!analysis">♪ 분석을 누르면 BPM·온셋을 찾아요</p>
        <p v-else-if="isTapped">
          슬롯을 골라 ▶ 듣기 → ● 녹음 → ♪ 미리듣기 순서로 채워가세요. 다 채우면 ▶ 플레이!
        </p>
        <p v-else>▶ 플레이 또는 JSON 내보내기로 이어가세요</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.lab {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background: #10141c;
  color: #dfe7ef;
  font-family: var(--font-pixel, system-ui);
}
.bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem 1rem;
  background: #171d28;
  border-bottom: 1px solid #232c3a;
}
h1 {
  font-size: 1rem;
  margin-right: auto;
}
h1 small {
  color: #8b97a6;
  font-weight: 400;
}
label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: #aab6c4;
}
select,
input {
  padding: 0.25rem 0.4rem;
  border: 1px solid #2c3648;
  border-radius: 6px;
  background: #0e1219;
  color: inherit;
  font: inherit;
}
button {
  padding: 0.35rem 0.8rem;
  border: 1px solid #2c3648;
  border-radius: 6px;
  background: #1a2230;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button.primary {
  background: #e07a4f;
  border-color: #e07a4f;
  color: #fff;
}
.error {
  padding: 0.5rem 1rem;
  background: #3a1f1c;
  color: #ff9c86;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 1rem;
}
.main-row .divider {
  width: 1px;
  height: 1.4rem;
  background: #2c3648;
}
.wave-wrap {
  padding: 0.3rem 1rem 0;
}
.wave {
  width: 100%;
  height: 110px;
  display: block;
  background: #0b0f16;
  border: 1px solid #232c3a;
  border-radius: 8px;
  cursor: crosshair;
}
.zoom {
  width: 100%;
  height: 190px;
  display: block;
  background: #0b0f16;
  border: 1px solid #3a4658;
  border-radius: 8px;
  cursor: crosshair;
}
.legend {
  font-size: 0.75rem;
  color: #8b97a6;
  margin: 0.25rem 0 0;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin: 0 0.25rem 0 0.6rem;
}
.dot.kick {
  background: rgb(255, 150, 60);
}
.dot.mel {
  background: rgb(120, 220, 160);
}
.dot.tap {
  background: rgb(110, 190, 255);
}
.tapbox {
  border: 1px dashed #2c3648;
  border-radius: 8px;
  margin: 0.4rem 1rem 0;
}
.tapbox b,
.slot-label {
  color: #ffcf7d;
  font-size: 0.85rem;
}
.tapedit {
  border: 1px solid #2c3648;
  border-radius: 8px;
  margin: 0 1rem;
  background: #131a26;
}
.tapedit b {
  color: #9fd8ff;
  font-size: 0.85rem;
}
.slots {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  padding: 0.3rem 1rem;
}
.chip {
  min-width: 2.2rem;
  padding: 0.25rem 0.4rem;
  text-align: center;
}
.chip.done {
  border-color: #3fa87e;
  color: #9fd8b4;
}
.chip.active {
  background: #e07a4f;
  border-color: #e07a4f;
  color: #fff;
}
.dim {
  color: #8b97a6;
  font-size: 0.85rem;
}
.result {
  color: #9fd8b4;
  font-size: 0.85rem;
}
.board-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
}
.idle {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6d7a89;
  text-align: center;
  padding: 1rem;
}
</style>
