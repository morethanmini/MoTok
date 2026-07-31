<script setup lang="ts">
/**
 * 친구 초대 (-100) — 대기실에서 친구 목록을 열어 이 방으로 부른다.
 *
 * 이미 방에 있는 친구는 목록에서 뺀다. 오프라인 친구는 남겨 두되 상태를 적어 준다 —
 * 초대는 5분 살아 있으므로 그 사이 들어오면 받을 수 있고, 막아 버리면 "왜 안 보이지"가 된다.
 *
 * 보낸 결과는 토스트가 아니라 줄마다 표시한다. 여러 명을 연달아 부르는 화면이라
 * 누구까지 보냈는지가 목록 위에 그대로 남아 있어야 한다.
 */
import { computed, ref } from 'vue'
import { friendsApi, invitationsApi, ApiError, type Friend } from '@/api'
import { useAsyncData } from '@/composables/useAsyncData'
import PixelModal from '@/components/common/PixelModal.vue'

const props = defineProps<{ roomId: string; memberIds: string[] }>()
defineEmits<{ close: [] }>()

const NO_FRIENDS: Friend[] = []
const { data: friends, loading } = useAsyncData(() => friendsApi.list(), NO_FRIENDS)

const invitable = computed(() =>
  friends.value.filter((f) => !props.memberIds.includes(String(f.userId))),
)

/** userId → 'sending' | 'sent'. 성공한 줄은 되돌리지 않는다(중복 발송은 서버도 409로 막는다). */
const state = ref<Record<number, 'sending' | 'sent'>>({})
const error = ref('')

function statusLabel(f: Friend) {
  if (f.presence === 'IN_ROOM') return '다른 방에서 게임 중'
  return f.presence === 'ONLINE' ? '접속 중' : '오프라인'
}

async function invite(friend: Friend) {
  if (state.value[friend.userId]) return
  state.value[friend.userId] = 'sending'
  error.value = ''
  try {
    await invitationsApi.send(props.roomId, friend.userId)
    state.value[friend.userId] = 'sent'
  } catch (e) {
    delete state.value[friend.userId]
    error.value = e instanceof ApiError ? e.message : '초대를 보내지 못했어요'
  }
}
</script>

<template>
  <PixelModal variant="lobby" @close="$emit('close')">
    <section class="invite-modal">
    <button type="button" class="invite-close" aria-label="친구 초대 닫기" @click="$emit('close')">×</button>
    <h3 class="invite-title">👋 친구 초대</h3>
    <p v-if="error" class="invite-error">{{ error }}</p>

    <p v-if="loading" class="invite-empty">친구 목록을 불러오는 중…</p>
    <p v-else-if="invitable.length === 0" class="invite-empty">
      부를 수 있는 친구가 없어요.<br />친구 목록에서 친구를 추가해 보세요!
    </p>
    <ul v-else class="invite-list">
      <li v-for="f in invitable" :key="f.userId" class="invite-row">
        <i class="dot" :class="{ off: f.presence === 'OFFLINE' }" />
        <div class="who">
          <b>{{ f.nickname }}</b>
          <small>{{ statusLabel(f) }}</small>
        </div>
        <button
          class="invite-btn"
          :class="{ done: state[f.userId] === 'sent' }"
          :disabled="!!state[f.userId]"
          @click="invite(f)"
        >
          {{ state[f.userId] === 'sent' ? '보냄 ✓' : state[f.userId] === 'sending' ? '…' : '초대' }}
        </button>
      </li>
    </ul>
    </section>
  </PixelModal>
</template>

<style scoped>
:deep(.modal.lobby) { width: 430px; padding: 24px; }
.invite-modal { position: relative; }
.invite-close { position: absolute; top: -3px; right: 0; display: grid; width: 24px; height: 24px; place-items: center; padding: 0; border: 0; background: transparent; color: #79553d; font-size: 23px; line-height: 1; }
.invite-close:hover { color: #c15d5a; }
.invite-title { margin: 0 0 14px; color: #3d2c22; font-family: var(--font-pixel); font-size: 20px; font-weight: 400; }
.invite-title::before { display: block; margin-bottom: 5px; color: #b17b51; content: 'INVITE'; font-family: inherit; font-size: 9px; letter-spacing: 1px; }
.invite-error {
  margin: 0 0 10px;
  padding: 9px 10px;
  border: 2px solid #e97872;
  border-radius: 7px;
  background: #fff1ef;
  font-size: 10px;
  color: #a3323c;
}
.invite-empty { margin: 22px 4px; font-size: 11px; line-height: 1.7; color: var(--c-muted); text-align: center; }

.invite-list { display: flex; flex-direction: column; gap: 8px; list-style: none; margin: 0; padding: 0; max-height: 260px; overflow: auto; }
.invite-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border: 2px solid #dec59e;
  border-radius: 7px;
  background: #fff7e8;
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--c-mint);
  box-shadow: 0 0 0 3px var(--c-mint-soft);
}
.dot.off { background: #b3aab3; box-shadow: 0 0 0 3px #ece6ec; }
.who { min-width: 0; }
.who b { display: block; font-size: 12px; color: #6e4938; }
.who small { display: block; margin-top: 3px; font-size: 10px; color: var(--c-muted); }
.invite-btn {
  margin-left: auto;
  border: 2px solid #9a674b;
  border-radius: 7px;
  background: #e7c996;
  padding: 7px 11px;
  color: #543a29;
  font-size: 10px;
  font-weight: 700;
  box-shadow: 3px 3px 0 #c6a47d;
}
.invite-btn:disabled { box-shadow: none; }
.invite-btn.done { border-color: #76a663; background: #dff0d0; color: #47763e; }
</style>
