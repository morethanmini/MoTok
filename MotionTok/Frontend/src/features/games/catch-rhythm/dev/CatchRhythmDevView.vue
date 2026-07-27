<script setup lang="ts">
/**
 * 개발용 플레이 페이지 (/dev/catch-rhythm) — 방·서버·로그인 없이 캐치캐치리듬을 돌린다.
 * 난이도·시드·스킨을 바꿔 가며 판정과 채보를 손으로 확인하는 용도.
 *
 * 배포 빌드에는 필요 없지만 라우트 하나라 그냥 둔다(카탈로그에 노출되지 않아 사용자는 못 찾는다).
 */
import { ref } from 'vue'
import CatchRhythmStage from '../CatchRhythmStage.vue'
import { DIFFICULTIES, type Difficulty } from '../generator/presets'
import { SKINS } from '../render/skins'
import type { Judgement } from '../core/types'

const difficulty = ref<Difficulty>('NORMAL')
const skinId = ref<string>('cat-candy')
const seed = ref<string>('20260727')
const durationSec = ref(60)
const running = ref(false)
const errorMsg = ref('')
const lastResult = ref<{
  score: number
  maxCombo: number
  counts: Record<Judgement, number>
} | null>(null)
/** 설정을 바꿔 다시 시작할 때 스테이지를 완전히 새로 만들기 위한 키 */
const runKey = ref(0)

function start() {
  errorMsg.value = ''
  lastResult.value = null
  runKey.value += 1
  running.value = true
}

function stop() {
  running.value = false
}

function randomSeed() {
  seed.value = String(Math.floor(Math.random() * 2 ** 31))
}

function onFinished(r: { score: number; maxCombo: number; counts: Record<Judgement, number> }) {
  lastResult.value = r
}

function onError(message: string) {
  errorMsg.value = message
  running.value = false
}
</script>

<template>
  <main class="dev">
    <header class="bar">
      <h1>캐치캐치리듬 <small>개발 플레이</small></h1>

      <label>
        난이도
        <select v-model="difficulty" :disabled="running">
          <option v-for="d in DIFFICULTIES" :key="d" :value="d">{{ d }}</option>
        </select>
      </label>

      <label>
        스킨
        <select v-model="skinId" :disabled="running">
          <option v-for="s in Object.values(SKINS)" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
      </label>

      <label>
        시드
        <input v-model="seed" :disabled="running" size="12" />
      </label>
      <button type="button" :disabled="running" @click="randomSeed">🎲</button>

      <label>
        길이(초)
        <input v-model.number="durationSec" type="number" min="10" max="180" :disabled="running" />
      </label>

      <button v-if="!running" type="button" class="primary" @click="start">시작</button>
      <button v-else type="button" @click="stop">중단</button>
    </header>

    <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

    <section class="board-wrap">
      <CatchRhythmStage
        v-if="running"
        :key="runKey"
        :seed="seed"
        :difficulty="difficulty"
        :duration-ms="durationSec * 1000"
        :skin-id="skinId"
        @finished="onFinished"
        @error="onError"
      >
        <template #result-actions>
          <button type="button" class="primary" @click="start">다시</button>
        </template>
      </CatchRhythmStage>

      <div v-else class="idle">
        <p>시작을 누르면 카메라 권한을 요청해요.</p>
        <p class="tip">노트 위에서 <b>주먹을 쥐면</b> 잡힙니다. 쥔 채로 쓸고 다니면 안 잡혀요.</p>
        <p v-if="lastResult" class="tip">
          직전 기록 — {{ lastResult.score.toLocaleString() }}점 / 최대 콤보
          {{ lastResult.maxCombo }} / PERFECT {{ lastResult.counts.perfect }} · GOOD
          {{ lastResult.counts.good }} · MISS {{ lastResult.counts.miss }}
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.dev {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background: #f7f3ef;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
  background: #fff;
  border-bottom: 1px solid #e6ddd6;
}
h1 {
  font-size: 1rem;
  margin-right: auto;
}
h1 small {
  color: #9b8f88;
  font-weight: 400;
}
label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: #5c4a3f;
}
select,
input {
  padding: 0.25rem 0.4rem;
  border: 1px solid #d9cec6;
  border-radius: 6px;
  font: inherit;
}
input[type='number'] {
  width: 4.5rem;
}
button {
  padding: 0.35rem 0.8rem;
  border: 1px solid #d9cec6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font: inherit;
}
button.primary {
  background: #e07a4f;
  border-color: #e07a4f;
  color: #fff;
}
.error {
  padding: 0.5rem 1rem;
  background: #ffe7e2;
  color: #b3402a;
}
.board-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
}
.idle {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: #7a6a60;
  text-align: center;
  padding: 1rem;
}
.tip {
  font-size: 0.9rem;
  color: #9b8f88;
}
</style>
