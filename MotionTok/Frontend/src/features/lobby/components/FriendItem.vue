<script setup lang="ts">
/**
 * 접속 친구 한 명. 이름·현재 상태 문구와 온라인 여부 점.
 * 박스를 누르면 공개 프로필을 열도록 open을 올린다 — 조회는 LobbyView가 한다(친구 화면과 같은 컴포저블).
 *
 * 귓속말(-150)은 <b>별도 버튼</b>이다. 박스 전체를 귓속말에 주면 전적을 볼 길이 없어지고,
 * 프로필을 한 번 더 거치게 하면 "친구에게 말 걸기"가 두 번 클릭이 된다 — 둘 다 자주 하는 행동이라
 * 각자 자기 자리를 준다. 안 읽은 말이 있으면 그 버튼에 개수를 띄운다.
 */
import type { Friend } from '../data'
import UserAvatar from '@/components/common/UserAvatar.vue'

defineProps<{ friend: Friend; unread?: number }>()
defineEmits<{ open: []; whisper: [] }>()
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
    <button
      type="button"
      class="whisper-btn"
      :aria-label="`${friend.name}님에게 귓속말`"
      title="귓속말"
      @click.stop="$emit('whisper')"
    >
      💬
      <span v-if="unread" class="unread">{{ unread > 9 ? '9+' : unread }}</span>
    </button>
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
  padding: 2px;
  border: 2px solid #8e714e;
  border-radius: 50%;
  background: #fff0b9;
  box-shadow: none;
  transform: none;
  transition: transform .15s ease, filter .15s ease;
}
.face {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #e8e3d9;
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
.whisper-btn {
  position: relative;
  margin-left: auto;
  flex: none;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 2px solid #8e714e;
  border-radius: 9px;
  background: #fff8e6;
  box-shadow: 2px 2px 0 #d9c7a8;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.whisper-btn:hover { background: #fff0b9; }
.whisper-btn:active { transform: translate(2px, 2px); box-shadow: none; }
.whisper-btn .unread {
  position: absolute;
  top: -7px;
  right: -7px;
  min-width: 17px;
  padding: 0 4px;
  border: 2px solid #fff;
  border-radius: 9px;
  background: #e2564a;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 15px;
}

.status {
  margin-left: 10px;
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
