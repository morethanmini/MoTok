<script setup lang="ts">
/** 친구 — 목록/요청/추가/방 합류 (API §6 /friends). */
import { ref } from 'vue'
import {
  friendsApi,
  ApiError,
  type Friend,
  type FriendRequestItem,
  type Presence,
} from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import { useAutoReload } from '@/composables/useAutoReload'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import UserProfileModal from '@/components/common/UserProfileModal.vue'
import AddFriendModal from './components/AddFriendModal.vue'
import { useToast } from '@/composables/useToast'
import { useUserProfile } from '@/composables/useUserProfile'

const { message: toast, flash } = useToast()
/** 친구를 누르면 공개 프로필(-96). 랭킹 화면과 같은 컴포저블·모달을 쓴다. */
const viewer = useUserProfile()

// 백엔드(-57)가 연동됐으므로 목업 폴백을 두지 않는다 — 가짜 친구가 보이면 API 실패를 알아챌 수 없다.
// 로드 실패 시에는 빈 목록 + 각 탭의 "없어요" 안내가 그대로 노출된다.
const NO_FRIENDS: Friend[] = []
const NO_REQUESTS: FriendRequestItem[] = []

// 요청 목록에 "친구 요청"이라는 고정 문구 대신 실제 일시를 보여준다.
function fmtRequestedAt(iso: string) {
  const d = new Date(iso)
  const date = `${d.getMonth() + 1}.${d.getDate()}`
  const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  return `${date} ${time}`
}

const presenceLabel: Record<Presence, string> = { ONLINE: '온라인', OFFLINE: '오프라인', IN_ROOM: '게임 중' }
const presenceColor: Record<Presence, string> = { ONLINE: '#48c8a4', OFFLINE: '#b7abb8', IN_ROOM: '#ef6872' }

const tab = ref<'friends' | 'received' | 'sent'>('friends')
const target = ref('')
const showAddModal = ref(false)
// 삭제 버튼은 평소엔 숨겨두고 "친구 관리"를 눌렀을 때만 노출
const manageMode = ref(false)

const { data: friends, reload: reloadFriends } = useAsyncData(() => friendsApi.list(), NO_FRIENDS)
const { data: requests, reload: reloadReceived } = useAsyncData(
  () => friendsApi.requests('received'),
  NO_REQUESTS,
)
const { data: sent, reload: reloadSent } = useAsyncData(
  () => friendsApi.requests('sent'),
  NO_REQUESTS,
)

/**
 * 세 목록은 서로 얽혀 있어 하나만 갱신하면 화면이 어긋난다 — 수락 한 번에 받은 요청이 줄고,
 * 친구가 늘고, (반대 방향 요청이 있었다면) 보낸 요청도 서버에서 사라진다.
 * 그래서 로컬에서 한 건씩 도려내지 않고 통째로 다시 불러온다.
 */
function reloadAll() {
  return Promise.all([reloadFriends(), reloadReceived(), reloadSent()])
}

// 상대가 내 요청을 수락·거절하면 서버에서는 사라지지만 내 화면은 그대로다. 푸시 통로가 없어 주기적으로 확인한다.
// 친구 추가 모달을 띄운 동안은 멈춘다 — 닉네임을 입력하는 중에 뒤 목록이 바뀔 이유가 없다.
const { reloadNow } = useAutoReload(reloadAll, { shouldSkip: () => showAddModal.value })

async function sendRequest() {
  if (!target.value.trim()) return flash('닉네임을 입력해 주세요')
  try {
    await friendsApi.sendRequest(target.value.trim())
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '요청을 보내지 못했어요')
    return
  }
  flash(`${target.value}님에게 친구 요청을 보냈어요`)
  target.value = ''
  showAddModal.value = false
  await reloadNow()
}
async function respond(req: FriendRequestItem, action: 'ACCEPT' | 'REJECT') {
  try {
    await friendsApi.respond(req.requestId, action)
  } catch (e) {
    // 실패했으면 목록을 건드리지 않는다 — 서버에 남아 있는 요청을 화면에서만 지우면 다음 조회에 되살아난다.
    flash(e instanceof ApiError ? e.message : '요청을 처리하지 못했어요')
    return
  }
  flash(action === 'ACCEPT' ? '친구를 수락했어요' : '요청을 거절했어요')
  await reloadNow()
}
async function cancelRequest(req: FriendRequestItem) {
  try {
    await friendsApi.cancelRequest(req.requestId)
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '요청을 취소하지 못했어요')
    return
  }
  flash(`${req.addresseeNickname}님에게 보낸 요청을 취소했어요`)
  await reloadNow()
}
async function removeFriend(f: Friend) {
  if (!confirm(`${f.nickname}님을 친구에서 삭제할까요?`)) return
  try {
    await friendsApi.remove(f.userId)
  } catch (e) {
    flash(e instanceof ApiError ? e.message : '친구를 삭제하지 못했어요')
    return
  }
  flash(`${f.nickname}님을 친구에서 삭제했어요`)
  await reloadNow()
}
</script>

