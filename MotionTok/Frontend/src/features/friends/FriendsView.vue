<script setup lang="ts">
/** 친구 — 목록/요청/추가/방 합류 (API §6 /friends). */
import { ref, watch } from 'vue'
import {
  friendsApi,
  ApiError,
  type Friend,
  type FriendRequestItem,
  type Presence,
} from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import { useLobbyLive } from '@/composables/useLobbyLive'
import { useWhisper } from '@/composables/useWhisper'
import { stompConnected } from '@/composables/useGlobalStomp'
import AppPage from '@/components/common/AppPage.vue'
import PixelCard from '@/components/common/PixelCard.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import UserProfileModal from '@/components/common/UserProfileModal.vue'
import AddFriendModal from './components/AddFriendModal.vue'
import WhisperModal from './components/WhisperModal.vue'
import { useToast } from '@/composables/useToast'
import { useUserProfile } from '@/composables/useUserProfile'
import lobbyFriendCats from '@/assets/lobby/lobby-friend-cats.png'
import lobbyCloudA from '@/assets/lobby/lobby-cloud-a.png'
import lobbyCloudB from '@/assets/lobby/lobby-cloud-b.png'
import lobbyGardenGrassTile from '@/assets/lobby/lobby-garden-grass-tile.png'
import lobbyEmptyCatToys from '@/assets/lobby/lobby-empty-cat-toys.png'

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

/**
 * 상대가 내 요청을 수락·거절하면 서버에서는 사라지지만 내 화면은 그대로다.
 * 예전에는 푸시 통로가 없어 20초마다 세 목록을 다시 받아 갔는데(-142 이전), 이제 서버가
 * 그 순간에만 개인 큐로 알려 준다. 친구 접속 상태도 마찬가지다.
 *
 * 친구 추가 모달이 떠 있는 동안은 반영을 미룬다 — 닉네임을 입력하는 중에 뒤 목록이 바뀌면
 * 방금 본 항목과 다른 것을 누르게 된다.
 */
/**
 * 친구 귓속말(-150). 수신함은 앱 수명에 있고(useWhisper) 여기서는 창을 열고 닫기만 한다 —
 * 창을 닫아 둔 사이에 온 말도 안 읽음으로 쌓여 있어야 한다.
 */
const whisper = useWhisper()
const whisperTarget = ref<{ userId: number; nickname: string } | null>(null)
function openWhisper(friend: { userId: number; nickname: string }) {
  whisperTarget.value = friend
  void whisper.open(friend.userId)
}
function closeWhisper() {
  whisperTarget.value = null
  whisper.close()
}
function sendWhisper(text: string) {
  if (!whisperTarget.value) return
  if (!whisper.send(whisperTarget.value.userId, text)) {
    flash('실시간 연결이 끊겨 있어요. 잠시 후 다시 시도해 주세요')
  }
}

const pendingRefresh = ref(false)
function refreshOrDefer() {
  if (showAddModal.value) {
    pendingRefresh.value = true
    return
  }
  void reloadAll()
}
watch(showAddModal, (open) => {
  if (open || !pendingRefresh.value) return
  pendingRefresh.value = false
  void reloadAll()
})

useLobbyLive({
  onNotification: refreshOrDefer,
  onFriendPresence: refreshOrDefer,
  // 끊겨 있던 동안의 변화는 되돌아오지 않는다 — 재연결마다 한 번 맞춘다.
  onResync: () => void reloadAll(),
})

