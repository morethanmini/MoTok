<script setup lang="ts">
/** 접속 친구 한 명. 플레이 중이면 초대 버튼, 온라인이면 상태 점. */
import type { Friend } from '../data'

defineProps<{ friend: Friend }>()
defineEmits<{ invite: [] }>()
</script>

<template>
  <div class="friend">
    <div class="face" :style="{ background: friend.bg }">{{ friend.face }}</div>
    <div class="friend-info">
      <b>{{ friend.name }}</b>
      <small>{{ friend.game }}</small>
    </div>
    <button v-if="friend.playing" class="invite" @click="$emit('invite')">참가</button>
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
.invite {
  margin-left: 8px;
  border: 2px solid var(--c-ink);
  border-radius: 8px;
  background: #fff;
  padding: 5px 7px;
  font-size: 8px;
}
</style>
