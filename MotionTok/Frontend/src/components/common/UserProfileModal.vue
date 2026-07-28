<script setup lang="ts">
/**
 * 다른 사용자의 공개 프로필(-96) + 친구 상세(-141). 랭킹·친구 목록 등 여러 화면에서 함께 쓴다.
 *
 * 서버는 닉네임·가입일·총 접속시간·프로필 사진을 내려준다(이메일·포인트는 비공개).
 * 가입일·총 접속시간은 어느 화면에서 열어도 의미가 같으므로 이 모달이 직접 히어로로 크게 그린다.
 * 화면마다 덧붙이고 싶은 수치는 다르므로(랭킹은 순위·점수·플레이) 그건 stats로 받는다 —
 * 여기서 리더보드 타입을 직접 알면 친구 목록에서는 쓸 수 없는 컴포넌트가 된다.
 *
 * 게임별 전적(-141)은 신고(-112)처럼 모달이 직접 들고 있다 — 여는 화면(로비·친구·랭킹)마다
 * 같은 배선을 반복하지 않기 위해서다. 펼칠 때에야 불러온다 — 프로필만 훑는 경우가 대부분이라.
 */
import { computed, ref } from 'vue'
import PixelModal from './PixelModal.vue'
import PixelButton from './PixelButton.vue'
import UserAvatar from './UserAvatar.vue'
import ReportDialog from '@/features/report/ReportDialog.vue'
import { useSessionStore } from '@/stores/session'
import { ApiError, usersApi, type GameRecord, type PublicUserProfile } from '@/api'

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

