<script setup lang="ts">
/** 접속 친구 한 명. 이름·현재 상태 문구와 온라인 여부 점만 보여준다(읽기 전용). */
import type { Friend } from '../data'

defineProps<{ friend: Friend }>()
</script>

<template>
  <div class="friend">
    <div class="face" :style="{ background: friend.bg }">{{ friend.face }}</div>
    <div class="friend-info">
      <b>{{ friend.name }}</b>
      <small>{{ friend.game }}</small>
    </div>
    <i class="status" :class="{ offline: !friend.online }" />
  </div>
</template>

<style scoped>
.friend {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 2px dashed #eaddea;
}
.friend:last-child { border: 0; }
.face {
  width: 38px;
  height: 38px;
  border: 2px solid var(--c-ink);
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 17px;
}
.friend-info { min-width: 0; }
.friend-info b { display: block; font-size: 10px; }
.friend-info small {
  display: block;
  font-size: 8px;
  color: var(--c-muted);
  margin-top: 3px;
}
.status {
  margin-left: auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--c-mint);
  box-shadow: 0 0 0 3px var(--c-mint-soft);
}
.status.offline {
  background: #b3aab3;
  box-shadow: 0 0 0 3px #ece6ec;
}
</style>