<template>
  <AppPage title="친구" max-width="640px" title-style="plain">
    <PixelCard>
      <div class="tabs">
        <button class="tab-btn" :class="{ on: tab === 'friends' }" @click="tab = 'friends'">친구 {{ friends.length }}</button>
        <button class="tab-btn" :class="{ on: tab === 'received' }" @click="tab = 'received'">받은 요청 {{ requests.length }}</button>
        <button class="tab-btn" :class="{ on: tab === 'sent' }" @click="tab = 'sent'">보낸 요청 {{ sent.length }}</button>
        <div class="right-actions">
          <PixelButton
            v-if="tab === 'friends'"
            class="manage-btn"
            :variant="manageMode ? 'mint' : 'primary'"
            @click="manageMode = !manageMode"
          >
            {{ manageMode ? '완료' : '친구 관리' }}
          </PixelButton>
          <PixelButton class="request-btn" variant="primary" @click="showAddModal = true">＋ 요청</PixelButton>
        </div>
      </div>

      <!-- 친구 목록 -->
      <ul v-if="tab === 'friends'" class="list">
        <!--
          박스 전체가 프로필 열기 버튼이다(랭킹 표 행과 같은 방식).
          안쪽 닉네임을 button으로 두는 건 키보드 접근용 — 클릭은 li로 버블링되므로 핸들러는 하나뿐이다.
          오른쪽 조작 영역은 click.stop — 삭제를 누르려다 프로필이 열리면 안 된다.
        -->
        <li
          v-for="f in friends"
          :key="f.userId"
          class="clickable"
          @click="viewer.open(f.userId, f.nickname)"
        >
          <!-- 사진이 없거나 못 불러온 친구는 닉네임 첫 글자로 떨어진다(UserAvatar가 처리) -->
          <UserAvatar
            class="req-avatar"
            :src="f.avatarUrl"
            :fallback="f.nickname.charAt(0)"
            :alt="`${f.nickname} 프로필 사진`"
          />
          <div class="who">
            <button type="button" class="req-nick name-btn">{{ f.nickname }}</button>
          </div>
          <div class="friend-actions" @click.stop>
            <PixelButton v-if="manageMode" variant="mint" @click="removeFriend(f)">삭제</PixelButton>
            <span v-else class="presence-badge">
              <i class="dot" :style="{ background: presenceColor[f.presence] }" />
              {{ presenceLabel[f.presence] }}
            </span>
          </div>
        </li>
        <li v-if="friends.length === 0" class="empty">친구가 없어요</li>
      </ul>

      <!-- 받은 요청 -->
      <ul v-else-if="tab === 'received'" class="list requests-list">
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

      <!-- 보낸 요청 — 상대는 addressee이고, 취소만 할 수 있다(수락·거절은 받는 쪽 권한). -->
      <ul v-else class="list requests-list">
        <li v-for="r in sent" :key="r.requestId">
          <div class="req-avatar">{{ r.addresseeNickname.charAt(0) }}</div>
          <div class="who"><b class="req-nick">{{ r.addresseeNickname }}</b><small>{{ fmtRequestedAt(r.createdAt) }} · 대기 중</small></div>
          <div class="req-actions">
            <PixelButton variant="primary" @click="cancelRequest(r)">취소</PixelButton>
          </div>
        </li>
        <li v-if="sent.length === 0" class="empty">보낸 요청이 없어요</li>
      </ul>
    </PixelCard>
    <PixelToast :message="toast" />
    <AddFriendModal v-if="showAddModal" v-model="target" @close="showAddModal = false" @send="sendRequest" />
    <!-- 랭킹과 같은 모달·같은 조회 규칙. 친구 목록에는 순위 같은 수치가 없어 stats를 넘기지 않는다. -->
    <UserProfileModal
      v-if="viewer.isOpen.value"
      :user-id="viewer.targetId.value!"
      :profile="viewer.profile.value"
      :nickname="viewer.nickname.value"
      :loading="viewer.loading.value"
      :error="viewer.error.value"
      @close="viewer.close()"
      @reported="flash"
    />
  </AppPage>
</template>

<style scoped>
.tabs { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.tab-btn { height: 38px; padding: 0 14px; border: 2px solid var(--c-ink); border-radius: 11px; background: #fff; font-size: 11px; font-weight: 700; }
.tab-btn.on { background: var(--c-yellow); box-shadow: var(--shadow-sm); }
.right-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.request-btn, .manage-btn { height: 38px; padding: 0 14px; font-size: 11px; }

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
.list li.clickable { cursor: pointer; }
.list li.clickable:hover { border-color: var(--c-ink); background: var(--c-mint-soft); }
/* 키보드 접근용 버튼 — 보이는 모양은 원래 <b> 그대로다 */
.name-btn { display: block; padding: 0; border: 0; background: transparent; font: inherit; color: inherit; cursor: pointer; }
.friend-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.friend-actions :deep(.px-btn) { height: 32px; padding: 0 12px; font-size: 10px; }
.presence-badge { display: flex; align-items: center; gap: 6px; font-size: 9px; color: var(--c-muted); }
.requests-list .req-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.req-actions :deep(.px-btn) { height: 32px; padding: 0 12px; font-size: 10px; }
.empty { justify-content: center; color: var(--c-muted); font-size: 11px; }
</style>
