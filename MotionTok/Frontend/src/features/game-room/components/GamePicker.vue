<script setup lang="ts">
/** 게임 선택 모달. 왼쪽에서 게임을 고르면 오른쪽에 설명·플레이 방법이 뜨고, "게임 시작하기"로 launch(게임) 이벤트를 낸다. */
import { computed, ref } from 'vue'
import { GAME_CATALOG, type GameEntry } from '../data'
import PixelButton from '@/components/common/PixelButton.vue'

const props = defineProps<{
  /**
   * 지금 방에 있는 사람 수 — 게임④ 모드 선택지를 가른다(혼자면 연속 서바이벌만).
   * 최종 판정은 서버가 한다(시작 누르는 순간 인원이 바뀌는 레이스가 있다).
   */
  memberCount?: number
}>()

defineEmits<{
  close: []
  launch: [game: GameEntry, difficulty?: string, mode?: string, wallCount?: number]
}>()

const selected = ref<GameEntry | null>(null)
/** 게임④(-9) 전용 — 난이도별 벽 접근 속도(쉬움 6s/보통 5s/어려움 4s)를 방장이 시작 전에 고른다 */
const difficulty = ref<'easy' | 'normal' | 'hard'>('easy')
const DIFFICULTIES: { key: 'easy' | 'normal' | 'hard'; label: string }[] = [
  { key: 'easy', label: '쉬움' },
  { key: 'normal', label: '보통' },
  { key: 'hard', label: '어려움' },
]

/**
 * 게임④ 모드(-9). 기본은 출제 대결 — 게임 설명("출제자가 취한 포즈가 그대로 벽의 구멍이 되고")
 * 그대로인 쪽이고, 남이 낸 포즈를 맞춘다는 이 게임의 컨셉을 지키는 유일한 모드다.
 */
const mode = ref<'pose' | 'chain'>('pose')
const MODES: { key: 'pose' | 'chain'; label: string; hint: string }[] = [
  { key: 'pose', label: '출제 대결', hint: '돌아가며 내 포즈로 출제 — 출제자는 그 라운드를 관전해요' },
  { key: 'chain', label: '연속 서바이벌', hint: '랜덤 벽이 계속 날아와요 — 전원이 동시에 뛰고 점수로 승부' },
]
/** 연속 서바이벌 분량 — 무한은 승부가 안 나서(끝이 없다) 방에서는 빼고 솔로에만 남겼다 */
const WALL_CHOICES = [10, 20, 30]
const wallCount = ref(10)

/** 혼자면 출제 대결이 성립하지 않는다(내가 낸 포즈를 내가 푼다) — 연속 서바이벌만 남긴다 */
const soloOnly = computed(() => (props.memberCount ?? 1) < 2)
const modes = computed(() => (soloOnly.value ? MODES.filter((m) => m.key === 'chain') : MODES))
const effectiveMode = computed<'pose' | 'chain'>(() => (soloOnly.value ? 'chain' : mode.value))
const activeMode = computed(() => MODES.find((m) => m.key === effectiveMode.value))
</script>

