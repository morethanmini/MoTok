<script setup lang="ts">
import { computed, ref } from 'vue'
import { GAME_CATALOG, type GameEntry } from '../data'

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
const props = withDefaults(defineProps<{ closedGameIds?: ReadonlySet<number> }>(), {
  closedGameIds: () => new Set<number>(),
})

defineEmits<{ close: []; launch: [game: GameEntry] }>()

const selected = ref<GameEntry | null>(null)
const playableGames = GAME_CATALOG.filter((game) => game.playable)

const isClosed = (game: GameEntry) => props.closedGameIds.has(game.gameId)
/** 선택된 게임이 닫혔으면 시작 버튼을 감춘다 — 목록에서 막아도 미리 골라 둔 상태로 열릴 수 있다. */
const selectedClosed = computed(() => !!selected.value && isClosed(selected.value))
</script>

<template>
  <div class="overlay" @click="$emit('close')">
    <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="game-picker-title" @click.stop>
      <header class="head">
        <div>
          <span class="eyebrow">MOTION ARCADE</span>
          <h2 id="game-picker-title">어떤 게임을 해볼까요?</h2>
        </div>
        <button class="close" type="button" aria-label="게임 선택 닫기" @click="$emit('close')">×</button>
      </header>

      <div class="body">
        <nav class="game-nav" aria-label="게임 목록">
          <div class="nav-label"><span>GAME LIST</span></div>
          <ul class="game-list">
            <li v-for="g in playableGames" :key="g.id">
              <!-- 닫힌 게임도 목록에 남긴다. 눌러 규칙은 읽을 수 있고 시작만 막힌다 -->
              <button
                class="game-row"
                :class="{ on: selected?.id === g.id, closed: isClosed(g) }"
                type="button"
                :aria-pressed="selected?.id === g.id"
                @click="selected = g"
              >
                <span class="row-thumb" :style="{ background: g.thumb }">{{ g.emoji }}</span>
                <span class="row-info">
                  <b>{{ g.name }}<span v-if="isClosed(g)" class="row-lock">점검 중</span></b>
                  <small>{{ g.tag }}</small>
                </span>
              </button>
            </li>
          </ul>
        </nav>

        <article class="detail" :class="{ selected: !!selected }">
          <template v-if="selected">
            <div class="detail-hero" :style="{ background: selected.thumb }">
              <span class="detail-emoji">{{ selected.emoji }}</span>
            </div>
            <div class="detail-copy">
              <div class="detail-title">
                <div><span>{{ selected.tag }}</span><h3>{{ selected.name }}</h3></div>
                <!-- 닫힌 게임은 버튼을 감춘다 — 눌러 보고 서버 에러를 받는 것보다 이유를 미리 말하는 게 낫다 -->
                <span v-if="selectedClosed" class="start-closed">점검 중이라 지금은 시작할 수 없어요</span>
                <button v-else class="start-game-btn" type="button" @click="$emit('launch', selected)">GAME START <span aria-hidden="true">→</span></button>
              </div>
              <div class="info-block"><b>GAME STORY</b><p>{{ selected.description }}</p></div>
              <div class="info-block how-to"><b>HOW TO PLAY</b><ol><li v-for="(step, i) in selected.howToPlay" :key="i">{{ step }}</li></ol></div>
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
.overlay { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 18px; background: rgba(48, 35, 47, .58); }
.dialog { width: min(990px, 100%); max-height: min(760px, calc(100vh - 36px)); overflow: hidden; border: 3px solid #9a674b; border-radius: 18px; background: #fffaf0; box-shadow: 8px 8px 0 rgba(68, 43, 30, .32); animation: px-pop .18s steps(3); }
.head { display: flex; align-items: start; justify-content: space-between; gap: 18px; padding: 22px 25px 19px; border-bottom: 2px solid #dec59e; background: linear-gradient(110deg, #fff2d8, #fffaf0); }.eyebrow, .nav-label span, .info-block > b, .foot > span { color: #b17b51; font-size: 9px; font-weight: 800; letter-spacing: 1.1px; }.head h2 { margin: 6px 0 5px; color: #392b22; font-family: var(--font-pixel); font-size: 25px; font-weight: 400; }.head p { margin: 0; color: #8c7564; font-size: 11px; }.close { display: grid; width: 32px; height: 32px; flex: none; place-items: center; border: 0; background: transparent; color: #895e46; font-size: 25px; line-height: 1; cursor: pointer; }.close:hover { color: #bd625b; transform: scale(1.08); }
.body { display: grid; grid-template-columns: minmax(255px, .78fr) minmax(0, 1.22fr); height: clamp(390px, 56vh, 510px); min-height: 0; }.game-nav { display: flex; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; padding: 16px 12px 14px; border-right: 2px solid #dec59e; background: #fff7e8; }.nav-label { display: flex; align-items: center; padding: 0 7px 10px; }
.game-list { display: grid; flex: 1; gap: 7px; min-height: 0; margin: 0; padding: 0 4px; overflow-y: auto; list-style: none; scrollbar-width: thin; scrollbar-color: #c89a71 transparent; }.game-row { display: flex; width: 100%; min-width: 0; align-items: center; gap: 12px; padding: 10px; border: 2px solid transparent; border-radius: 9px; background: transparent; color: #4e3829; text-align: left; cursor: pointer; transition: transform .13s ease, background .13s ease, box-shadow .13s ease; }.game-row:hover { background: #fffdf7; transform: translateX(2px); }.game-row.on { border-color: #9a674b; background: #fffdf7; box-shadow: 3px 3px 0 #dfbd92; }.row-thumb { display: grid; width: 48px; height: 48px; flex: none; place-items: center; border: 2px solid rgba(119, 82, 57, .45); border-radius: 9px; font-size: 24px; }.row-info { display: grid; min-width: 0; gap: 5px; }.row-info b { overflow: hidden; color: #4a3427; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }.row-info small { overflow: hidden; color: #9a806b; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.detail { display: flex; min-width: 0; min-height: 0; overflow-y: auto; background: #fffdf8; scrollbar-width: thin; scrollbar-color: #c89a71 transparent; }.detail-empty { display: grid; width: 100%; place-content: center; padding: 24px; color: #947d69; text-align: center; }.empty-spark { margin-bottom: 10px; color: #e68868; font-size: 37px; }.detail-empty strong { color: #624633; font-family: var(--font-pixel); font-size: 17px; font-weight: 400; }.detail-empty p { margin: 10px 0 0; font-size: 11px; line-height: 1.7; }
.detail-hero { position: relative; display: grid; min-height: 154px; place-items: center; overflow: hidden; border-bottom: 2px solid #d9be95; }.detail-hero::after { position: absolute; right: -19px; bottom: -38px; width: 138px; height: 138px; border: 3px solid rgba(255,255,255,.45); border-radius: 50%; content: ''; }.detail-emoji { position: relative; z-index: 1; filter: drop-shadow(3px 4px 0 rgba(89,55,39,.18)); font-size: 72px; }
.detail.selected { display: block; }.detail-copy { padding: 17px 20px 19px; }.detail-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.detail-title > div { min-width: 0; }.detail-title span { color: #a7836b; font-size: 10px; }.detail-title h3 { margin: 4px 0 13px; color: #3d2c22; font-family: var(--font-pixel); font-size: 20px; font-weight: 400; }.start-game-btn { flex: none; margin: 0 0 9px; padding: 5px 0; border: 0; background: transparent; color: #5f9a53; font-size: 10px; font-weight: 800; letter-spacing: .2px; white-space: nowrap; cursor: pointer; }.start-game-btn:hover { color: #3e7b3a; text-decoration: underline; text-underline-offset: 4px; }.start-game-btn span { color: currentColor; font-size: 15px; }.info-block { margin-top: 12px; }.info-block > b { display: block; margin-bottom: 5px; }.info-block p { margin: 0; color: #715c4c; font-size: 11px; line-height: 1.65; }.how-to ol { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; counter-reset: steps; }.how-to li { display: grid; grid-template-columns: 18px 1fr; gap: 6px; color: #715c4c; font-size: 10px; line-height: 1.45; counter-increment: steps; }.how-to li::before { display: grid; width: 17px; height: 17px; place-items: center; border-radius: 50%; background: #f2d29b; color: #765139; content: counter(steps); font-size: 8px; font-weight: 800; }
.nav-label span { font-size: 14px; }
/* 관리자가 닫은 게임(-106) — 흐리게 두되 읽히게. 사라지지 않는다는 게 요점이다 */
.game-row.closed { opacity: .62; }
.game-row.closed:hover { transform: none; }
.row-lock { display: inline-block; margin-left: 6px; padding: 2px 6px; border: 1.5px solid #c58d6a; border-radius: 6px; background: #fdeee0; color: #a9613c; font-size: 9px; font-weight: 800; vertical-align: middle; }
.start-closed { flex: none; margin: 0 0 9px; color: #a9613c; font-size: 10px; font-weight: 800; white-space: nowrap; }
@media (max-width: 690px) { .overlay { padding: 10px; }.dialog { max-height: calc(100vh - 20px); overflow-y: auto; }.head { padding: 18px; }.head h2 { font-size: 20px; }.head p { font-size: 10px; }.body { height: auto; grid-template-columns: 1fr; }.game-nav { height: 230px; max-height: 230px; border-right: 0; border-bottom: 2px solid #dec59e; }.detail { min-height: 300px; }.detail-hero { min-height: 125px; }.detail-copy { padding: 14px 16px 17px; }.foot { padding: 10px 17px; } }
</style>