/** 총 접속시간 — 초를 사람이 읽는 단위로. 집계 시작(배포) 전 가입자는 0이라 '1분 미만'이 뜬다. */
const connectTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}시간 ${minutes}분`
  if (minutes > 0) return `${minutes}분`
  return '1분 미만'
}

// ── 게임별 전적 (-141) ──────────────────────────────
// 모달은 열 때마다 v-if로 새로 마운트되므로(닫으면 targetId가 null) 상태가 대상 간에 새지 않는다.
const showRecords = ref(false)
const records = ref<GameRecord[] | null>(null) // null = 아직 안 불러옴
const recordsLoading = ref(false)
const recordsError = ref('')
const selectedGameId = ref<number | null>(null)

async function toggleRecords() {
  showRecords.value = !showRecords.value
  if (showRecords.value && records.value === null && !recordsLoading.value) {
    await loadRecords()
  }
}

async function loadRecords() {
  recordsLoading.value = true
  recordsError.value = ''
  try {
    records.value = await usersApi.getRecordsOf(props.userId)
    selectedGameId.value = records.value[0]?.gameId ?? null
  } catch (e) {
    recordsError.value = e instanceof ApiError ? e.message : '전적을 불러오지 못했어요.'
  } finally {
    recordsLoading.value = false
  }
}

/** 게임 칩 목록 — 같은 게임의 멀티/싱글 행을 하나로 묶는다(서버가 게임 순으로 내려줌). */
const recordGames = computed(() => {
  const seen = new Map<number, string>()
  for (const r of records.value ?? []) {
    if (!seen.has(r.gameId)) seen.set(r.gameId, r.gameName)
  }
  return [...seen].map(([gameId, gameName]) => ({ gameId, gameName }))
})

const selectedGameRecords = computed(
  () => records.value?.filter((r) => r.gameId === selectedGameId.value) ?? [],
)

const modeLabel = (mode?: string) => (mode === 'SOLO' ? '싱글' : '멀티')

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

      <!-- 가입일·총 접속시간 — 어느 화면에서 열어도 같은 의미라 모달이 직접 크게 그린다(-141) -->
      <dl v-else-if="profile" class="hero">
        <div>
          <dt>가입일</dt>
          <dd>{{ joinedAt(profile.createdAt) }}</dd>
        </div>
        <div>
          <dt>총 접속시간</dt>
          <dd>{{ connectTime(profile.totalConnectSeconds) }}</dd>
        </div>
      </dl>

      <dl v-if="stats.length" class="stats">
        <div v-for="s in stats" :key="s.label"><dt>{{ s.label }}</dt><dd>{{ s.value }}</dd></div>
      </dl>

      <!-- 게임별 전적(-141) — 펼칠 때에야 불러온다 -->
      <section v-if="profile" class="records">
        <button type="button" class="records-toggle" :aria-expanded="showRecords" @click="toggleRecords">
          게임별 전적 <span aria-hidden="true">{{ showRecords ? '▲' : '▼' }}</span>
        </button>
        <div v-if="showRecords" class="records-body">
          <p v-if="recordsLoading" class="state">불러오는 중…</p>
          <p v-else-if="recordsError" class="state err">{{ recordsError }}</p>
          <p v-else-if="!recordGames.length" class="state">아직 게임 기록이 없어요.</p>
          <template v-else>
            <div class="chips">
              <button
                v-for="g in recordGames"
                :key="g.gameId"
                type="button"
                class="chip"
                :class="{ on: selectedGameId === g.gameId }"
                @click="selectedGameId = g.gameId"
              >
                {{ g.gameName }}
              </button>
            </div>
            <div v-for="r in selectedGameRecords" :key="r.mode ?? 'MULTI'" class="record-row">
              <span class="mode-tag" :class="{ solo: r.mode === 'SOLO' }">{{ modeLabel(r.mode) }}</span>
              <dl class="record-stats">
                <div><dt>순위</dt><dd>#{{ r.rankNo }}</dd></div>
                <div><dt>최고 점수</dt><dd>{{ r.bestScore.toLocaleString() }}</dd></div>
                <div><dt>플레이</dt><dd>{{ r.playCount }}회</dd></div>
              </dl>
            </div>
          </template>
        </div>
      </section>

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
h3 { margin: 0 0 10px; font-size: 16px; }
.state { margin: 0 0 12px; font-size: 10px; color: var(--c-muted); }
.state.err { color: var(--c-coral); }

/* 가입일·총 접속시간 히어로 — 화면별 stats보다 한 단계 크게, 메인 정보로 */
.hero { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 8px; margin: 0 0 14px; }
.hero > div {
  padding: 12px 8px;
  border: 2px solid var(--c-ink); border-radius: 12px;
  background: var(--c-mint-soft); box-shadow: 2px 2px 0 #d8c9d8;
}
.hero dt { font-size: 8px; color: var(--c-muted); }
.hero dd { margin: 6px 0 0; font-size: 15px; font-weight: 700; color: var(--c-blue); }

.stats { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 8px; margin: 0 0 14px; }
.stats > div {
  padding: 10px 6px;
  border: 2px solid var(--c-ink); border-radius: 12px; background: #fff;
}
.stats dt { font-size: 8px; color: var(--c-muted); }
.stats dd { margin: 5px 0 0; font-size: 13px; font-weight: 700; color: var(--c-blue); }

/* 게임별 전적(-141) — 접기/펼치기 */
.records { margin: 0 0 16px; text-align: left; }
.records-toggle {
  width: 100%; padding: 9px 12px;
  display: flex; align-items: center; justify-content: space-between;
  border: 2px solid var(--c-ink); border-radius: 12px; background: #fff;
  font: inherit; font-size: 11px; font-weight: 700;
  box-shadow: 2px 2px 0 #d8c9d8; cursor: pointer;
}
.records-toggle:active { transform: translate(2px, 2px); box-shadow: none; }
.records-body { margin-top: 10px; }
.records-body .state { margin: 4px 0; text-align: center; }

/* 게임 칩 — 랭킹 화면과 같은 어휘, 모달 폭에 맞춰 작게 */
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.chip {
  border: 2px solid var(--c-ink); background: #fff; border-radius: 999px;
  padding: 5px 10px; font-size: 9px; box-shadow: 2px 2px 0 #d8c9d8; cursor: pointer;
}
.chip.on { background: var(--c-yellow); box-shadow: none; font-weight: 700; }

/* 모드별 기록 한 줄 — 같은 게임의 멀티/싱글이 각각 온다 */
.record-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.mode-tag {
  flex: none; padding: 4px 8px;
  border: 2px solid var(--c-ink); border-radius: 999px;
  background: var(--c-mint); color: #fff; font-size: 8px; font-weight: 700;
}
.mode-tag.solo { background: var(--c-blue); }
.record-stats { flex: 1; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; margin: 0; }
.record-stats > div {
  padding: 7px 4px; text-align: center;
  border: 2px solid var(--c-ink); border-radius: 10px; background: #fff;
}
.record-stats dt { font-size: 7px; color: var(--c-muted); }
.record-stats dd { margin: 3px 0 0; font-size: 11px; font-weight: 700; color: var(--c-blue); }

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
