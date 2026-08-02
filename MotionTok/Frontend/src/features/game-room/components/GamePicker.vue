<script setup lang="ts">
/**
 * 방 안 게임 선택창.
 *
 * 왼쪽은 게임 목록 페이지와 같은 <b>썸네일 + 이름 카드</b>를 세로로 쌓은 목록이고,
 * 오른쪽은 고른 게임의 설명이다. 썸네일 컴포넌트는 게임 목록 페이지의 것을 그대로 쓴다 —
 * 같은 게임이 두 화면에서 다르게 보이면 "그 게임"인지 알아보는 데 시간이 걸린다.
 * (썸네일의 hover 애니메이션이 `:global(.game-card:hover ...)`로 걸려 있어 카드에 그
 *  클래스를 그대로 붙였다. 이름을 바꾸면 애니메이션이 죽는다.)
 *
 * 설명은 그림 캐러셀이다. 그림이 등록된 게임은 그림이, 아직 없는 게임은 기존 설명글을
 * 문장 단위로 쪼갠 대체 페이지가 나온다(guidePagesOrFallback).
 */
import { computed, ref, type Component } from 'vue'
import { GAME_CATALOG, type GameEntry } from '../data'
import GameGuideCarousel from '@/features/games-catalog/guide/GameGuideCarousel.vue'
import { guidePagesOrFallback } from '@/features/games-catalog/guide/pages'
import FingerStarThumbnail from '@/features/games-catalog/components/FingerStarThumbnail.vue'
import RhythmThumbnail from '@/features/games-catalog/components/RhythmThumbnail.vue'
import BodyFitThumbnail from '@/features/games-catalog/components/BodyFitThumbnail.vue'
import DrawingThumbnail from '@/features/games-catalog/components/DrawingThumbnail.vue'
import FishingThumbnail from '@/features/games-catalog/components/FishingThumbnail.vue'

/**
 * `closedGameIds` — 관리자가 카탈로그에서 닫은 서버 게임 id(-106).
 *
 * <p>카탈로그의 `playable`과 <b>다른 축</b>이다. 그건 "이 게임이 만들어졌나"(미구현 게임은
 * 목록에 아예 안 나온다)이고, 이건 "지금 열려 있나"다. 닫힌 게임은 <b>목록에 남고 선택만
 * 막힌다</b> — 조용히 지우면 "어제 하던 게임이 왜 없지"에 답할 수 없다.</p>
 *
 * <p>비어 있는 집합(조회 실패 포함)이면 아무것도 잠기지 않는다. 그래도 안전한 이유는
 * 서버가 시작을 거부하기 때문이다 — 이 표시는 <b>안내</b>이고 강제는 서버가 한다.</p>
 */
const props = withDefaults(
  defineProps<{
    closedGameIds?: ReadonlySet<number>
    /** 방장만 시작할 수 있다. 아니면 아래 버튼이 '게임 제안'으로 바뀐다. */
    isHost?: boolean
  }>(),
  { closedGameIds: () => new Set<number>(), isHost: false },
)

const emit = defineEmits<{
  close: []
  /** 바로 시작(방장) · 게임 제안(비방장) — 지금까지의 launch 경로 그대로. */
  launch: [game: GameEntry]
  /** 설명 함께 보기(방장) — 방 전원에게 설명을 띄운다. */
  guide: [game: GameEntry]
}>()

const selected = ref<GameEntry | null>(null)
const playableGames = GAME_CATALOG.filter((game) => game.playable)

/** 서버 게임 id → 게임 목록 페이지의 썸네일. 없는 게임은 이모지로 떨어진다. */
const THUMBNAILS: Record<number, Component> = {
  1: FingerStarThumbnail,
  2: RhythmThumbnail,
  4: BodyFitThumbnail,
  10: DrawingThumbnail,
  11: FishingThumbnail,
}

const isClosed = (game: GameEntry) => props.closedGameIds.has(game.gameId)
/** 선택된 게임이 닫혔으면 시작 버튼을 감춘다 — 목록에서 막아도 미리 골라 둔 상태로 열릴 수 있다. */
const selectedClosed = computed(() => !!selected.value && isClosed(selected.value))

