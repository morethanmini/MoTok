<script setup lang="ts">
/** 게임 선택 모달. 카드 클릭 시 launch(게임) 이벤트. */
import { GAME_CATALOG, type GameEntry } from '../data'

defineEmits<{ close: []; launch: [game: GameEntry] }>()
</script>

<template>
  <div class="overlay" @click="$emit('close')">
    <div class="dialog" @click.stop>
      <div class="head">
        <div>
          <span class="kicker">MOTOK GAME STATION</span>
          <h2>플레이할 게임을 골라주세요</h2>
        </div>
        <span class="sub">웹캠으로 몸을 움직여 플레이!</span>
        <button class="close" @click="$emit('close')">X</button>
      </div>

      <div class="grid">
        <button
          v-for="g in GAME_CATALOG"
          :key="g.id"
          class="game-card"
          @click="$emit('launch', g)"
        >
          <div class="thumb" :style="{ background: g.thumb }">
            <span class="emoji">{{ g.emoji }}</span>
            <span class="ribbon" :class="g.playable ? 'play' : 'soon'">
              {{ g.playable ? 'PLAY' : 'SOON' }}
            </span>
          </div>
          <div class="body">
            <div class="name">{{ g.name }}</div>
            <div class="tag">{{ g.tag }}</div>
          </div>
        </button>
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
  width: 840px;
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
.kicker { padding: 5px 7px; border: 2px solid var(--c-ink); border-radius: 999px; background: var(--c-yellow); font-size: 7px; font-weight: 700; }
.sub { font-size: 11px; color: #a99f86; }
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
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.game-card {
  text-align: left;
  border: 3px solid var(--c-ink-soft);
  background: #fff;
  padding: 0;
  overflow: hidden;
  border-radius: 15px 15px 11px 15px;
  box-shadow: 4px 4px 0 rgba(43, 35, 51, 0.2);
  transition: var(--t-fast);
}
.game-card:hover { transform: translate(-2px, -2px); box-shadow: var(--shadow-lg); }
.thumb {
  height: 110px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border-bottom: 3px solid var(--c-ink-soft);
}
.emoji { font-size: 42px; }
.ribbon {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 5px 8px;
  font-size: 8px;
  border: 2px solid var(--c-ink-soft);
}
.ribbon.play { background: #5cbf4a; color: #fff; }
.ribbon.soon { background: #f5c518; color: var(--c-ink-soft); }
.body { padding: 12px 14px 14px; }
.name { font-size: 10px; color: var(--c-ink-soft); }
.tag { font-size: 11px; color: #a99f86; margin-top: 7px; }
.foot { margin: 18px 0 0; font-size: 11px; color: #a99f86; line-height: 1.7; }
</style>
