<script setup lang="ts">
/**
 * 접속 친구 한 명. 이름·현재 상태 문구와 온라인 여부 점.
 *
 * 누르는 자리에 따라 갈린다 — <b>박스</b>는 귓속말(-150), <b>프로필 동그라미</b>는 공개 프로필(-96).
 * 둘 다 자주 하는 행동이라 각자 자리를 준다. 조회·열기는 LobbyView가 한다(친구 화면과 같은 컴포저블).
 * 안 읽은 말이 있으면 개수를 띄운다.
 */
import { computed } from 'vue'
import type { Friend } from '../data'
import UserAvatar from '@/components/common/UserAvatar.vue'

const props = defineProps<{ friend: Friend; unread?: number; lastSeenAt?: string | null }>()
defineEmits<{ open: []; profile: [] }>()

/**
 * 마지막 접속 시각 문구(-179) — 상태 줄의 "오프라인" 뒤에 붙는다.
 *
 * <p>오프라인일 때만 그린다. 접속 중인 친구에게는 서버가 값을 안 주지만, 실시간 델타로
 * 온라인이 된 순간에는 이 프롭이 아직 남아 있을 수 있어 여기서도 한 번 더 막는다.</p>
 *
 * <p>날짜는 오늘·어제만 말로 바꾸고 그보다 오래되면 그냥 날짜를 쓴다. "5일 전"류는 며칠인지
 * 세게 만들 뿐이고, 이 줄에 주어진 폭도 좁다.</p>
 */
const lastSeenLabel = computed(() => {
  if (props.friend.online || !props.lastSeenAt) return ''
  // 서버가 타임존 없는 로컬 시각을 준다 — Date가 브라우저 로컬(=KST)로 읽어 그대로 맞는다.
  const seen = new Date(props.lastSeenAt)
  if (Number.isNaN(seen.getTime())) return ''

  const time = seen.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  if (seen >= midnight) return `오늘 ${time}`
  const yesterday = new Date(midnight.getTime() - 86_400_000)
  if (seen >= yesterday) return `어제 ${time}`
  return `${seen.getMonth() + 1}월 ${seen.getDate()}일 ${time}`
})
</script>

<template>
  <!--
    바깥 박스에 role="button"을 주지 않는다 — 그 안에 프로필 동그라미 버튼이 들어 있고,
    button 역할 안에 포커스 가능한 자손을 두면 스크린리더가 구조를 잘못 읽는다(ARIA).
    마우스 편의를 위한 클릭만 남기고, 키보드 경로는 안쪽 두 버튼이 각자 가져간다.
  -->
  <div class="friend" @click="$emit('open')">
    <!--
      동그라미만 프로필로 간다. 바깥 박스가 귓속말이라 클릭이 새어 나가지 않게 stop을 건다.
      사진이 없거나 못 불러온 친구는 이모지 얼굴로 떨어진다(UserAvatar가 처리).
    -->
    <button
      type="button"
      class="face-frame"
      :aria-label="`${friend.name} 프로필 보기`"
      @click.stop="$emit('profile')"
      @keydown.enter.stop="$emit('profile')"
      @keydown.space.prevent.stop="$emit('profile')"
    >
      <UserAvatar
        class="face"
        :style="{ background: friend.bg }"
        :src="friend.avatarUrl"
        :fallback="friend.face"
        :alt="`${friend.name} 프로필 사진`"
      />
    </button>
    <!-- 이름 쪽이 귓속말의 키보드 경로다 — 박스 전체 클릭은 마우스용으로 그대로 남는다 -->
    <button
      type="button"
      class="friend-info"
      :aria-label="`${friend.name}에게 귓속말`"
      @click.stop="$emit('open')"
    >
      <b>{{ friend.name }}</b>
      <small>
        {{ friend.game }}
        <span v-if="lastSeenLabel" class="last-seen">· {{ lastSeenLabel }}</span>
      </small>
    </button>
    <span v-if="unread" class="unread">{{ unread > 9 ? '9+' : unread }}</span>
    <i class="status" :class="{ offline: !friend.online }" />
  </div>
</template>

<style scoped>
.friend {
  position: relative;
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
  cursor: pointer;
}
.face-frame:focus-visible { outline: 2px solid var(--c-ink); outline-offset: 2px; }
/* 동그라미만 따로 눌린다는 걸 hover로 알린다(박스 hover와 구별) */
.face-frame:hover { filter: brightness(1.12); transform: scale(1.06); }
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
.friend-info { min-width: 0; margin: -3px -6px; padding: 3px 6px; border: 0; border-radius: 6px; background: transparent; box-shadow: none; font: inherit; text-align: left; cursor: pointer; transition: background .15s ease; }
.friend-info:focus-visible { outline: 2px solid var(--c-ink); outline-offset: 2px; }
.friend-info b { display: block; color: #443127; font-size: 17px; line-height: 1.1; }
.friend-info small {
  display: block;
  margin-top: 5px;
  color: #897460;
  font-size: 12px;
  line-height: 1.1;
}
/* "오프라인" 옆 여백에 얹는다 — 상태가 주(主)라 한 톤 흐리게 두고, 좁아지면 이쪽부터 잘린다. */
.friend-info small { display: flex; align-items: baseline; gap: 4px; min-width: 0; }
.last-seen { flex: 0 1 auto; overflow: hidden; color: #a89684; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.whisper-btn {
  position: relative;
  margin-left: auto;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  width: 34px;
  min-width: 34px;
  height: 34px;
  padding: 0;
  border: 2px solid #8e714e;
  border-radius: 9px;
  background: #fff8e6;
  color: #5a3b2d;
  box-shadow: 2px 2px 0 #d9c7a8;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}
.whisper-btn:hover { border-color: #76513c; background: #f7df9e; box-shadow: 3px 3px 0 #cdb28e; }
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
.whisper-mark { position: relative; width: 14px; height: 11px; border: 2px solid currentColor; border-radius: 3px; }.whisper-mark::before { content: '···'; position: absolute; left: 2px; top: -8px; font-size: 12px; font-weight: 700; letter-spacing: -1px; }.whisper-mark::after { content: ''; position: absolute; right: 1px; bottom: -5px; width: 4px; height: 4px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: skewY(-35deg); }

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
.friend > .unread { position: absolute; right: 32px; top: 11px; min-width: 17px; padding: 0 4px; border: 2px solid #fff8e6; border-radius: 9px; background: #e2564a; color: #fff; font-size: 10px; font-weight: 700; line-height: 15px; }
.friend:hover { background: transparent; }
.friend:hover .face-frame { filter: brightness(1.12); transform: scale(.98); }
</style>
