<script setup lang="ts">
/** 접속 친구 한 명. 이름·현재 상태 문구와 온라인 여부 점만 보여준다(읽기 전용). */
import type { Friend } from '../data'
import UserAvatar from '@/components/common/UserAvatar.vue'

defineProps<{ friend: Friend }>()
</script>

<template>
  <div class="friend">
    <!-- 사진이 없거나 못 불러온 친구는 이모지 얼굴로 떨어진다(UserAvatar가 처리). -->
    <UserAvatar
      class="face"
      :style="{ background: friend.bg }"
      :src="friend.avatarUrl"
      :fallback="friend.face"
      :alt="`${friend.name} 프로필 사진`"
    />
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

.friend {
  margin-bottom: 8px;
  padding: 9px 8px;
  border: 2px solid #ead8ba;
  border-radius: 9px;
  background: #fffaf0;
  box-shadow: 2px 2px 0 #eadcc6;
}
.friend:last-child { border-bottom: 2px solid #ead8ba; }
.face { width: 44px; height: 44px; border-color: #b98e5e; border-radius: 9px; box-shadow: 2px 2px 0 #ead8bd; }
.friend-info b { color: #443127; font-size: 14px; }
.friend-info small { margin-top: 4px; color: #897460; font-size: 10px; }
.status { width: 10px; height: 10px; border: 2px solid #60945b; border-radius: 3px; background: #82bd74; box-shadow: none; }
.status.offline { border-color: #998d85; background: #b7aaa2; box-shadow: none; }
</style>
