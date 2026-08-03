<script setup lang="ts">
/**
 * 채보 랩 (/dev/chart-lab) — 곡 파일을 넣으면 분석해서 채보 초안을 만들어 주는 운영 도구.
 *
 * 흐름: 곡 로드 → 분석(BPM·격자·온셋·지속음) → 파형 위에서 결과 확인 →
 *       난이도·격자 옵션으로 초안 생성 → 즉시 플레이(캐치/링) 또는 JSON 내보내기.
 *
 * 내보내기 세 종류:
 * - 캐치 채보 JSON — 게임 스키마(core/beatmap.ts) 그대로
 * - 링 초안 JSON — 프로토타입 에디터(motion-party-proto)에서 열어 수정하는 용도
 * - songAccents 스니펫 — 인게임 곡을 갈아끼울 때 CHART_BPM·SLOT_ACCENTS 교체용 (P5)
 *
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
  ringDraftToGameChart,
  songStartMs,
  type SongChartOptions,
  type SongDifficulty,
} from '../generator/songChart'
import type { Beatmap } from '../core/beatmap'
import type { RingBeatmap } from '../ring/ringLogic'

// ── 곡 로드·분석 상태 ──
const fileName = ref<string | null>(null)
const fileUrl = ref<string | null>(null)
const audioBuffer = shallowRef<AudioBuffer | null>(null)
const analysis = shallowRef<SongAnalysis | null>(null)
const analyzing = ref(false)
const progress = ref(0)
const errorMsg = ref('')

// ── 초안 옵션 ──
const difficulty = ref<SongDifficulty>('NORMAL')
/** 스테이지 prop용 — MANUAL은 스테이지가 모르는 값이고, 커스텀 채보에선 어차피 안 쓴다 */
const stageDifficulty = computed<Difficulty>(() =>
  difficulty.value === 'MANUAL' ? 'NORMAL' : difficulty.value,
)
const subdivision = ref<2 | 3 | 4 | 6 | 8>(4)
const snap = ref<'hybrid' | 'grid' | 'free'>('free')
const seed = ref<string>('20260731')
const playMode = ref<'catch' | 'ring'>('catch')

// ── 플레이 상태 ──
const running = ref(false)
const runKey = ref(0)
const playChart = shallowRef<Beatmap | RingBeatmap | null>(null)
const playDurationMs = ref(0)
const lastResult = ref<string | null>(null)

const waveCanvas = ref<HTMLCanvasElement | null>(null)
const tapFile = ref<HTMLInputElement | null>(null)

// ── 탭 백본 — 곡을 들으며 키보드로 친 리듬을 뼈대로 쓴다 (드럼/보컬 두 패스) ──
// 키를 짧게 = 탭, 누르고 있으면(≥250ms) = 홀드(롱노트 재료)
const tapTrack = ref<'perc' | 'melody'>('melody')
const percTaps = ref<TapEvent[]>([])
const melodyTaps = ref<TapEvent[]>([])
const tapping = ref(false)
const tapPosMs = ref(0)
const useBackbone = ref(true)
/** 트랙→손 고정: 드럼=왼손·보컬=오른손 (백본 사용 시에만 적용) */
const handByTrack = ref(false)
let tapCtx: AudioContext | null = null
let tapSource: AudioBufferSourceNode | null = null
let tapStartCtxSec = 0
let tapRaf = 0
/** 눌린 채인 키들 — keyup에서 길이를 계산한다 (코드별이라 두 손가락 겹침도 된다) */
const pendingDowns = new Map<string, number>()

/** 탭 자동 저장 키 — 파일명 기준. 다운로드 안 해도 새로고침·재방문에 살아남는다 */
const TAPS_STORE = 'chart-lab:taps:'
watch([percTaps, melodyTaps], () => {
  if (!fileName.value) return
  const key = TAPS_STORE + fileName.value
  if (percTaps.value.length + melodyTaps.value.length === 0) localStorage.removeItem(key)
  else
    localStorage.setItem(
      key,
      JSON.stringify({ perc: percTaps.value, melody: melodyTaps.value }),
    )
})

