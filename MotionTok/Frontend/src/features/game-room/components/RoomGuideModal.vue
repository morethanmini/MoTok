<script setup lang="ts">
import { useScrollLock } from '@/composables/useScrollLock'
/**
 * 게임 설명 함께 보기 — 방장이 넘기면 방 전원의 화면이 같이 넘어간다.
 *
 * 방장 화면과 참가자 화면은 <b>같은 그림, 다른 조작</b>이다. 방장만 페이지를 넘기고
 * (넘길 때마다 서버로 상태를 발신) 시작·되돌리기를 고를 수 있다. 참가자 쪽은 캐러셀을
 * readonly로 두는데, 혼자만 다른 장을 보게 만들 수 있으면 "함께 보기"가 성립하지 않는다.
 *
 * 참가자에게도 닫기는 준다 — 설명을 보든 말든 방을 못 쓰게 가두면 안 된다. 닫아도 방장의
 * 진행에는 영향이 없고(로컬), 방장이 다른 게임으로 바꾸면 다시 뜬다(GameRoomView가 판단).
 */
import GameGuideCarousel from '@/features/games-catalog/guide/GameGuideCarousel.vue'
import type { GuidePage } from '@/features/games-catalog/guide/pages'
import type { GameEntry } from '../data'

defineProps<{
  game: GameEntry
  pages: GuidePage[]
  page: number
  isHost: boolean
}>()

const emit = defineEmits<{
  'update:page': [page: number]
  /** 방장 — 이 게임을 지금 시작한다. */
  start: []
  /** 방장 — 설명을 접고 게임 선택으로 되돌아간다. */
  back: []
  /** 참가자 — 내 화면에서만 닫는다. */
  dismiss: []
}>()

// 설명이 떠 있는 동안 뒤 화면이 스크롤되지 않게 — 이 오버레이는 PixelModal이 아니라 직접 건다
useScrollLock()
</script>

<template>
  <div class="overlay">
    <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="room-guide-title">
      <header class="head">
        <div>
          <span class="eyebrow">{{ isHost ? 'HOW TO PLAY' : '방장이 설명 중이에요' }}</span>
          <h2 id="room-guide-title">{{ game.name }}</h2>
        </div>
        <button
          v-if="!isHost"
          class="close"
          type="button"
          aria-label="내 화면에서 설명 닫기"
          @click="emit('dismiss')"
        >
          ×
        </button>
      </header>

      <div class="stage">
        <GameGuideCarousel
          :pages="pages"
          :page="page"
          :readonly="!isHost"
          @update:page="emit('update:page', $event)"
        />
      </div>

      <footer class="foot">
        <template v-if="isHost">
          <button class="act back" type="button" @click="emit('back')">다른 게임</button>
          <button class="act start" type="button" @click="emit('start')">
            바로 시작 <span aria-hidden="true">→</span>
          </button>
        </template>
        <p v-else class="follow-note">방장이 넘기면 이 화면도 같이 넘어가요.</p>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  /* 게임 선택(80)·설정(81) 위 — 설명이 떠 있는 동안은 이게 가장 앞이다 */
  z-index: 82;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(48, 35, 47, 0.62);
}
.dialog {
  width: min(430px, 100%);
  max-height: calc(100vh - 36px);
  overflow-y: auto;
  padding: 22px 24px 20px;
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
  gap: 12px;
  margin-bottom: 14px;
}
.eyebrow {
  color: #b17b51;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 1.1px;
}
.head h2 {
  margin: 6px 0 0;
  color: #392b22;
  font-family: var(--font-pixel);
  font-size: 24px;
  font-weight: 400;
}
.close {
  display: grid;
  width: 30px;
  height: 30px;
  flex: none;
  place-items: center;
  border: 0;
  background: transparent;
  color: #895e46;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.close:hover {
  color: #bd625b;
}

.foot {
  display: flex;
  gap: 10px;
  margin-top: 18px;
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
.act.back {
  background: #fff3d8;
  color: #7a5233;
}
/* 게임 선택창의 '바로 시작'과 같은 파란색 — 같은 일을 하는 버튼이라 색도 같아야 한다 */
.act.start {
  border-color: #4669b4;
  background: #7fa8e8;
  box-shadow: 3px 3px 0 #4669b4;
  color: #10254d;
}
.act.start:hover {
  box-shadow: 4px 4px 0 #3a5895;
}
.follow-note {
  width: 100%;
  margin: 0;
  padding: 11px;
  border: 2px solid #dfc391;
  border-radius: 8px;
  background: #fffaf0;
  color: #8b725d;
  font-size: 11px;
  text-align: center;
}
</style>
