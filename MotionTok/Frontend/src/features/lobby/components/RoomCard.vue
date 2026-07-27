<script setup lang="ts">
/** 공개방 카드. 입장 클릭 시 enter 이벤트를 부모로 올립니다. */
import type { Room } from '../data'

defineProps<{ room: Room }>()
defineEmits<{ enter: [] }>()
</script>

<template>
  <article class="room-card">
    <div class="room-card-inner">
      <div class="room-icon">{{ room.emoji }}</div>
      <div class="room-copy">
        <strong>
          {{ room.title }}
          <!-- 비밀방에만 표시. 🔒과 🔓는 둘 다 자물쇠라 이 크기에서 구분이 안 돼서
               공개방은 아무것도 그리지 않는다 — 없는 표시는 잘못 읽힐 수가 없다. -->
          <i v-if="room.visibility === '비공개'" class="lock" title="비밀방 · 입장 시 비밀번호 필요">🔒</i>
        </strong>
        <span class="room-count">{{ room.count }}/{{ room.max }}명</span>
      </div>
      <div class="room-side">
        <div class="room-state" :class="{ playing: room.disabled }">● {{ room.state }}</div>
        <button class="room-enter" :disabled="room.disabled" @click="$emit('enter')">
          {{ room.disabled ? '입장 불가' : '입장' }}
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.room-card {
  text-align: left;
}
.room-card-inner {
  display: grid;
  grid-template-columns: 62px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 13px 18px;
  border: var(--border);
  border-radius: 18px 18px 13px 18px;
  background: #fff;
  box-shadow: var(--shadow-md);
  transition: var(--t-fast);
  /* 항상 자체 컴포지팅 레이어에 두어, 호버 시작/종료마다 레이어가 새로 생기며
     그림자가 다시 그려지는 깜빡임(promote/demote flicker)을 막는다 */
  transform: translateZ(0);
  backface-visibility: hidden;
}
.room-card:hover .room-card-inner {
  transform: translate3d(-2px, -2px, 0);
  box-shadow: var(--shadow-lg);
}
.room-icon {
  width: 62px;
  height: 58px;
  border: 2px solid var(--c-ink);
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 25px;
  background: var(--c-mint-soft);
  background-image: radial-gradient(rgba(255, 255, 255, 0.85) 1px, transparent 2px);
  background-size: 9px 9px;
}
.room-copy strong {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 17px;
  margin-bottom: 6px;
}
.lock {
  font-style: normal;
  font-size: 16px;
}
.room-state {
  font-size: 8px;
  color: #378e74;
  margin-top: 5px;
}
.room-state.playing { color: var(--c-coral); }
.room-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 7px;
}
.room-count {
  font-size: 13px;
  font-weight: 700;
  padding: 4px 6px;
}
.room-enter {
  padding: 9px 10px;
  border: 2px solid var(--c-ink);
  border-radius: 10px;
  background: var(--c-yellow);
  font-size: 9px;
  font-weight: 700;
}
.room-enter:disabled {
  background: #ddd4d5;
  color: #92878f;
}

/* Warm, game-lobby treatment; room data and emit contract stay unchanged. */
.room-card-inner {
  border: 2px solid #d9b77f;
  border-radius: 12px;
  background: #fffdf7;
  box-shadow: 3px 3px 0 #e6d2b1;
}
.room-card:hover .room-card-inner { box-shadow: 5px 5px 0 #dcc398; }
.room-icon {
  width: 54px;
  height: 52px;
  border-color: #c39a68;
  border-radius: 10px;
  background-color: #dff3cf;
}
.room-copy strong { margin-bottom: 1px; color: #423127; font-size: 15px; }
.room-copy .room-count { display: block; padding: 1px 0 0; text-align: left; }
.room-state { color: #5d9c5e; font-size: 11px; }
.room-state.playing { color: #dc7171; }
.room-count { color: #735d47; }
.room-enter {
  display: inline-flex;
  align-items: center;
  padding: 4px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: #6f5139;
  font-size: 12px;
}
.room-enter:not(:disabled):hover { transform: translateY(-1px); filter: brightness(1.04); }
.room-enter:disabled { border: 0; background: transparent; box-shadow: none; }
@media (prefers-reduced-motion: reduce) { .room-card-inner, .room-enter { transition: none; } }
</style>