/** 온셋 스냅 창 — 0이면 지연 보정만. 넓으면 옆의 다른 소리로 빨려간다(실사용 피드백) */
const snapWindow = ref<0 | 30 | 70>(30)

/** 탭 보정 결과 — 분석·탭·스냅 창이 바뀔 때마다 다시 계산 */
const backbone = computed(() => {
  if (!analysis.value) return null
  if (percTaps.value.length + melodyTaps.value.length === 0) return null
  return correctTapTracks(
    { perc: percTaps.value, melody: melodyTaps.value },
    analysis.value,
    { snapWindowMs: snapWindow.value },
  )
})

// ── 구간 선택 — 짤라듣기·구간 녹음·미세수정의 공통 기반 (파형 드래그) ──
const selStartMs = ref<number | null>(null)
const selEndMs = ref<number | null>(null)
const previewing = ref(false)
/** 클릭으로 고른 탭 — 미세수정(±ms·삭제) 대상. index는 원본 배열 기준 */
const selectedTap = ref<{ track: 'perc' | 'melody'; index: number } | null>(null)
let previewCtx: AudioContext | null = null
let previewSource: AudioBufferSourceNode | null = null
/** 구간 녹음 시 탭 시각의 원점(구간 시작) */
let tapRangeFromMs = 0
let dragStartMs: number | null = null
let dragged = false
// 재생 헤드(확대 뷰) — 미리듣기 진행 위치
const previewPosMs = ref(0)
let previewFromMs = 0
let previewStartAtSec = 0
let previewRaf = 0
/** 확대 뷰에서 마커를 드래그 중인가 */
let zoomDragging = false
const zoomCanvas = ref<HTMLCanvasElement | null>(null)

const songLengthMs = () =>
  audioBuffer.value ? (audioBuffer.value.length / audioBuffer.value.sampleRate) * 1000 : 0
const latencyNow = () => backbone.value?.latencyMs ?? 0

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
  if (!dragged) selectTapNear(canvasMs(e))
  dragStartMs = null
  drawWave()
}

function clearSelection() {
  selStartMs.value = null
  selEndMs.value = null
  drawWave()
}

function onWaveLeave() {
  dragStartMs = null
}

/** 클릭 지점에서 가장 가까운 탭(보정 표시 위치 기준)을 고른다 */
function selectTapNear(ms: number, tolMs = 80) {
  const lat = latencyNow()
  let best: { track: 'perc' | 'melody'; index: number } | null = null
  let bestDist = tolMs
  for (const track of ['perc', 'melody'] as const) {
    const arr = track === 'perc' ? percTaps.value : melodyTaps.value
    for (let index = 0; index < arr.length; index++) {
      const dist = Math.abs(arr[index]!.t - lat - ms)
      if (dist < bestDist) {
        bestDist = dist
        best = { track, index }
      }
    }
  }
  selectedTap.value = best
}

/** 선택한 탭 이벤트 — 수정 UI 표시·조작용 */
const selectedTapEvent = computed(() => {
  const sel = selectedTap.value
  if (!sel) return null
  const arr = sel.track === 'perc' ? percTaps.value : melodyTaps.value
  return arr[sel.index] ?? null
})

/** 선택한 탭의 화면 시각(지연 보정 후) */
const selectedTapMs = computed(() =>
  selectedTapEvent.value === null ? null : Math.round(selectedTapEvent.value.t - latencyNow()),
)

function editSelected(mutate: (e: TapEvent) => TapEvent) {
  const sel = selectedTap.value
  if (!sel) return
  const arrRef = sel.track === 'perc' ? percTaps : melodyTaps
  const cur = arrRef.value[sel.index]
  if (cur === undefined) return
  const next = [...arrRef.value]
  next[sel.index] = mutate(cur)
  arrRef.value = next
  drawWave()
}

function nudgeTap(deltaMs: number) {
  editSelected((e) => ({ ...e, t: Math.max(0, e.t + deltaMs) }))
}

