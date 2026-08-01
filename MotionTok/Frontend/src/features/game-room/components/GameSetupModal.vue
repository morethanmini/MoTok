<script setup lang="ts">
/**
 * 게임 설정 창 (S15P11A706-9) — 게임을 고른 뒤 "어떻게 할지"를 정하는 두 번째 단계.
 *
 * <p>모드·난이도·벽 수가 게임 선택 모달 안에 있었는데, 그 모달은 "무슨 게임을 할지" 고르는
 * 화면이라 성격이 다른 결정이 한 화면에 섞여 있었다. 게임④만 옵션이 셋(모드 2 · 벽 수 3 ·
 * 난이도 3)이라 상세 패널이 이미 스크롤되고 있었고(썸네일이 잘려 보였다), 다른 게임에 옵션이
 * 붙으면 더 나빠지는 구조였다.</p>
 *
 * <p>옵션이 없는 게임은 이 창을 띄우지 않는다 — 호출부(GameRoomView)가 게임④만 여기로 보낸다.
 * 전부 거치게 하면 "플레이 버튼만 있는 빈 창"이 생긴다.</p>
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gameMusicGain, useBgm } from '@/composables/useBgm'
import { SRC as BODY_FIT_SFX, VOLUME as BODY_FIT_VOLUME } from '@/features/games/body-fit/audio'
import type { GameEntry } from '../data'
import PixelButton from '@/components/common/PixelButton.vue'

const props = defineProps<{
  game: GameEntry
  /** 지금 방에 있는 사람 수 — 혼자면 출제 대결이 성립하지 않는다. 최종 판정은 서버가 한다 */
  memberCount?: number
}>()

const emit = defineEmits<{
  /** 게임 선택으로 돌아가기 */
  back: []
  start: [difficulty: string, mode: string, wallCount?: number]
}>()

const difficulty = ref<'easy' | 'normal' | 'hard'>('easy')
const DIFFICULTIES: { key: 'easy' | 'normal' | 'hard'; label: string; hint: string }[] = [
  { key: 'easy', label: '쉬움', hint: '벽이 6초에 걸쳐 온다' },
  { key: 'normal', label: '보통', hint: '벽이 5초에 걸쳐 온다' },
  { key: 'hard', label: '어려움', hint: '벽이 4초에 걸쳐 온다' },
]

/** 기본은 출제 대결 — 남이 낸 포즈를 맞춘다는 이 게임의 컨셉을 지키는 유일한 모드다 */
const mode = ref<'pose' | 'chain'>('pose')
const MODES: { key: 'pose' | 'chain'; label: string; hint: string }[] = [
  {
    key: 'pose',
    label: '출제 대결',
    hint: '돌아가며 내 포즈로 출제해요. 출제자는 그 라운드를 관전하고, 남은 사람이 그 구멍을 통과합니다.',
  },
  {
    key: 'chain',
    label: '연속 서바이벌',
    hint: '랜덤 벽이 끊이지 않고 날아와요. 전원이 같은 벽을 동시에 받고, 많이 맞춘 사람이 이깁니다.',
  },
]

/** 무한은 끝이 없어 승부가 안 나므로 방에서는 빼고 솔로에만 남겼다 */
const WALL_CHOICES = [10, 20, 30]
const wallCount = ref(10)

/** 혼자면 출제 대결이 성립하지 않는다(내가 낸 포즈를 내가 푼다) */
const soloOnly = computed(() => (props.memberCount ?? 1) < 2)
const modes = computed(() => (soloOnly.value ? MODES.filter((m) => m.key === 'chain') : MODES))
const effectiveMode = computed<'pose' | 'chain'>(() => (soloOnly.value ? 'chain' : mode.value))
const activeMode = computed(() => MODES.find((m) => m.key === effectiveMode.value))
const activeDifficulty = computed(() => DIFFICULTIES.find((d) => d.key === difficulty.value))

/**
 * 설정 창 BGM — 인게임 베드를 미리 깔아 "게임에 들어왔다"는 신호를 준다.
 *
 * <p>이 창이 오디오를 직접 소유한다. 게임 사운드(BodyFitAudio)를 빌려 쓰면 소유자가 둘이 되어
 * 게임이 시작될 때 누가 끄는지가 모호해진다. 여기서는 창이 사라질 때 확실히 멈춘다.</p>
 *
 * <p>로비 테마와 겹치지 않는 건 호출부가 맡는다 — GameRoomView가 이 창이 열린 동안
 * useBgm().suspendForGame()을 이미 걸어둔다(게임④ 사운드 규약과 같은 자리).</p>
 *
 * <p>크기는 게임 본체와 같은 식으로 정한다 — 상수로 두면 설정을 무시하고 음량도 어긋난다.</p>
 */
let bed: HTMLAudioElement | null = null

/** BodyFitAudio.target()과 같은 계산 */
function bedVolume(): number {
  return Math.min(1, BODY_FIT_VOLUME * gameMusicGain())
}

