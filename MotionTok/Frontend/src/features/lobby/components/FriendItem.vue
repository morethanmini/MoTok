<script setup lang="ts">
/**
 * 접속 친구 한 명. 이름·현재 상태 문구와 온라인 여부 점.
 * 박스를 누르면 공개 프로필을 열도록 open을 올린다 — 조회는 LobbyView가 한다(친구 화면과 같은 컴포저블).
 */
import type { Friend } from '../data'
import UserAvatar from '@/components/common/UserAvatar.vue'

defineProps<{ friend: Friend }>()
defineEmits<{ open: [] }>()
</script>

<template>
  <div class="friend" role="button" tabindex="0" @click="$emit('open')" @keydown.enter="$emit('open')">
    <!-- 사진이 없거나 못 불러온 친구는 이모지 얼굴로 떨어진다(UserAvatar가 처리). -->
    <div class="face-frame">
      <UserAvatar
      class="face"
      :style="{ background: friend.bg }"
      :src="friend.avatarUrl"
      :fallback="friend.face"
      :alt="`${friend.name} 프로필 사진`"
      />
    </div>
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
  gap: 13px;
  padding: 14px 2px;
  border: 0;
  border-bottom: 2px dashed #eadcc6;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  cursor: pointer;
}
.friend:last-child { border: 0; }
.face-frame {
  flex: none;
  width: 50px;
  height: 50px;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  padding: 2.5px;
  background: #5e4634;
  clip-path: polygon(16px 0, 34px 0, 34px 3px, 40px 3px, 40px 6px, 44px 6px, 44px 10px, 47px 10px, 47px 16px, 50px 16px, 50px 34px, 47px 34px, 47px 40px, 44px 40px, 44px 44px, 40px 44px, 40px 47px, 34px 47px, 34px 50px, 16px 50px, 16px 47px, 10px 47px, 10px 44px, 6px 44px, 6px 40px, 3px 40px, 3px 34px, 0 34px, 0 16px, 3px 16px, 3px 10px, 6px 10px, 6px 6px, 10px 6px, 10px 3px, 16px 3px);
  box-shadow: 2px 2px 0 #e3d8c7;
  transform: scale(.92);
  transition: transform .15s ease, filter .15s ease;
}
.face {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  display: grid;
  place-items: center;
  background: #e8e3d9;
  clip-path: polygon(14px 0, 31px 0, 31px 3px, 36px 3px, 36px 6px, 40px 6px, 40px 10px, 43px 10px, 43px 14px, 45px 14px, 45px 31px, 43px 31px, 43px 36px, 40px 36px, 40px 40px, 36px 40px, 36px 43px, 31px 43px, 31px 45px, 14px 45px, 14px 43px, 9px 43px, 9px 40px, 5px 40px, 5px 36px, 2px 36px, 2px 31px, 0 31px, 0 14px, 2px 14px, 2px 10px, 5px 10px, 5px 6px, 9px 6px, 9px 3px, 14px 3px);
  font-size: 22px;
}
.friend-info { min-width: 0; margin: -3px -6px; padding: 3px 6px; border-radius: 6px; transition: background .15s ease; }
.friend-info b { display: block; color: #443127; font-size: 17px; line-height: 1.1; }
.friend-info small {
  display: block;
  margin-top: 5px;
  color: #897460;
  font-size: 12px;
  line-height: 1.1;
}
.status {
  margin-left: auto;
  margin-right: 16px;
  width: 12px;
  height: 12px;
  border: 2px solid #5f9057;
  border-radius: 3px;
  background: #a8d97c;
  box-shadow: inset 2px 2px 0 rgba(255, 255, 255, .45);
  clip-path: polygon(25% 0, 75% 0, 100% 25%, 100% 75%, 75% 100%, 25% 100%, 0 75%, 0 25%);
}
.status.offline {
  border-color: #998d85;
  background: #b7aaa2;
  box-shadow: none;
}
.friend:hover { background: transparent; }
.friend:hover .face-frame { filter: brightness(1.12); transform: scale(.98); }
.friend:focus-visible { outline: 2px solid var(--c-ink); outline-offset: 2px; }
</style>