/** 홀드 길이 조절 — 250ms 밑으로 내려가면 그냥 탭이 된다 */
function adjustHold(deltaMs: number) {
  editSelected((e) => ({ ...e, d: Math.max(0, e.d + deltaMs) }))
}

/** 탭 ↔ 홀드 전환 — 홀드로 바꾸면 기본 600ms에서 시작 */
function toggleHold() {
  editSelected((e) => ({ ...e, d: e.d >= HOLD_MIN_MS ? 0 : 600 }))
}

function deleteTap() {
  const sel = selectedTap.value
  if (!sel) return
  const arrRef = sel.track === 'perc' ? percTaps : melodyTaps
  arrRef.value = arrRef.value.filter((_, i) => i !== sel.index)
  selectedTap.value = null
  drawWave()
}

/**
 * 구간(없으면 전체) 짤라듣기.
 * withTaps면 보정된 탭 위치에 비프를 얹는다 — 드럼은 낮은 음, 보컬은 높은 음,
 * 홀드는 길게 + 끝날 때 틱. "녹음한 걸 들으면서 조정"하는 핵심 루프다.
 */
function playSection(withTaps = false) {
  if (!audioBuffer.value || previewing.value) return
  stop()
  stopTapping()
  previewCtx = new AudioContext()
  previewSource = previewCtx.createBufferSource()
  previewSource.buffer = audioBuffer.value
  previewSource.connect(previewCtx.destination)
  const from = selStartMs.value ?? 0
  const to = selEndMs.value ?? songLengthMs()
  // 곡·비프를 같은 클럭의 절대 시각으로 예약한다 — 어긋나면 미리듣기의 의미가 없다
  const startAt = previewCtx.currentTime + 0.08
  previewSource.onended = () => stopPreview()
  // 탭 미리듣기에서는 곡을 낮춘다(덕킹) — 안 그러면 비프가 곡에 묻혀 안 들린다
  const songGain = previewCtx.createGain()
  songGain.gain.value = withTaps ? 0.35 : 1
  previewSource.disconnect()
  previewSource.connect(songGain).connect(previewCtx.destination)
  previewSource.start(startAt, from / 1000, Math.max(0.05, (to - from) / 1000))

  if (withTaps && backbone.value) {
    const beep = (atSec: number, freq: number, durSec: number, gain: number) => {
      if (!previewCtx) return
      const osc = previewCtx.createOscillator()
      const g = previewCtx.createGain()
      osc.type = 'triangle' // 사인보다 배음이 있어 곡을 뚫고 들린다
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
      const isPerc = o.source === 'perc'
      beep(at, isPerc ? 700 : 1568, o.holdMs ? 0.12 : 0.05, 0.55)
      if (o.holdMs) beep(at + o.holdMs / 1000, isPerc ? 520 : 1175, 0.06, 0.4) // 홀드 끝 틱
    }
  }
  // 재생 헤드 — 확대 뷰에서 노트와 함께 움직인다
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

// ── 확대 편집 뷰 — 선택 구간을 크게 보고 마커를 직접 만진다 ──
// "키보드로 한 번에 찍고, 마우스로 세부 조정"의 마우스 쪽 절반.

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
    // 격자 — 박은 진하게, 현재 분할 설정 칸은 연하게
    const stepMs = a.beatMs / subdivision.value
    for (let k = Math.floor((r.from - a.gridOriginMs) / stepMs); ; k++) {
      const t = a.gridOriginMs + k * stepMs
      if (t > r.to) break
      if (t < r.from) continue
      const beatIdx = k / subdivision.value
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

  // 탭 마커 — 트랙 색 세로 막대 + 홀드 바 + 선택 테두리
  const lat = latencyNow()
  for (const track of ['perc', 'melody'] as const) {
    const arr = track === 'perc' ? percTaps.value : melodyTaps.value
    for (let i = 0; i < arr.length; i++) {
      const ev = arr[i]!
      const t = ev.t - lat
      if (t < r.from - 200 || t > r.to + 200) continue
      const x = msToX(t)
      const color = track === 'perc' ? 'rgba(255,120,80,0.95)' : 'rgba(110,190,255,0.95)'
      if (ev.d >= 250) {
        ctx.fillStyle = color.replace('0.95', '0.35')
        ctx.fillRect(x, 10, Math.max(3, msToX(t + ev.d) - x), 16)
      }
      ctx.fillStyle = color
      ctx.fillRect(x - 2, 6, 4, h - 24)
      if (selectedTap.value?.track === track && selectedTap.value.index === i) {
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.strokeRect(x - 5, 4, 10, h - 20)
      }
    }
  }

  // 재생 헤드 — 녹음·미리듣기 진행 위치
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
  // 12px 안의 마커를 잡는다 — 확대 배율에 맞춘 허용치
  const tolMs = Math.max(8, (12 / c.clientWidth) * (r.to - r.from))
  selectTapNear(ms, tolMs)
  if (selectedTap.value) zoomDragging = true
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

/** 더블클릭 = 현재 트랙에 탭 추가 — 빠진 노트를 마우스로 채워 넣는다 */
function onZoomDbl(e: MouseEvent) {
  const ms = zoomMsOf(e)
  if (ms === null) return
  const arrRef = tapTrack.value === 'perc' ? percTaps : melodyTaps
  arrRef.value = [...arrRef.value, { t: Math.round(ms + latencyNow()), d: 0 }]
  selectedTap.value = { track: tapTrack.value, index: arrRef.value.length - 1 }
  drawZoom()
}

function startTapping() {
  if (!audioBuffer.value || tapping.value) return
  stop()
  stopPreview()
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  tapCtx = new AudioContext()
  tapSource = tapCtx.createBufferSource()
  tapSource.buffer = audioBuffer.value
  tapSource.connect(tapCtx.destination)
  tapStartCtxSec = tapCtx.currentTime + 0.1 // 예약 재생 — 시작 지연이 탭 시각을 흔들지 않게
  // 구간이 선택돼 있으면 그 구간만 재생·기록한다 — 원테이크 강요 금지
  const from = selStartMs.value ?? 0
  const to = selEndMs.value ?? songLengthMs()
  tapRangeFromMs = from
  tapSource.start(tapStartCtxSec, from / 1000, Math.max(0.05, (to - from) / 1000))
  tapSource.onended = () => stopTapping()
  // 다시 친다 = 대체한다 — 전체 녹음이면 트랙 전체를, 구간 녹음이면 그 구간만 비운다
  const arrRef = tapTrack.value === 'perc' ? percTaps : melodyTaps
  arrRef.value =
    selStartMs.value === null ? [] : arrRef.value.filter((e) => e.t < from || e.t > to)
  selectedTap.value = null
  pendingDowns.clear()
  tapping.value = true
  window.addEventListener('keydown', onTapKey)
  window.addEventListener('keyup', onTapKeyUp)
  const tick = () => {
    if (!tapping.value || !tapCtx) return
    tapPosMs.value = tapRangeFromMs + Math.max(0, (tapCtx.currentTime - tapStartCtxSec) * 1000)
    drawZoom() // 확대 뷰의 재생 헤드·방금 친 탭이 실시간으로 보인다
    tapRaf = requestAnimationFrame(tick)
  }
  tick()
}

/** 지금 재생 중인 파일 내 시각(ms) */
function tapNowMs(): number {
  return tapCtx ? tapRangeFromMs + (tapCtx.currentTime - tapStartCtxSec) * 1000 : 0
}

function onTapKey(e: KeyboardEvent) {
  if (e.repeat) return
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if (e.code === 'Escape') {
    stopTapping()
    return
  }
  const arr = tapTrack.value === 'perc' ? percTaps : melodyTaps
  if (e.code === 'Backspace') {
    // 방금 친 게 틀렸을 때 — 녹음을 끊지 않고 마지막 탭만 무른다
    e.preventDefault()
    arr.value = arr.value.slice(0, -1)
    return
  }
  e.preventDefault()
  if (!tapCtx || pendingDowns.has(e.code)) return
  // 판정 시계와 같은 오디오 클럭으로 기록 — 계통 지연은 보정(correctTapTracks)이 흡수한다.
  // 확정은 keyup에서 — 누르고 있던 길이가 홀드 판정(HOLD_MIN_MS) 재료다.
  const ms = tapNowMs()
  if (ms < tapRangeFromMs) return
  pendingDowns.set(e.code, ms)
}

function onTapKeyUp(e: KeyboardEvent) {
  const down = pendingDowns.get(e.code)
  if (down === undefined) return
  pendingDowns.delete(e.code)
  if (!tapCtx) return
  const d = Math.max(0, tapNowMs() - down)
  const arr = tapTrack.value === 'perc' ? percTaps : melodyTaps
  arr.value = [...arr.value, { t: Math.round(down), d: d >= HOLD_MIN_MS ? Math.round(d) : 0 }]
}

function stopTapping() {
  if (!tapping.value) return
  // 아직 눌린 채인 키(끝까지 잡고 있던 홀드)는 지금 시각까지로 확정한다
  if (pendingDowns.size > 0 && tapCtx) {
    const now = tapNowMs()
    const arr = tapTrack.value === 'perc' ? percTaps : melodyTaps
    const flushed = [...pendingDowns.values()].map((down) => {
      const d = Math.max(0, now - down)
      return { t: Math.round(down), d: d >= HOLD_MIN_MS ? Math.round(d) : 0 }
    })
    arr.value = [...arr.value, ...flushed]
    pendingDowns.clear()
  }
  tapping.value = false
  window.removeEventListener('keydown', onTapKey)
  window.removeEventListener('keyup', onTapKeyUp)
  cancelAnimationFrame(tapRaf)
  try {
    tapSource?.stop()
  } catch {
    // 이미 끝났으면 던진다 — 정리 중이라 무시
  }
  tapSource = null
  void tapCtx?.close()
  tapCtx = null
  drawWave()
}

function clearTaps() {
  percTaps.value = []
  melodyTaps.value = []
  drawWave()
}

function exportTaps() {
  download(
    `${base()}-taps.json`,
    JSON.stringify({ audio: fileName.value, perc: percTaps.value, melody: melodyTaps.value }),
  )
}

/** 구버전(숫자 배열)·현행({t, d} 배열) 둘 다 받는다 */
function parseTapList(raw: unknown): TapEvent[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((v): TapEvent | null => {
      if (typeof v === 'number') return { t: v, d: 0 }
      if (v && typeof v === 'object' && typeof (v as TapEvent).t === 'number') {
        return { t: (v as TapEvent).t, d: typeof (v as TapEvent).d === 'number' ? (v as TapEvent).d : 0 }
      }
      return null
    })
    .filter((v): v is TapEvent => v !== null)
}

async function importTaps(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const json = JSON.parse(await file.text()) as { perc?: unknown; melody?: unknown }
    percTaps.value = parseTapList(json.perc)
    melodyTaps.value = parseTapList(json.melody)
    drawWave()
  } catch {
    errorMsg.value = '탭 파일을 읽을 수 없어요'
  }
  ;(e.target as HTMLInputElement).value = ''
}

function options(): SongChartOptions {
  return {
    subdivision: subdivision.value,
    snap: snap.value,
    title: fileName.value ? `${fileName.value} ${difficulty.value}` : undefined,
    backbone: useBackbone.value && backbone.value ? backbone.value.onsets : null,
    handByTrack: useBackbone.value && backbone.value ? handByTrack.value : false,
  }
}

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  errorMsg.value = ''
  analysis.value = null
  stop()
  if (fileUrl.value) URL.revokeObjectURL(fileUrl.value)
  fileUrl.value = URL.createObjectURL(file)
  fileName.value = file.name
  try {
    // 디코드 전용 컨텍스트 — 재생은 스테이지가 자기 컨텍스트로 한다
    const ctx = new AudioContext()
    audioBuffer.value = await ctx.decodeAudioData(await file.arrayBuffer())
    void ctx.close()
    // 같은 곡을 다시 열면 이전에 친 탭이 자동으로 돌아온다(파일명 기준 localStorage)
    const saved = localStorage.getItem(TAPS_STORE + file.name)
    if (saved) {
      try {
        const json = JSON.parse(saved) as { perc?: unknown; melody?: unknown }
        percTaps.value = parseTapList(json.perc)
        melodyTaps.value = parseTapList(json.melody)
      } catch {
        percTaps.value = []
        melodyTaps.value = []
      }
    } else {
      percTaps.value = []
      melodyTaps.value = []
    }
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

// ── 초안 생성·플레이 ──

function buildCatch(): Beatmap | null {
  if (!analysis.value) return null
  return generateSongCatchChart(analysis.value, difficulty.value, seed.value, options())
}

function play() {
  const a = analysis.value
  if (!a || !fileUrl.value) return
  const chart =
    playMode.value === 'catch'
      ? buildCatch()
      : ringDraftToGameChart(
          generateSongRingChart(a, difficulty.value, seed.value, options()),
          a,
        )
  if (!chart || chart.notes.length === 0) {
    errorMsg.value = '초안에 노트가 없어요 — 온셋이 너무 적은 곡일 수 있어요'
    return
  }
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

// ── 파형 + 분석 오버레이 ──
// 전곡을 한 장에 눌러 담는 정적 스트립 — 편집은 에디터가 하고, 여기선 "분석이 맞았나"만 본다.

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

  const durationMs = (buffer.length / buffer.sampleRate) * 1000
  const msToX = (ms: number) => (ms / durationMs) * w

  // 파형 (피크 스트립)
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
  if (!a) return

  // 박자 격자 (4박마다 진하게)
  for (let k = 0; ; k++) {
    const t = a.gridOriginMs + k * a.beatMs
    if (t > durationMs) break
    ctx.strokeStyle = k % 4 === 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)'
    ctx.beginPath()
    const x = Math.round(msToX(t)) + 0.5
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }

  // 온셋 (세기 = 막대 높이, 저역 비중이 크면 주황 = 킥)
  for (const o of a.onsets) {
    const x = msToX(o.timeMs)
    const bar = Math.min(1, o.strength / 2) * (h * 0.5)
    ctx.fillStyle = o.bands.low > 0.45 ? 'rgba(255,150,60,0.9)' : 'rgba(120,220,160,0.9)'
    ctx.fillRect(x - 1, h - bar, 2, bar)
  }

  // 지속음 (윗부분 리본)
  ctx.fillStyle = 'rgba(200,140,255,0.5)'
  for (const s of a.sustains) {
    ctx.fillRect(msToX(s.startMs), 4, Math.max(2, msToX(s.durationMs) - msToX(0)), 5)
  }

  // 탭 백본 (보정 후) — 위쪽 절반에 트랙 색으로. 드럼 = 주황 계열, 보컬 = 하늘색.
  // 홀드 탭은 길이만큼 가로 바를 잇는다
  if (backbone.value) {
    for (const o of backbone.value.onsets) {
      const x = msToX(o.timeMs)
      const color = o.source === 'perc' ? 'rgba(255,120,80,0.95)' : 'rgba(110,190,255,0.95)'
      ctx.fillStyle = color
      ctx.fillRect(x - 1, 12, 2, h * 0.3)
      if (o.holdMs) {
        ctx.fillStyle = color.replace('0.95', '0.45')
        ctx.fillRect(x, 16, Math.max(3, msToX(o.timeMs + o.holdMs) - x), 5)
      }
    }
  }

  // 선택 구간 (짤라듣기·구간 녹음 대상)
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

  // 미세수정 대상으로 고른 탭 — 흰 링
  if (selectedTapMs.value !== null) {
    const x = msToX(selectedTapMs.value)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, 24, 8, 0, Math.PI * 2)
    ctx.stroke()
  }

  // 확대 뷰도 같이 — 캔버스가 이 프레임에 막 생겼을 수 있어 다음 프레임에 그린다
  requestAnimationFrame(() => drawZoom())
}

