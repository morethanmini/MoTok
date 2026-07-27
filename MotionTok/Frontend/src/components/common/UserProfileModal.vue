<script setup lang="ts">
/**
 * 다른 사용자의 공개 프로필(-96). 랭킹·친구 목록 등 여러 화면에서 함께 쓴다.
 *
 * 서버는 닉네임·가입일·프로필 사진만 내려준다(이메일·포인트는 비공개).
 * 화면마다 덧붙이고 싶은 수치는 다르므로(랭킹은 순위·점수·플레이) 그건 stats로 받는다 —
 * 여기서 리더보드 타입을 직접 알면 친구 목록에서는 쓸 수 없는 컴포넌트가 된다.
 */
import { computed, ref } from 'vue'
import PixelModal from './PixelModal.vue'
import PixelButton from './PixelButton.vue'
import UserAvatar from './UserAvatar.vue'
import ReportDialog from '@/features/report/ReportDialog.vue'
import { useSessionStore } from '@/stores/session'
import type { PublicUserProfile } from '@/api'

const props = withDefaults(
  defineProps<{
    /** 조회 대상. 조회에 실패해도 신고는 할 수 있어야 하므로 profile과 별개로 받는다 */
    userId: number
    /** 조회 결과. 로딩 중이거나 실패하면 null */
    profile: PublicUserProfile | null
    /** 조회 전·실패 시에도 이름은 보여준다(목록에 이미 떠 있던 값) */
    nickname: string
    loading: boolean
    error: string
    /** 화면별 추가 수치. 예) 랭킹의 순위·최고 점수·플레이 */
    stats?: { label: string; value: string }[]
  }>(),
  { stats: () => [] },
)

const emit = defineEmits<{ close: []; reported: [message: string] }>()

const joinedAt = (iso: string) => iso.slice(0, 10).replace(/-/g, '.')

/**
 * 신고(-112)는 이 모달이 직접 들고 있다 — 여는 화면(랭킹·친구 목록)마다 같은 배선을 반복하지 않기 위해서다.
 * 내 프로필에는 버튼을 감춘다. 서버도 자기 신고를 400으로 막지만(USER_REPORT_SELF),
 * 누를 수 있는 버튼을 두고 눌린 뒤에 막는 건 화면의 몫이 아니다.
 */
const session = useSessionStore()
const showReport = computed(() => session.isMember && session.profile?.id !== props.userId)
const reporting = ref(false)

function onReported() {
  emit('reported', `${props.nickname}님을 신고했어요. 검토 후 조치할게요.`)
  emit('close') // 신고를 마쳤으면 프로필까지 닫는다 — 다시 볼 이유가 없다
}
</script>

<template>
  <PixelModal @close="$emit('close')">
    <div class="up">
      <UserAvatar class="avatar" :src="profile?.avatarUrl" :alt="`${nickname} 프로필 사진`" />
      <h3>{{ nickname }}</h3>
      <p v-if="loading" class="state">불러오는 중…</p>
      <p v-else-if="error" class="state err">{{ error }}</p>
      <p v-else-if="profile" class="joined">가입일 {{ joinedAt(profile.createdAt) }}</p>

      <dl v-if="stats.length" class="stats">
        <div v-for="s in stats" :key="s.label"><dt>{{ s.label }}</dt><dd>{{ s.value }}</dd></div>
      </dl>

      <!-- 아이콘만 두므로 title·aria-label로 무슨 버튼인지 남긴다 -->
      <button
        v-if="showReport"
        type="button"
        class="report"
        title="신고"
        aria-label="이 사용자 신고"
        @click="reporting = true"
      >
        <img src="/assets/icons/report.png" alt="" />
      </button>

      <PixelButton variant="primary" block @click="emit('close')">닫기</PixelButton>
    </div>

    <!-- 신고 창은 게임룸에서도 쓰는 기존 컴포넌트를 그대로 재사용한다 -->
    <ReportDialog
      v-if="reporting"
      :reported-user-id="userId"
      :reported-nickname="nickname"
      @close="reporting = false"
      @done="onReported"
    />
  </PixelModal>
</template>

<style scoped>
/* 신고 버튼이 이 상자를 기준으로 우측 상단에 붙는다 */
.up { position: relative; text-align: center; }
.avatar {
  width: 64px; height: 64px; margin: 0 auto 10px;
  border: var(--border); border-radius: 50%;
  background: var(--c-mint-soft); font-size: 30px;
}
h3 { margin: 0 0 6px; font-size: 16px; }
.state { margin: 0 0 12px; font-size: 10px; color: var(--c-muted); }
.state.err { color: var(--c-coral); }
.joined { margin: 0 0 14px; font-size: 10px; color: var(--c-muted); }
.stats { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 8px; margin: 0 0 18px; }
.stats > div {
  padding: 10px 6px;
  border: 2px solid var(--c-ink); border-radius: 12px; background: #fff;
}
.stats dt { font-size: 8px; color: var(--c-muted); }
.stats dd { margin: 5px 0 0; font-size: 13px; font-weight: 700; color: var(--c-blue); }

/*
 * 신고 — 프로필 상자 우측 상단. 모달 안쪽 여백(24px)만큼 바깥으로 빼서 모서리에 걸치게 둔다
 * (AvatarPickerModal의 닫기 버튼과 같은 자리 규칙).
 */
.report {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  padding: 5px;
  border: 2px solid var(--c-ink);
  border-radius: 9px;
  background: #fff;
  box-shadow: 2px 2px 0 var(--c-ink);
  cursor: pointer;
}
.report img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  /* 도트 아이콘이라 부드럽게 줄이면 뭉개진다 */
  image-rendering: pixelated;
}
.report:hover { background: #ffe9e9; }
.report:active { transform: translate(2px, 2px); box-shadow: none; }
</style>