const reloadNow = reloadAll

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
  <AppPage class="friends-page" title="친구" max-width="760px" title-style="none">
    <template #hero>
      <section class="friends-hero">
        <img class="hero-cloud cloud-a pixel-image" :src="lobbyCloudA" alt="" aria-hidden="true" />
        <img class="hero-cloud cloud-b pixel-image" :src="lobbyCloudB" alt="" aria-hidden="true" />
        <div class="hero-copy">
          <h1>내 친구</h1>
          <p>친구와 함께 게임을 즐겨보세요!</p>
        </div>
        <img class="hero-cat pixel-image" :src="lobbyFriendCats" alt="나란히 앉아 있는 두 고양이 캐릭터" />
        <div class="hero-grass pixel-image" :style="{ backgroundImage: `url(${lobbyGardenGrassTile})` }" aria-hidden="true" />
      </section>
    </template>

    <PixelCard class="friends-card" pad="18px">
      <div class="tabs">
        <button class="tab-btn" :class="{ on: tab === 'friends' }" @click="tab = 'friends'">
          <span>친구</span><b>{{ friends.length }}</b>
        </button>
        <button class="tab-btn" :class="{ on: tab === 'received' }" @click="tab = 'received'">
          <span>받은 요청</span><b>{{ requests.length }}</b>
        </button>
        <button class="tab-btn" :class="{ on: tab === 'sent' }" @click="tab = 'sent'">
          <span>보낸 요청</span><b>{{ sent.length }}</b>
        </button>
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
            <PixelButton v-else class="whisper-btn" @click="openWhisper(f)">
              귓속말<span v-if="whisper.unreadWith(f.userId) > 0" class="unread">{{ whisper.unreadWith(f.userId) }}</span>
            </PixelButton>
            <span v-if="!manageMode" class="presence-badge">
              <i class="dot" :style="{ background: presenceColor[f.presence] }" />
              {{ presenceLabel[f.presence] }}
            </span>
          </div>
        </li>
        <li v-if="friends.length === 0" class="empty">
          <img :src="lobbyEmptyCatToys" alt="" aria-hidden="true" />
          <span>아직 친구가 없어요.<br />친구 요청을 보내 함께 놀아보세요!</span>
        </li>
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

    <WhisperModal
      v-if="whisperTarget"
      :nickname="whisperTarget.nickname"
      :messages="whisper.messagesWith(whisperTarget.userId)"
      :connected="stompConnected"
      @close="closeWhisper"
      @send="sendWhisper"
    />
    <!-- 랭킹과 같은 모달·같은 조회 규칙. 가입일·접속시간·게임별 전적(-141)은 모달이 직접 그린다. -->
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
.friends-page {
  --lobby-border: #d9b77f;
  --lobby-text: #34251f;
  --lobby-muted: #8c7966;
  --lobby-yellow: #ffd976;
  --lobby-coral: #ef7775;
  --lobby-blue: #4f86d9;
  min-height: 100vh;
  color: var(--lobby-text);
  background-color: #fffaf0;
  background-image: radial-gradient(rgba(204, 169, 115, .24) 1px, transparent 1.5px);
  background-size: 16px 16px;
}
.friends-page :deep(.app-page) { padding-top: 14px; padding-bottom: 26px; }
.friends-page :deep(.hero) { margin-bottom: 16px; }
.friends-page :deep(.page-sticker) { display: none; }
.friends-hero {
  position: relative;
  isolation: isolate;
  min-height: 190px;
  overflow: hidden;
  padding: 25px 42px;
  border: 3px solid var(--lobby-border);
  border-radius: 20px;
  background: #bfe9ff;
  box-shadow: 4px 4px 0 #dfcdb0;
}
.friends-hero::before { content: ''; position: absolute; inset: 0; z-index: -1; opacity: .18; background-image: radial-gradient(#fff 1.2px, transparent 1.5px); background-size: 11px 11px; }
.hero-copy { position: relative; z-index: 2; max-width: 55%; }
.friends-hero h1 { margin: 8px 0 4px; color: var(--lobby-text); font-size: clamp(29px, 4vw, 40px); line-height: 1.1; letter-spacing: -.06em; }
.friends-hero p { margin: 0; color: #594941; font-size: 13px; font-weight: 700; line-height: 1.65; }
.hero-cat { position: absolute; z-index: 2; right: 4px; bottom: -42px; width: 310px; height: auto; }
.hero-cloud { position: absolute; z-index: 1; width: 100px; opacity: .9; }
.cloud-a { top: 17px; right: 215px; }
.cloud-b { top: 72px; left: 46%; width: 74px; }
.hero-grass { position: absolute; z-index: 3; right: 0; bottom: -5px; left: 0; height: 31px; background-repeat: repeat-x; background-position: bottom center; background-size: auto 31px; }
.friends-card { position: relative; box-sizing: border-box; display: flex; flex-direction: column; min-height: 410px; border: 2px dashed #dfc9a6 !important; border-radius: 12px !important; background: rgba(255, 253, 247, .78) !important; box-shadow: none !important; }
.tabs { display: flex; align-items: center; gap: 7px; margin-bottom: 14px; }
.tab-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 40px; padding: 0 12px; border: 0; border-radius: 9px; background: transparent; color: #8a735e; font-size: 11px; font-weight: 800; }
.tab-btn b { display: grid; place-items: center; min-width: 19px; height: 19px; padding: 0 4px; border-radius: 999px; background: #eadcc6; color: #745d47; font-size: 9px; line-height: 1; }
.tab-btn.on { background: var(--lobby-yellow); box-shadow: 0 3px 0 #d39a52; color: #49331e; }
.tab-btn.on b { background: #ef7775; color: #fff; }
.right-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.request-btn, .manage-btn { height: 38px; padding: 0 15px; font-size: 11px; font-weight: 800; }
.manage-btn, .request-btn { border: 2px solid #925c47 !important; border-radius: 7px !important; box-shadow: 3px 3px 0 #a66b50 !important; color: #fff !important; }
.manage-btn, .manage-btn.v-mint { background: #4078cf !important; }
.request-btn { background: #ef6d70 !important; }
.friends-card :deep(.px-btn) { border-color: #72583d; box-shadow: none; }
.friends-card :deep(.px-btn:hover:not(:disabled)) { box-shadow: 2px 2px 0 #a66b50; }
.friends-card :deep(.v-primary) { background: var(--lobby-coral); }
.friends-card :deep(.v-mint) { background: #9fc973; }

.list { display: flex; flex: 1; flex-direction: column; list-style: none; margin: 0; padding: 0; min-height: 0; }
.list li { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; padding: 11px 12px; border: 2px solid #ead4b6; border-radius: 12px; background: #fffaf0; box-shadow: 2px 2px 0 #efe0ca; }
.requests-list li:last-child { margin-bottom: 0; }
.dot { width: 9px; height: 9px; border-radius: 50%; }
.who { min-width: 0; }
.who b { display: block; color: #443127; font-size: 12px; }
.req-nick { color: #443127; font-size: 18px; }
.req-avatar {
  flex: none;
  width: 40px;
  height: 40px;
  border: 2px solid #8e714e;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #fff0b9;
  font-size: 16px;
  font-weight: 700;
}
.who small { display: block; font-size: 9px; color: var(--lobby-muted); margin-top: 3px; }
.list li > :nth-child(3) { margin-left: auto; }
.list li.clickable { cursor: pointer; }
.list li.clickable:hover { border-color: #c69459; background: #fff0c6; transform: translate(-1px, -1px); }
/* 키보드 접근용 버튼 — 보이는 모양은 원래 <b> 그대로다 */
.name-btn { display: block; padding: 0; border: 0; background: transparent; font: inherit; color: inherit; cursor: pointer; }
.friend-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.friend-actions :deep(.px-btn) { height: 32px; padding: 0 12px; border: 2px solid #925c47; border-radius: 7px; background: #ef6d70; box-shadow: 2px 2px 0 #a66b50; color: #fff; font-size: 10px; }
.presence-badge { display: flex; align-items: center; gap: 6px; color: var(--lobby-muted); font-size: 9px; }
.requests-list .req-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.req-actions :deep(.px-btn) { height: 32px; padding: 0 12px; border: 2px solid #925c47; border-radius: 7px; box-shadow: 2px 2px 0 #a66b50; color: #fff; font-size: 10px; }
.req-actions :deep(.v-mint) { background: #4078cf; }
.req-actions :deep(.v-primary) { background: #ef6d70; }
.empty { flex: 1; flex-direction: column; justify-content: center; min-height: 210px; color: var(--lobby-muted); font-size: 12px; line-height: 1.7; text-align: center; }
.empty img { width: 96px; height: auto; }

@media (max-width: 620px) {
  .friends-page :deep(.app-page) { padding: 12px 14px 24px; }
  .friends-hero { min-height: 205px; padding: 24px 22px; }
  .hero-copy { max-width: 70%; }
  .hero-cat { right: -14px; bottom: -23px; width: 240px; }
  .cloud-a { right: 135px; }
  .cloud-b { display: none; }
  .tabs { flex-wrap: wrap; }
  .right-actions { width: 100%; margin-left: 0; justify-content: flex-end; }
}
.whisper-btn { position: relative; }
.whisper-btn .unread {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 16px;
  padding: 0 4px;
  font-size: 10px;
  line-height: 16px;
  color: #fff;
  background: var(--c-danger, #dc2626);
  border-radius: 8px;
}
</style>