watch([analysis, audioBuffer, backbone], drawWave)
watch([subdivision, tapTrack], () => drawZoom())
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
      <h1>채보 랩 <small>곡 분석 → 자동 초안</small></h1>
      <label class="file">
        곡 파일
        <input type="file" accept="audio/*" @change="onFile" />
      </label>
      <button
        type="button"
        class="primary"
        :disabled="!audioBuffer || analyzing"
        @click="analyze"
      >
        {{ analyzing ? `분석 중 ${Math.round(progress * 100)}%` : '♪ 분석' }}
      </button>
    </header>

    <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

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
        <span class="dot kick"></span>저역 온셋(킥) <span class="dot mel"></span>온셋
        <span class="dot sus"></span>지속음 · 세로선 = 박자 격자 ·
        <b>드래그 = 구간 선택 · 탭 마커 클릭 = 미세수정</b>
      </p>
    </section>

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
        <b>확대 편집</b> — 마커 드래그 = 이동 · 더블클릭 = 현재 트랙({{ tapTrack === 'perc' ? '드럼' : '보컬' }})에 탭 추가 ·
        클릭 = 선택(아래 수정 바) · 격자 = 분할 설정 기준 · 하단 틱 = 검출 온셋
      </p>
    </section>

    <section v-if="analysis" class="report">
      <dl>
        <div><dt>BPM</dt><dd>{{ analysis.bpm }}</dd></div>
        <div><dt>신뢰도</dt><dd :class="{ warn: analysis.confidence < 2 }">
          {{ analysis.confidence }}<small v-if="analysis.confidence < 2"> — 템포가 흔들리는 곡일 수 있어요. free 스냅 권장</small>
        </dd></div>
        <div><dt>격자 원점</dt><dd>{{ analysis.gridOriginMs }}ms (첫 소리 {{ analysis.firstSoundMs }}ms)</dd></div>
        <div><dt>온셋 / 지속음</dt><dd>{{ analysis.onsets.length }} / {{ analysis.sustains.length }}개</dd></div>
        <div><dt>다른 BPM 후보</dt><dd>{{ analysis.bpmCandidates.map((c) => c.bpm).join(', ') }}</dd></div>
      </dl>

      <div class="controls tapbox">
        <b>탭 백본</b>
        <label>
          트랙
          <select v-model="tapTrack" :disabled="tapping">
            <option value="melody">보컬/멜로디</option>
            <option value="perc">드럼</option>
          </select>
        </label>
        <label>
          보정
          <select v-model.number="snapWindow" :disabled="tapping">
            <option :value="0">지연만 제거 (스냅 없음)</option>
            <option :value="30">온셋 스냅 ±30ms</option>
            <option :value="70">온셋 스냅 ±70ms</option>
          </select>
        </label>
        <button v-if="!tapping" type="button" class="primary" :disabled="running" @click="startTapping">
          ● {{ selStartMs !== null ? '구간 녹음' : '녹음' }} — 키 짧게=탭 · 누르면=홀드 · ⌫ 무르기 · Esc 종료
        </button>
        <button v-else type="button" @click="stopTapping">■ 정지 {{ (tapPosMs / 1000).toFixed(1) }}s</button>
        <button v-if="!previewing" type="button" :disabled="tapping" @click="playSection(false)">
          ▶ {{ selStartMs !== null ? '구간 듣기' : '전체 듣기' }}
        </button>
        <button
          v-if="!previewing"
          type="button"
          :disabled="tapping || !backbone"
          @click="playSection(true)"
        >
          ♪ 탭 미리듣기
        </button>
        <button v-if="previewing" type="button" @click="stopPreview">■ 듣기 정지</button>
        <template v-if="selStartMs !== null && selEndMs !== null">
          <span class="dim">
            구간 {{ (selStartMs / 1000).toFixed(1) }}–{{ (selEndMs / 1000).toFixed(1) }}s
          </span>
          <button type="button" @click="clearSelection">구간 해제</button>
        </template>
        <span class="dim">드럼 {{ percTaps.length }} · 보컬 {{ melodyTaps.length }}</span>
        <template v-if="backbone">
          <span class="dim">
            지연 보정 {{ backbone.latencyMs }}ms · 온셋 일치 {{ Math.round(backbone.matchedRatio * 100) }}%
          </span>
          <label><input v-model="useBackbone" type="checkbox" /> 백본으로 생성</label>
          <label><input v-model="handByTrack" type="checkbox" :disabled="!useBackbone" /> 드럼↔왼손·보컬↔오른손 성향</label>
        </template>
        <button type="button" :disabled="!percTaps.length && !melodyTaps.length" @click="exportTaps">
          탭 저장
        </button>
        <label>
          <button type="button" @click="tapFile?.click()">탭 불러오기</button>
          <input ref="tapFile" type="file" accept=".json" style="display: none" @change="importTaps" />
        </label>
        <button type="button" :disabled="!percTaps.length && !melodyTaps.length" @click="clearTaps">
          지우기
        </button>
      </div>

      <div v-if="selectedTap && selectedTapMs !== null && selectedTapEvent" class="controls tapedit">
        <b>탭 미세수정</b>
        <span class="dim">
          {{ selectedTap.track === 'perc' ? '드럼' : '보컬' }} ·
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

      <div class="controls">
        <label>
          난이도
          <select v-model="difficulty" :disabled="running">
            <option v-for="d in DIFFICULTIES" :key="d" :value="d">{{ d }}</option>
            <option v-if="backbone" value="MANUAL">MANUAL — 내가 찍은 대로</option>
          </select>
        </label>
        <label>
          격자
          <select v-model.number="subdivision" :disabled="running">
            <option :value="2">8분음표</option>
            <option :value="4">16분음표</option>
            <option :value="8">32분음표</option>
            <option :value="3">셋잇단 8분</option>
            <option :value="6">셋잇단 16분</option>
          </select>
        </label>
        <label>
          스냅
          <select v-model="snap" :disabled="running">
            <option value="hybrid">하이브리드 (창 안만 스냅)</option>
            <option value="grid">전부 격자에</option>
            <option value="free">원시 시각 그대로</option>
          </select>
        </label>
        <label>
          시드
          <input v-model="seed" size="10" :disabled="running" />
        </label>
        <button type="button" :disabled="running" @click="randomSeed">🎲</button>
        <label>
          플레이 모드
          <select v-model="playMode" :disabled="running">
            <option value="catch">캐치</option>
            <option value="ring">링</option>
          </select>
        </label>
        <button v-if="!running" type="button" class="primary" @click="play">▶ 초안 플레이</button>
        <button v-else type="button" @click="stop">중단</button>
      </div>

      <div class="exports">
        <button type="button" @click="exportCatch">캐치 JSON 내보내기</button>
        <button type="button" @click="exportRing">링 초안 JSON (에디터용)</button>
        <button type="button" @click="exportAccents">songAccents 스니펫 (곡 교체용)</button>
        <span v-if="lastResult" class="result">직전 기록 — {{ lastResult }}</span>
      </div>
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
        <p v-else>▶ 초안 플레이 또는 JSON 내보내기로 이어가세요</p>
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
.wave-wrap {
  padding: 0.5rem 1rem 0;
}
.wave {
  width: 100%;
  height: 120px;
  display: block;
  background: #0b0f16;
  border: 1px solid #232c3a;
  border-radius: 8px;
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
.dot.sus {
  background: rgb(200, 140, 255);
}
.report {
  padding: 0.5rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
dl {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.5rem;
  margin: 0;
  font-size: 0.85rem;
}
dl div {
  display: flex;
  gap: 0.4rem;
}
dt {
  color: #8b97a6;
}
dd {
  margin: 0;
}
dd.warn {
  color: #ffcf7d;
}
.controls,
.exports {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}
.tapbox {
  border: 1px dashed #2c3648;
  border-radius: 8px;
  padding: 0.5rem 0.7rem;
}
.tapbox b {
  color: #ffcf7d;
  font-size: 0.85rem;
}
.tapedit {
  border: 1px solid #2c3648;
  border-radius: 8px;
  padding: 0.4rem 0.7rem;
  background: #131a26;
}
.tapedit b {
  color: #9fd8ff;
  font-size: 0.85rem;
}
.wave {
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
