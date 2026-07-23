<script setup lang="ts">
/**
 * 랭킹에서 고른 사용자의 공개 프로필 (-96).
 * 서버는 닉네임·가입일만 내려준다(이메일·포인트는 비공개). 점수·플레이 횟수는 리더보드 항목에서 그대로 받아 쓴다.
 */
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import type { LeaderboardEntry, PublicUserProfile } from '@/api'

const props = defineProps<{
  entry: LeaderboardEntry
  profile: PublicUserProfile | null
  loading: boolean
  error: string
}>()
defineEmits<{ close: [] }>()

const joinedAt = (iso: string) => iso.slice(0, 10).replace(/-/g, '.')
</script>

<template>
  <PixelModal @close="$emit('close')">
    <div class="up">
      <div class="avatar">😎</div>
      <h3>{{ props.profile?.nickname ?? props.entry.nickname }}</h3>
      <p v-if="props.loading" class="state">불러오는 중…</p>
      <p v-else-if="props.error" class="state err">{{ props.error }}</p>
      <p v-else-if="props.profile" class="joined">가입일 {{ joinedAt(props.profile.createdAt) }}</p>

      <dl class="stats">
        <div><dt>순위</dt><dd>#{{ props.entry.rank }}</dd></div>
        <div><dt>최고 점수</dt><dd>{{ props.entry.bestScore.toLocaleString() }}</dd></div>
        <div><dt>플레이</dt><dd>{{ props.entry.playCount }}회</dd></div>
      </dl>

      <PixelButton variant="primary" block @click="$emit('close')">닫기</PixelButton>
    </div>
  </PixelModal>
</template>

<style scoped>
.up { text-align: center; }
.avatar {
  width: 64px; height: 64px; margin: 0 auto 10px;
  display: grid; place-items: center;
  border: var(--border); border-radius: 50%;
  background: var(--c-mint-soft); font-size: 30px;
}
h3 { margin: 0 0 6px; font-size: 16px; }
.state { margin: 0 0 12px; font-size: 10px; color: var(--c-muted); }
.state.err { color: var(--c-coral); }
.joined { margin: 0 0 14px; font-size: 10px; color: var(--c-muted); }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0 0 18px; }
.stats > div {
  padding: 10px 6px;
  border: 2px solid var(--c-ink); border-radius: 12px; background: #fff;
}
.stats dt { font-size: 8px; color: var(--c-muted); }
.stats dd { margin: 5px 0 0; font-size: 13px; font-weight: 700; color: var(--c-blue); }
</style>
