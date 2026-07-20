<script setup lang="ts">
/** 공개방 카드. 입장 클릭 시 enter 이벤트를 부모로 올립니다. */
import type { Room } from '../data'

defineProps<{ room: Room }>()
defineEmits<{ enter: [] }>()
</script>

<template>
  <article class="room-card">
    <div class="room-icon">{{ room.emoji }}</div>
    <div class="room-copy">
      <strong>{{ room.title }}</strong>
      <div class="room-meta">
        <i>{{ room.count }}/{{ room.max }}명</i>
        <i>{{ room.game }}</i>
        <i>{{ room.visibility }}</i>
      </div>
      <div class="room-state" :class="{ playing: room.disabled }">● {{ room.state }}</div>
    </div>
    <button class="room-enter" :disabled="room.disabled" @click="$emit('enter')">
      {{ room.disabled ? '입장 불가' : '입장' }}
    </button>
  </article>
</template>

<style scoped>
.room-card {
  display: grid;
  grid-template-columns: 74px 1fr auto;
  gap: 13px;
  align-items: center;
  padding: 14px;
  border: var(--border);
  border-radius: 18px 18px 13px 18px;
  background: #fff;
  box-shadow: var(--shadow-md);
  text-align: left;
  transition: var(--t-fast);
}
.room-card:hover {
  transform: translate(-2px, -2px);
  box-shadow: var(--shadow-lg);
}
.room-icon {
  width: 70px;
  height: 65px;
  border: 2px solid var(--c-ink);
  border-radius: 15px;
  display: grid;
  place-items: center;
  font-size: 31px;
  background: var(--c-mint-soft);
  background-image: radial-gradient(rgba(255, 255, 255, 0.85) 1px, transparent 2px);
  background-size: 9px 9px;
}
.room-copy strong {
  display: block;
  font-size: 12px;
  margin-bottom: 7px;
}
.room-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.room-meta i {
  font-style: normal;
  font-size: 8px;
  padding: 4px 6px;
  border: 1.5px solid var(--c-ink);
  border-radius: 999px;
  background: #fff7d9;
}
.room-state {
  font-size: 8px;
  color: #378e74;
  margin-top: 7px;
}
.room-state.playing { color: var(--c-coral); }
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
</style>