const guidePages = computed(() => {
  const game = selected.value
  if (!game) return []
  return guidePagesOrFallback(game.gameId, game.emoji, [game.description, ...game.howToPlay])
})
</script>

<template>
  <div class="overlay" @click="emit('close')">
    <section
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-picker-title"
      @click.stop
    >
      <header class="head">
        <div>
          <span class="eyebrow">MOTION ARCADE</span>
          <h2 id="game-picker-title">어떤 게임을 해볼까요?</h2>
        </div>
        <button class="close" type="button" aria-label="게임 선택 닫기" @click="emit('close')">
          ×
        </button>
      </header>

      <div class="body">
        <nav class="game-nav" aria-label="게임 목록">
          <div class="nav-label"><span>GAME LIST</span></div>
          <ul class="game-list">
            <li v-for="g in playableGames" :key="g.id">
              <!-- 닫힌 게임도 목록에 남긴다. 눌러 설명은 볼 수 있고 시작만 막힌다 -->
              <button
                class="game-card"
                :class="{ on: selected?.id === g.id, closed: isClosed(g) }"
                type="button"
                :aria-pressed="selected?.id === g.id"
                @click="selected = g"
              >
                <span class="card-visual" :style="{ background: g.thumb }">
                  <component :is="THUMBNAILS[g.gameId]" v-if="THUMBNAILS[g.gameId]" />
                  <span v-else class="card-emoji">{{ g.emoji }}</span>
                </span>
                <span class="card-copy">
                  <b>{{ g.name }}<span v-if="isClosed(g)" class="card-lock">점검 중</span></b>
                  <small>{{ g.tag }}</small>
                </span>
              </button>
            </li>
          </ul>
        </nav>

        <article class="detail">
          <template v-if="selected">
            <!-- 게임 이름은 위에 고정, 시작 버튼은 아래에 고정하고 그 사이만 스크롤한다 —
                 창이 낮은 화면에서 "지금 무슨 게임을 보고 있는지"와 "시작" 둘 다 접혀
                 들어가지 않아야 한다. 설명은 남는 공간의 가운데에 놓인다. -->
            <div class="detail-head">
              <span>{{ selected.tag }}</span>
              <h3>{{ selected.name }}</h3>
            </div>

            <div class="detail-scroll">
              <div class="detail-inner">
                <div class="detail-guide">
                  <GameGuideCarousel :key="selected.id" :pages="guidePages" />
                </div>
              </div>
            </div>

            <!-- 닫힌 게임은 버튼을 감춘다 — 눌러 보고 서버 에러를 받는 것보다 이유를 미리 말하는 게 낫다 -->
            <p v-if="selectedClosed" class="detail-closed">점검 중이라 지금은 시작할 수 없어요</p>
            <!-- 방장만 두 갈래를 고를 수 있다. '설명 함께 보기'는 방 전원 화면에 설명을 띄우고,
                 '바로 시작'은 지금까지대로 곧장 시작한다. -->
            <div v-else-if="isHost" class="detail-actions">
              <button class="act guide" type="button" @click="emit('guide', selected)">
                설명 함께 보기
              </button>
              <button class="act start" type="button" @click="emit('launch', selected)">
                바로 시작 <span aria-hidden="true">→</span>
              </button>
            </div>
            <div v-else class="detail-actions">
              <button class="act suggest" type="button" @click="emit('launch', selected)">
                이 게임 제안하기
              </button>
            </div>
          </template>

          <div v-else class="detail-empty">
            <span class="empty-spark" aria-hidden="true">✦</span>
            <strong>게임을 골라주세요</strong>
            <p>왼쪽 목록에서 원하는 모션 게임을 선택하면<br />게임 방법을 확인할 수 있어요.</p>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(48, 35, 47, 0.58);
}
.dialog {
  width: min(940px, 100%);
  max-height: min(780px, calc(100vh - 36px));
  overflow: hidden;
  border: 3px solid #9a674b;
  border-radius: 18px;
  background: #fffaf0;
  box-shadow: 8px 8px 0 rgba(68, 43, 30, 0.32);
  animation: px-pop 0.18s steps(3);
}
.head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 18px;
  padding: 20px 25px 17px;
  border-bottom: 2px solid #dec59e;
  background: linear-gradient(110deg, #fff2d8, #fffaf0);
}
.eyebrow,
.nav-label span {
  color: #b17b51;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 1.1px;
}
.head h2 {
  margin: 6px 0 0;
  color: #392b22;
  font-family: var(--font-pixel);
  font-size: 25px;
  font-weight: 400;
}
.close {
  display: grid;
  width: 32px;
  height: 32px;
  flex: none;
  place-items: center;
  border: 0;
  background: transparent;
  color: #895e46;
  font-size: 25px;
  line-height: 1;
  cursor: pointer;
}
.close:hover {
  color: #bd625b;
  transform: scale(1.08);
}