<template>
  <div class="overlay" @click="$emit('close')">
    <div class="dialog" @click.stop>
      <div class="head">
        <div>
          <h2>플레이할 게임을 골라주세요</h2>
        </div>
        <button class="close" @click="$emit('close')">X</button>
      </div>

      <div class="body">
        <!-- 좌측: 세로 게임 목록 -->
        <ul class="game-list">
          <li v-for="g in GAME_CATALOG" :key="g.id">
            <button
              class="game-row"
              :class="{ on: selected?.id === g.id }"
              @click="selected = g"
            >
              <div class="row-thumb" :style="{ background: g.thumb }">{{ g.emoji }}</div>
              <div class="row-info">
                <div class="row-name">{{ g.name }}</div>
              </div>
              <span class="row-badge" :class="g.playable ? 'play' : 'soon'">
                {{ g.playable ? 'PLAY' : 'SOON' }}
              </span>
            </button>
          </li>
        </ul>

        <!-- 우측: 상세 설명 -->
        <div class="detail">
          <template v-if="selected">
            <div class="detail-head">
              <div class="detail-thumb" :style="{ background: selected.thumb }">{{ selected.emoji }}</div>
              <div>
                <div class="detail-name">{{ selected.name }}</div>
                <div class="detail-tag">{{ selected.tag }}</div>
              </div>
            </div>

            <h3 class="detail-h">게임 설명</h3>
            <p class="detail-desc">{{ selected.description }}</p>

            <h3 class="detail-h">플레이 방법</h3>
            <ol class="detail-steps">
              <li v-for="(step, i) in selected.howToPlay" :key="i">{{ step }}</li>
            </ol>

            <template v-if="selected.id === 'shape'">
              <h3 class="detail-h">게임 모드</h3>
              <div class="diff-buttons">
                <button
                  v-for="m in modes"
                  :key="m.key"
                  class="diff-btn"
                  :class="{ on: effectiveMode === m.key }"
                  @click="mode = m.key"
                >
                  {{ m.label }}
                </button>
              </div>
              <p class="mode-hint">{{ activeMode?.hint }}</p>
              <p v-if="soloOnly" class="mode-hint solo">
                혼자라서 연속 서바이벌만 할 수 있어요 — 출제 대결은 2명부터예요
              </p>

              <template v-if="effectiveMode === 'chain'">
                <h3 class="detail-h">벽 수</h3>
                <div class="diff-buttons">
                  <button
                    v-for="n in WALL_CHOICES"
                    :key="n"
                    class="diff-btn"
                    :class="{ on: wallCount === n }"
                    @click="wallCount = n"
                  >
                    {{ n }}
                  </button>
                </div>
              </template>

              <h3 class="detail-h">난이도</h3>
              <div class="diff-buttons">
                <button
                  v-for="d in DIFFICULTIES"
                  :key="d.key"
                  class="diff-btn"
                  :class="{ on: difficulty === d.key }"
                  @click="difficulty = d.key"
                >
                  {{ d.label }}
                </button>
              </div>
            </template>

            <PixelButton
              class="start-game-btn"
              variant="mint"
              @click="
                selected.id === 'shape'
                  ? $emit(
                      'launch',
                      selected,
                      difficulty,
                      effectiveMode,
                      effectiveMode === 'chain' ? wallCount : undefined,
                    )
                  : $emit('launch', selected)
              "
            >
              플레이 ▶
            </PixelButton>
          </template>

          <div v-else class="detail-empty">
            <span class="detail-empty-emoji">🎮</span>
            <p>게임을 선택하여 시작해보세요!</p>
          </div>
        </div>
      </div>

      <p class="foot">
        카메라 권한을 허용하면 손·몸 동작으로 게임을 플레이합니다. AI 댄스 배틀은 로컬 개발 서버가 필요한 빌드예요.
      </p>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(43, 35, 51, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 배경은 즉시 표시 */
}
.dialog {
  width: 900px;
  max-width: 92vw;
  background-color: #fffdf3;
  background-image: radial-gradient(rgba(56, 38, 61, .08) 1px, transparent 1px);
  background-size: 18px 18px;
  border: var(--border-thick);
  border-radius: 23px 23px 17px 23px;
  padding: 28px 30px 32px;
  box-shadow: 8px 8px 0 rgba(43, 35, 51, 0.3);
  /* 창만 팝업 애니메이션 */
  animation: px-pop 0.18s steps(3);
}
.head { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
.head h2 { margin: 8px 0 0; font-size: 16px; color: var(--c-ink); }
.close {
  margin-left: auto;
  width: 36px;
  height: 36px;
  border: 3px solid var(--c-ink-soft);
  background: #fff;
  color: var(--c-ink-soft);
  font-size: 11px;
  box-shadow: var(--shadow-sm);
  border-radius: 10px;
}

.body { display: grid; grid-template-columns: 300px 1fr; gap: 0; height: 420px; }

/* 좌측 목록: 마우스 스크롤은 되지만 스크롤바는 숨김 */
.game-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* Edge/IE */
  border: 2px solid #eaddea;
  border-right: none;
  border-radius: 14px 0 0 14px;
  background: #fff;
}
.game-list::-webkit-scrollbar { display: none; } /* Chrome/Safari */
.game-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  padding: 9px 10px;
  margin-bottom: 4px;
  border: 2px solid transparent;
  border-radius: 12px;
  background: transparent;
  transition: var(--t-fast);
}
.game-row:hover { background: #fdf7e6; }
.game-row.on { background: var(--c-mint-soft); border-color: var(--c-ink); box-shadow: var(--shadow-sm); }
.row-thumb {
  flex: none;
  width: 40px;
  height: 40px;
  border: 2px solid var(--c-ink-soft);
  border-radius: 11px;
  display: grid;
  place-items: center;
  font-size: 19px;
}
.row-info { min-width: 0; }
.row-name { font-size: 9px; color: var(--c-ink-soft); }
.row-badge { margin-left: auto; flex: none; padding: 4px 6px; font-size: 7px; border: 2px solid var(--c-ink-soft); border-radius: 6px; }
.row-badge.play { background: #5cbf4a; color: #fff; }
.row-badge.soon { background: #f5c518; color: var(--c-ink-soft); }

/* 우측 상세 */
.detail {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 2px solid #eaddea;
  border-radius: 0 14px 14px 0;
  background: #fff;
  padding: 20px 22px;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.detail::-webkit-scrollbar { display: none; }
.detail-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #a99f86;
  font-size: 12px;
  text-align: center;
}
.detail-empty-emoji { font-size: 40px; }
.detail-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.detail-thumb {
  flex: none;
  width: 54px;
  height: 54px;
  border: 2px solid var(--c-ink);
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 26px;
}
.detail-name { font-size: 13px; color: var(--c-ink); }
.detail-tag { font-size: 10px; color: #a99f86; margin-top: 5px; }
.detail-h { margin: 14px 0 6px; font-size: 10px; color: var(--c-coral); }
.detail-desc { margin: 0; font-size: 11.5px; color: var(--c-ink-soft); line-height: 1.7; }
.detail-steps { margin: 0; padding-left: 18px; font-size: 11.5px; color: var(--c-ink-soft); line-height: 1.9; }
.diff-buttons { display: flex; gap: 6px; }
.diff-btn {
  flex: 1;
  padding: 8px 4px;
  background: #fff;
  border: 2px solid var(--c-ink-soft);
  border-radius: 10px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: var(--t-fast);
}
.diff-btn.on { background: var(--c-mint); color: #fff; box-shadow: var(--shadow-sm); }
/* 모드는 이름만으론 뭐가 다른지 모른다 — 고른 모드의 한 줄 설명을 바로 아래에 붙인다 */
.mode-hint { margin: 6px 0 0; font-size: 10.5px; color: #a99f86; line-height: 1.6; }
.mode-hint.solo { color: var(--c-coral); }
.start-game-btn { align-self: flex-end; margin-top: auto; }

.foot { margin: 18px 0 0; font-size: 11px; color: #a99f86; line-height: 1.7; }
</style>
