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
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import CatchRhythmStage from '../CatchRhythmStage.vue'
import { DIFFICULTIES, type Difficulty } from '../generator/presets'
import { analyzeSong, type SongAnalysis } from '../analysis/analyzeSong'
import { formatSongAccentsSnippet } from '../analysis/accentExport'
import {
  generateSongCatchChart,
  generateSongRingChart,
  ringDraftToGameChart,
  songStartMs,
  type SongChartOptions,
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
const difficulty = ref<Difficulty>('NORMAL')
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

function options(): SongChartOptions {
  return {
    subdivision: subdivision.value,
    snap: snap.value,
    title: fileName.value ? `${fileName.value} ${difficulty.value}` : undefined,
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
}

watch([analysis, audioBuffer], drawWave)
window.addEventListener('resize', drawWave)
onBeforeUnmount(() => {
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
      <canvas ref="waveCanvas" class="wave"></canvas>
      <p class="legend">
        <span class="dot kick"></span>저역 온셋(킥) <span class="dot mel"></span>온셋
        <span class="dot sus"></span>지속음 · 세로선 = 검출된 박자 격자
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

      <div class="controls">
        <label>
          난이도
          <select v-model="difficulty" :disabled="running">
            <option v-for="d in DIFFICULTIES" :key="d" :value="d">{{ d }}</option>
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
        :difficulty="difficulty"
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