.body {
  display: grid;
  grid-template-columns: 268px minmax(0, 1fr);
  /* 68vh면 설명 한 장(그림 + 문장 + 점)이 한눈에 들어온다. 낮은 화면에서는 설명 쪽만
     스크롤된다.
     아래 한계(340px)를 넉넉히 잡으면 안 된다 — 창(.dialog)은 overflow:hidden이라,
     머리말 + 이 높이가 화면보다 커지면 <b>시작 버튼이 잘려 나가 아예 못 누른다</b>.
     세로가 아주 좁은 화면에서 목록·설명이 짧아지는 편이 그보다 낫다. */
  height: clamp(340px, 68vh, 600px);
  min-height: 0;
}
.game-nav {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  padding: 14px 10px 12px;
  border-right: 2px solid #dec59e;
  background: #fff7e8;
}
.nav-label {
  padding: 0 8px 9px;
}
.nav-label span {
  font-size: 13px;
}
.game-list {
  display: grid;
  flex: 1;
  align-content: start;
  gap: 10px;
  min-height: 0;
  margin: 0;
  padding: 0 4px 14px;
  overflow-y: auto;
  -ms-overflow-style: none;
  scrollbar-width: none;
  list-style: none;
}
.game-list::-webkit-scrollbar {
  display: none;
}