onMounted(() => {
  if (!useBgm().isEnabled.value) return // 음악을 꺼둔 사용자에게는 틀지 않는다
  bed = new Audio(BODY_FIT_SFX.ingame)
  bed.loop = true
  bed.volume = bedVolume()
  // 이 창은 클릭(플레이 버튼)으로만 열리므로 자동재생 정책에 막히지 않는다
  bed.play().catch(() => {})
})

// 창이 떠 있는 동안 슬라이더를 움직이면 즉시 반영
watch(useBgm().gameMusic, () => {
  if (bed) bed.volume = bedVolume()
})
onBeforeUnmount(() => {
  bed?.pause()
  bed = null
})
</script>

<template>
  <div class="overlay">
    <div class="dialog">
      <div class="head">
        <div class="thumb" :style="{ background: game.thumb }">{{ game.emoji }}</div>
        <div>
          <h2>{{ game.name }}</h2>
          <p class="sub">어떻게 플레이할지 골라주세요</p>
        </div>
        <button class="close" @click="emit('back')">X</button>
      </div>

      <h3 class="label">게임 모드</h3>
      <div class="choices">
        <button
          v-for="m in modes"
          :key="m.key"
          class="choice"
          :class="{ on: effectiveMode === m.key }"
          @click="mode = m.key"
        >
          {{ m.label }}
        </button>
      </div>
      <p class="hint">{{ activeMode?.hint }}</p>
      <p v-if="soloOnly" class="hint solo">
        혼자라서 연속 서바이벌만 할 수 있어요 — 출제 대결은 2명부터예요
      </p>

      <template v-if="effectiveMode === 'chain'">
        <h3 class="label">벽 수</h3>
        <div class="choices">
          <button
            v-for="n in WALL_CHOICES"
            :key="n"
            class="choice"
            :class="{ on: wallCount === n }"
            @click="wallCount = n"
          >
            {{ n }}개
          </button>
        </div>
      </template>

      <h3 class="label">난이도</h3>
      <div class="choices">
        <button
          v-for="d in DIFFICULTIES"
          :key="d.key"
          class="choice"
          :class="{ on: difficulty === d.key }"
          @click="difficulty = d.key"
        >
          {{ d.label }}
        </button>
      </div>
      <p class="hint">{{ activeDifficulty?.hint }}</p>

      <div class="actions">
        <button class="back" @click="emit('back')">◀ 게임 다시 고르기</button>
        <PixelButton
          variant="mint"
          @click="
            emit('start', difficulty, effectiveMode, effectiveMode === 'chain' ? wallCount : undefined)
          "
        >
          시작 ▶
        </PixelButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 게임 선택 모달(GamePicker)과 같은 껍데기 — 두 창이 연달아 뜨므로 톤이 어긋나면 안 된다 */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 81; /* 게임 선택 모달(80) 위 */
  background: rgba(43, 35, 51, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog {
  width: 520px;
  max-width: 92vw;
  max-height: 88vh;
  overflow-y: auto;
  scrollbar-width: none;
  background-color: #fffdf3;
  background-image: radial-gradient(rgba(56, 38, 61, 0.08) 1px, transparent 1px);
  background-size: 18px 18px;
  border: var(--border-thick);
  border-radius: 23px 23px 17px 23px;
  padding: 26px 28px 28px;
  box-shadow: 8px 8px 0 rgba(43, 35, 51, 0.3);
  animation: px-pop 0.18s steps(3);
}
.dialog::-webkit-scrollbar {
  display: none;
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.thumb {
  flex: none;
  width: 48px;
  height: 48px;
  border: 2px solid var(--c-ink);
  border-radius: 13px;
  display: grid;
  place-items: center;
  font-size: 23px;
}
.head h2 {
  margin: 0;
  font-size: 14px;
  color: var(--c-ink);
}
.sub {
  margin: 6px 0 0;
  font-size: 10.5px;
  color: #a99f86;
}
.close {
  margin-left: auto;
  align-self: flex-start;
  width: 32px;
  height: 32px;
  border: 3px solid var(--c-ink-soft);
  background: #fff;
  color: var(--c-ink-soft);
  font-size: 10px;
  box-shadow: var(--shadow-sm);
  border-radius: 9px;
}
.label {
  margin: 16px 0 6px;
  font-size: 10px;
  color: var(--c-coral);
}
.choices {
  display: flex;
  gap: 6px;
}
.choice {
  flex: 1;
  padding: 10px 4px;
  background: #fff;
  border: 2px solid var(--c-ink-soft);
  border-radius: 10px;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  transition: var(--t-fast);
}
.choice.on {
  background: var(--c-mint);
  color: #fff;
  box-shadow: var(--shadow-sm);
}
/* 고른 항목의 설명 — 모드는 이름만으론 뭐가 다른지 알 수 없다 */
.hint {
  margin: 7px 0 0;
  font-size: 10.5px;
  color: #a99f86;
  line-height: 1.65;
}
.hint.solo {
  color: var(--c-coral);
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 24px;
}
.back {
  padding: 9px 12px;
  background: #fff;
  border: 2px solid var(--c-ink-soft);
  border-radius: 10px;
  font-family: inherit;
  font-size: 10.5px;
  color: var(--c-ink-soft);
  cursor: pointer;
}
.actions :deep(.px-btn) {
  margin-left: auto;
}
</style>
