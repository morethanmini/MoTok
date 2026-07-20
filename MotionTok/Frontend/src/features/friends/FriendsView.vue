<script setup lang="ts">
/** 친구 — 목록/요청/추가/방 합류 (API §6 /friends). */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  friendsApi,
  ApiError,
  type Friend,
  type FriendRequestItem,
  type Presence,
} from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import { RouteName } from '@/router/routeNames'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const { message: toast, flash } = useToast()

const MOCK_FRIENDS: Friend[] = [
  { userId: 2, nickname: '민지', presence: 'ONLINE', currentRoomId: null },
  { userId: 3, nickname: '준호', presence: 'IN_ROOM', currentRoomId: 'MP4X9K' },
  { userId: 4, nickname: 'Alex', presence: 'OFFLINE', currentRoomId: null },
]
const MOCK_REQS: FriendRequestItem[] = [
  { requestId: 11, requesterNickname: '수아', addresseeNickname: 'P1', status: 'PENDING', createdAt: '2025-07-18T00:00:00Z' },
]

const presenceLabel: Record<Presence, string> = { ONLINE: '온라인', OFFLINE: '오프라인', IN_ROOM: '게임 중' }
const presenceColor: Record<Presence, string> = { ONLINE: '#48c8a4', OFFLINE: '#b7abb8', IN_ROOM: '#ef6872' }

const tab = ref<'friends' | 'requests'>('friends')
const target = ref('')

const { data: friends } = useAsyncData(() => friendsApi.list(), MOCK_FRIENDS)
const { data: requests } = useAsyncData(() => friendsApi.requests('received'), MOCK_REQS)

async function sendRequest() {
  if (!target.value.trim()) return flash('닉네임을 입력해 주세요')
  try {
    await friendsApi.sendRequest(target.value.trim())
    flash(`${target.value}님에게 친구 요청을 보냈어요`)
    target.value = ''
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '요청 실패 (백엔드 미연동)')
  }
}
async function respond(req: FriendRequestItem, action: 'ACCEPT' | 'REJECT') {
  try {
    await friendsApi.respond(req.requestId, action)
  } catch (e) {
    if (e instanceof ApiError) flash(e.message)
  }
  requests.value = requests.value.filter((r) => r.requestId !== req.requestId)
  flash(action === 'ACCEPT' ? '친구를 수락했어요' : '요청을 거절했어요')
}
// 친구가 참여 중인 방으로 합류 (GET /friends/{friendId}/room → roomId 조회 후 기기 점검 화면으로)
async function joinFriendRoom(f: Friend) {
  try {
    const { roomId } = await friendsApi.room(f.userId)
    if (!roomId) return flash(`${f.nickname}님은 지금 합류할 수 있는 방이 없어요`)
    router.push({ name: RouteName.DeviceSetup, query: { room: roomId } })
  } catch (e) {
    // 백엔드 미연동 시 친구 목록의 currentRoomId로 폴백
    if (f.currentRoomId) return router.push({ name: RouteName.DeviceSetup, query: { room: f.currentRoomId } })
    flash(e instanceof ApiError ? e.message : '방 정보를 불러오지 못했어요 (백엔드 미연동)')
  }
}
async function removeFriend(f: Friend) {
  if (!confirm(`${f.nickname}님을 친구에서 삭제할까요?`)) return
  try {
    await friendsApi.remove(f.userId)
  } catch (e) {
    if (e instanceof ApiError) flash(e.message)
  }
  friends.value = friends.value.filter((x) => x.userId !== f.userId)
}
</script>

<template>
  <AppPage title="친구" subtitle="닉네임으로 친구를 찾고 초대해요" max-width="640px">
    <PixelCard>
      <div class="add">
        <input v-model="target" placeholder="닉네임으로 친구 검색" @keydown.enter="sendRequest" />
        <PixelButton variant="primary" @click="sendRequest">＋ 요청</PixelButton>
      </div>

      <div class="tabs">
        <button :class="{ on: tab === 'friends' }" @click="tab = 'friends'">친구 {{ friends.length }}</button>
        <button :class="{ on: tab === 'requests' }" @click="tab = 'requests'">받은 요청 {{ requests.length }}</button>
      </div>

      <!-- 친구 목록 -->
      <ul v-if="tab === 'friends'" class="list">
        <li v-for="f in friends" :key="f.userId">
          <span class="dot" :style="{ background: presenceColor[f.presence] }" />
          <div class="who">
            <b>{{ f.nickname }}</b>
            <small>{{ presenceLabel[f.presence] }}<template v-if="f.currentRoomId"> · {{ f.currentRoomId }}</template></small>
          </div>
          <PixelButton v-if="f.presence === 'IN_ROOM'" variant="yellow" @click="joinFriendRoom(f)">함께하기</PixelButton>
          <button class="del" @click="removeFriend(f)">삭제</button>
        </li>
        <li v-if="friends.length === 0" class="empty">친구가 없어요</li>
      </ul>

      <!-- 받은 요청 -->
      <ul v-else class="list">
        <li v-for="r in requests" :key="r.requestId">
          <div class="who"><b>{{ r.requesterNickname }}</b><small>친구 요청</small></div>
          <PixelButton variant="mint" @click="respond(r, 'ACCEPT')">수락</PixelButton>
          <button class="del" @click="respond(r, 'REJECT')">거절</button>
        </li>
        <li v-if="requests.length === 0" class="empty">받은 요청이 없어요</li>
      </ul>
    </PixelCard>
    <PixelToast :message="toast" />
  </AppPage>
</template>

<style scoped>
.add { display: flex; gap: 8px; margin-bottom: 16px; }
.add input {
  flex: 1; height: 44px; padding: 0 12px;
  border: 2px solid var(--c-ink); border-radius: var(--radius-sm); background: #fff; outline: 0;
}
.tabs { display: flex; gap: 8px; margin-bottom: 14px; }
.tabs button { height: 38px; padding: 0 14px; border: 2px solid var(--c-ink); border-radius: 11px; background: #fff; font-size: 11px; }
.tabs button.on { background: var(--c-yellow); box-shadow: var(--shadow-sm); font-weight: 700; }

.list { list-style: none; margin: 0; padding: 0; }
.list li { display: flex; align-items: center; gap: 10px; padding: 11px 0; border-bottom: 2px dashed #eaddea; }
.dot { width: 9px; height: 9px; border-radius: 50%; }
.who { min-width: 0; }
.who b { display: block; font-size: 12px; }
.who small { display: block; font-size: 9px; color: var(--c-muted); margin-top: 3px; }
.list li > :nth-child(3) { margin-left: auto; }
.del { border: 0; background: transparent; color: var(--c-muted); font-size: 10px; }
.empty { justify-content: center; color: var(--c-muted); font-size: 11px; }
</style>
