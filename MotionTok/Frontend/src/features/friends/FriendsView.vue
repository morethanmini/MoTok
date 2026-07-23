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
import AddFriendModal from './components/AddFriendModal.vue'
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

// 받은 요청 목록에 "친구 요청"이라는 고정 문구 대신 실제 받은 일시를 보여준다.
function fmtRequestedAt(iso: string) {
  const d = new Date(iso)
  const date = `${d.getMonth() + 1}.${d.getDate()}`
  const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  return `${date} ${time}`
}

const presenceLabel: Record<Presence, string> = { ONLINE: '온라인', OFFLINE: '오프라인', IN_ROOM: '게임 중' }
const presenceColor: Record<Presence, string> = { ONLINE: '#48c8a4', OFFLINE: '#b7abb8', IN_ROOM: '#ef6872' }

const tab = ref<'friends' | 'requests'>('friends')
const target = ref('')
const showAddModal = ref(false)

const { data: friends } = useAsyncData(() => friendsApi.list(), MOCK_FRIENDS)
const { data: requests } = useAsyncData(() => friendsApi.requests('received'), MOCK_REQS)

async function sendRequest() {
  if (!target.value.trim()) return flash('닉네임을 입력해 주세요')
  try {
    await friendsApi.sendRequest(target.value.trim())
    flash(`${target.value}님에게 친구 요청을 보냈어요`)
    target.value = ''
    showAddModal.value = false
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
  <AppPage title="친구" max-width="640px" title-style="plain">
    <PixelCard>
      <div class="tabs">
        <button class="tab-btn" :class="{ on: tab === 'friends' }" @click="tab = 'friends'">친구 {{ friends.length }}</button>
        <button class="tab-btn" :class="{ on: tab === 'requests' }" @click="tab = 'requests'">받은 요청 {{ requests.length }}</button>
        <PixelButton class="request-btn" variant="primary" @click="showAddModal = true">＋ 요청</PixelButton>
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
      <ul v-else class="list requests-list">
        <li v-for="r in requests" :key="r.requestId">
          <div class="req-avatar">{{ r.requesterNickname.charAt(0) }}</div>
          <div class="who"><b class="req-nick">{{ r.requesterNickname }}</b><small>{{ fmtRequestedAt(r.createdAt) }}</small></div>
          <div class="req-actions">
            <PixelButton variant="mint" @click="respond(r, 'ACCEPT')">수락</PixelButton>
            <PixelButton variant="primary" @click="respond(r, 'REJECT')">거절</PixelButton>
          </div>
        </li>
        <li v-if="requests.length === 0" class="empty">받은 요청이 없어요</li>
      </ul>
    </PixelCard>
    <PixelToast :message="toast" />
    <AddFriendModal v-if="showAddModal" v-model="target" @close="showAddModal = false" @send="sendRequest" />
  </AppPage>
</template>

<style scoped>
.tabs { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.tab-btn { height: 38px; padding: 0 14px; border: 2px solid var(--c-ink); border-radius: 11px; background: #fff; font-size: 11px; font-weight: 700; }
.tab-btn.on { background: var(--c-yellow); box-shadow: var(--shadow-sm); }
.request-btn { margin-left: auto; height: 38px; padding: 0 14px; font-size: 11px; }

.list { list-style: none; margin: 0; padding: 0; min-height: 340px; }
.list li { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; padding: 11px 12px; border: 2px solid #eaddea; border-radius: 12px; background: #fffdf8; }
.dot { width: 9px; height: 9px; border-radius: 50%; }
.who { min-width: 0; }
.who b { display: block; font-size: 12px; }
.req-nick { font-size: 18px; }
.req-avatar {
  flex: none;
  width: 40px;
  height: 40px;
  border: 2px solid var(--c-ink);
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--c-mint-soft);
  font-size: 16px;
  font-weight: 700;
}
.who small { display: block; font-size: 9px; color: var(--c-muted); margin-top: 3px; }
.list li > :nth-child(3) { margin-left: auto; }
.requests-list .req-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.req-actions :deep(.px-btn) { height: 32px; padding: 0 12px; font-size: 10px; }
.del { border: 0; background: transparent; color: var(--c-muted); font-size: 10px; }
.empty { justify-content: center; color: var(--c-muted); font-size: 11px; }
</style>
