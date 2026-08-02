<script setup lang="ts">
/**
 * 받은 친구 요청 카드 (-57).
 *
 * 방 초대 카드(InviteCardStack)와 같은 자리·같은 모양이다 — 둘 다 내가 요청한 적 없는
 * 인터럽트라 화면을 잠그지 않고 오른쪽 위에 쌓는다. 다만 친구 요청은 <b>만료가 없다</b>:
 * 남은 시간 대신 닫기(×)를 둔다. 닫아도 요청은 서버에 그대로 남아 배지에 계속 잡힌다.
 *
 * 초대 카드와 합치지 않은 이유 — 초대는 만료 카운트다운이 본질이고 친구 요청은 그게 없다.
 * 한 컴포넌트에 두 종류를 넣으면 분기가 카드 구석구석에 퍼진다.
 */
import type { FriendRequestItem } from '@/api'

defineProps<{ requests: FriendRequestItem[]; busyId: number | null }>()
defineEmits<{
  accept: [FriendRequestItem]
  reject: [FriendRequestItem]
  /** 이번엔 넘어간다 — 요청은 남고 이 카드만 사라진다. */
  dismiss: [FriendRequestItem]
}>()
</script>

<template>
  <div v-if="requests.length" class="req-stack">
    <article v-for="r in requests" :key="r.requestId" class="req-card">
      <div class="req-head">
        <span class="req-tag">친구 요청</span>
        <button class="req-close" type="button" aria-label="나중에" @click="$emit('dismiss', r)">
          ×
        </button>
      </div>
      <p class="req-body">
        <b>{{ r.requesterNickname }}</b
        >님이 친구가 되고 싶어 해요
      </p>
      <div class="req-actions">
        <button class="reject" :disabled="busyId === r.requestId" @click="$emit('reject', r)">
          거절
        </button>
        <button class="accept" :disabled="busyId === r.requestId" @click="$emit('accept', r)">
          수락
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
/* 초대 카드(top 96px)와 같은 열에 두되 아래로 흘린다 — 둘 다 떠 있어도 겹치지 않게. */
.req-stack {
  position: fixed;
  top: 96px;
  right: 20px;
  z-index: 249;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  width: 236px;
  pointer-events: none;
}
.req-card {
  width: 100%;
  padding: 12px 13px;
  border: var(--border);
  border-radius: 16px 16px 12px 16px;
  background: #fff;
  box-shadow: var(--shadow-lg);
  animation: px-pop 0.16s ease;
  pointer-events: auto;
}
.req-head {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
.req-tag {
  padding: 3px 7px;
  border: 2px solid var(--c-ink);
  border-radius: 999px;
  background: var(--c-mint-soft);
  font-size: 8px;
  font-weight: 700;
}
.req-close {
  margin-left: auto;
  width: 20px;
  height: 20px;
  border: 0;
  background: transparent;
  color: var(--c-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.req-close:hover {
  color: var(--c-ink);
}
.req-body {
  margin: 0 0 11px;
  font-size: 10px;
  line-height: 1.65;
  word-break: break-all;
}
.req-actions {
  display: flex;
  gap: 7px;
}
.req-actions button {
  flex: 1;
  height: 30px;
  border: 2px solid var(--c-ink);
  border-radius: 9px;
  box-shadow: var(--shadow-sm);
  font-size: 9px;
  font-weight: 700;
}
.req-actions button:disabled {
  opacity: 0.5;
}
.req-actions .reject {
  background: #fff;
}
.req-actions .accept {
  background: var(--c-mint);
}
</style>