/* 게임 목록 페이지의 카드와 같은 생김새 — 썸네일 위, 이름 아래 */
.game-card {
  display: block;
  width: 100%;
  overflow: hidden;
  padding: 0;
  border: 2px solid #d6ba90;
  border-radius: 10px;
  background: #fffdf7;
  box-shadow: 3px 3px 0 #dfc9a6;
  color: #4e3829;
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.13s ease,
    box-shadow 0.13s ease;
}
.game-card:hover,
.game-card:focus-visible {
  outline: 0;
  transform: translate(-2px, -2px);
  box-shadow: 5px 5px 0 #c8a77b;
}
.game-card.on {
  border-color: #9a674b;
  box-shadow: 4px 4px 0 #c08d5f;
}
.card-visual {
  position: relative;
  display: grid;
  height: 104px;
  place-items: center;
  overflow: hidden;
  border-bottom: 2px solid #d6ba90;
}
.card-visual::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0.45;
  background: radial-gradient(rgba(255, 255, 255, 0.9) 1px, transparent 1px);
  background-size: 12px 12px;
}
.card-emoji {
  position: relative;
  z-index: 2;
  font-size: 44px;
}
.card-copy {
  display: grid;
  gap: 3px;
  padding: 9px 11px 10px;
}
.card-copy b {
  overflow: hidden;
  color: #473125;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-copy small {
  overflow: hidden;
  color: #9a806b;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 관리자가 닫은 게임(-106) — 흐리게 두되 읽히게. 사라지지 않는다는 게 요점이다 */
.game-card.closed {
  opacity: 0.62;
  filter: saturate(0.7);
}
.game-card.closed:hover {
  transform: none;
}
.card-lock {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 5px;
  border: 1.5px solid #c58d6a;
  border-radius: 6px;
  background: #fdeee0;
  color: #a9613c;
  font-size: 9px;
  font-weight: 800;
  vertical-align: middle;
}

.detail {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: 18px 22px 18px;
  overflow: hidden;
  background: #fffdf8;
}
.detail-scroll {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #c89a71 transparent;
}
/**
 * 남는 세로 공간을 위아래로 나눠 설명을 가운데 둔다.
 * justify-content:center가 아니라 auto 마진인 이유 — 화면이 낮아 내용이 넘칠 때
 * center는 위쪽을 잘라 스크롤로도 못 올라가지만, auto 마진은 0으로 접혀 정상 스크롤된다.
 */
.detail-inner {
  width: 100%;
  margin: auto 0;
}
/* 스크롤 영역 밖에 있어 늘 맨 위에 남는다 — 설명을 넘겨도 게임 이름은 고정 */
.detail-head {
  flex: none;
}
.detail-head span {
  color: #a7836b;
  font-size: 10px;
}
.detail-head h3 {
  margin: 3px 0 10px;
  color: #3d2c22;
  font-family: var(--font-pixel);
  font-size: 21px;
  font-weight: 400;
}
/* 캐러셀은 세로가 긴 편이라 폭을 묶어 둔다 — 패널 폭을 다 쓰면 그림 높이가 창을 넘는다 */
.detail-guide {
  width: 100%;
  max-width: 320px;
  margin: 0 auto;
}
.detail-actions {
  display: flex;
  flex: none;
  gap: 10px;
  margin: 14px auto 0;
  width: 100%;
  max-width: 320px;
}
.act {
  flex: 1;
  padding: 12px 8px;
  border: 2px solid #9a674b;
  border-radius: 9px;
  box-shadow: 3px 3px 0 #c6a47d;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease;
}
.act:hover {
  transform: translate(-1px, -1px);
  box-shadow: 4px 4px 0 #b58f66;
}
.act.guide {
  background: #fff3d8;
  color: #7a5233;
}
.act.start {
  background: #7fa8e8;
  border-color: #4669b4;
  box-shadow: 3px 3px 0 #4669b4;
  color: #10254d;
}
.act.start:hover {
  box-shadow: 4px 4px 0 #3a5895;
}
.act.suggest {
  background: #ffd98d;
  border-color: #b1834f;
  box-shadow: 3px 3px 0 #b1834f;
  color: #6b4a26;
}
.act.suggest:hover {
  box-shadow: 4px 4px 0 #9a7043;
}
.detail-closed {
  flex: none;
  margin: 14px auto 0;
  width: 100%;
  max-width: 320px;
  padding: 11px;
  border: 2px solid #dcb37d;
  border-radius: 8px;
  background: #fff0c9;
  color: #a9613c;
  font-size: 11px;
  font-weight: 800;
  text-align: center;
}

.detail-empty {
  display: grid;
  width: 100%;
  height: 100%;
  place-content: center;
  color: #947d69;
  text-align: center;
}
.empty-spark {
  margin-bottom: 10px;
  color: #e68868;
  font-size: 37px;
}
.detail-empty strong {
  color: #624633;
  font-family: var(--font-pixel);
  font-size: 17px;
  font-weight: 400;
}
.detail-empty p {
  margin: 10px 0 0;
  font-size: 11px;
  line-height: 1.7;
}

@media (max-width: 760px) {
  .overlay {
    padding: 10px;
  }
  .dialog {
    max-height: calc(100vh - 20px);
    overflow-y: auto;
  }
  .head {
    padding: 16px 18px;
  }
  .head h2 {
    font-size: 20px;
  }
  .body {
    height: auto;
    grid-template-columns: 1fr;
  }
  .game-nav {
    max-height: 250px;
    border-right: 0;
    border-bottom: 2px solid #dec59e;
  }
  .game-list {
    grid-template-columns: 1fr 1fr;
  }
  .card-visual {
    height: 84px;
  }
}
</style>
