<script setup lang="ts">
/**
 * 받은 방 초대 카드 (-100).
 *
 * 화면을 잠그는 모달이 아니라 오른쪽 위에 쌓이는 카드다. 초대는 내가 요청한 적 없는 인터럽트라,
 * 방을 만들던 중이거나 검색 중인 사람의 화면 전체를 막는 건 과하다. 여러 명이 동시에 부를 수도 있는데
 * 모달은 그걸 쌓지 못한다.
 *
 * 만료된 초대는 스스로 걷어낸다 — 폴링 주기(12초) 안에서는 이미 죽은 초대를 잠깐 들고 있게 되는데,
 * 그 카드의 수락을 누르면 입장에 실패한다. 서버 응답을 기다리지 않고 화면에서 먼저 지운다.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import type { InvitationItem } from '@/api'

const props = defineProps<{ invitations: InvitationItem[] }>()
defineEmits<{ accept: [InvitationItem]; reject: [InvitationItem] }>()

/** 만료 판정용 현재 시각. 카드가 떠 있는 동안만 1초마다 재평가한다. */
const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(timer))

const alive = computed(() =>
  props.invitations.filter((i) => new Date(i.expiresAt).getTime() > now.value),
)

/** 남은 시간(초). 초대가 곧 사라진다는 걸 눌러 보기 전에 알 수 있어야 한다. */
function remainingSec(invitation: InvitationItem) {
  return Math.max(0, Math.ceil((new Date(invitation.expiresAt).getTime() - now.value) / 1000))
}
</script>

<template>
  <div v-if="alive.length" class="invite-stack">
    <article v-for="i in alive" :key="i.invitationId" class="invite-card">
      <div class="invite-head">
        <span class="invite-tag">방 초대</span>
        <span class="invite-left">{{ remainingSec(i) }}초</span>
      </div>
      <p class="invite-body">
        <b>{{ i.fromNickname }}</b
        >님이 초대했어요<br />
        <span class="invite-room">{{ i.roomTitle }}</span>
      </p>
      <div class="invite-actions">
        <button class="reject" @click="$emit('reject', i)">거절</button>
        <button class="accept" @click="$emit('accept', i)">참가</button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.invite-stack {
  position: fixed;
  top: 96px;
  right: 20px;
  z-index: 250;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 236px;
}
.invite-card {
  border: var(--border);
  border-radius: 16px 16px 12px 16px;
  background: #fff;
  box-shadow: var(--shadow-lg);
  padding: 12px 13px;
  animation: px-pop 0.16s ease;
}
.invite-head { display: flex; align-items: center; margin-bottom: 8px; }
.invite-tag {
  padding: 3px 7px;
  border: 2px solid var(--c-ink);
  border-radius: 999px;
  background: var(--c-yellow);
  font-size: 8px;
  font-weight: 700;
}
.invite-left { margin-left: auto; font-size: 8px; color: var(--c-muted); }
.invite-body { margin: 0 0 11px; font-size: 10px; line-height: 1.65; }
.invite-room {
  display: block;
  margin-top: 3px;
  font-size: 9px;
  color: var(--c-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.invite-actions { display: flex; gap: 7px; }
.invite-actions button {
  flex: 1;
  height: 30px;
  border: 2px solid var(--c-ink);
  border-radius: 9px;
  font-size: 9px;
  font-weight: 700;
  box-shadow: var(--shadow-sm);
}
.invite-actions .reject { background: #fff; }
.invite-actions .accept { background: var(--c-mint); }
</style>
