<script setup lang="ts">
/**
 * 다른 사용자의 공개 프로필(-96) + 친구 상세(-141). 랭킹·친구 목록 등 여러 화면에서 함께 쓴다.
 *
 * 레이아웃은 열리는 순간부터 끝까지 크기가 변하지 않는다 — 로딩·빈 전적·오류 전부
 * 미리 확보한 같은 상자 안에서만 갈아끼운다. 내용에 따라 모달이 늘었다 줄었다 하면
 * 시선이 계속 끌려다니기 때문.
 *
 * 게임 선택은 카탈로그 썸네일 타일로 한다(랭킹 칩과 같은 노랑 선택 문법).
 * 전적은 멀티 기록을 보여주고 멀티가 없을 때만 싱글 기록을 쓴다 — 모드 문구는 화면에 내지 않는다.
 *
 * 신고(-112)는 모달이 직접 들고 있되(진입점마다 배선 반복 방지) 하단의 작은 텍스트로 숨긴다 —
 * 모서리의 눈에 띄는 자리는 닫기(X)의 것이다.
 */
import { computed, onMounted, ref } from 'vue'
import PixelModal from './PixelModal.vue'
import PixelButton from './PixelButton.vue'
import UserAvatar from './UserAvatar.vue'
import ReportDialog from '@/features/report/ReportDialog.vue'
import { useSessionStore } from '@/stores/session'
import { ApiError, gamesApi, usersApi, type Game, type GameRecord, type PublicUserProfile } from '@/api'

const props = defineProps<{
  /** 조회 대상. 조회에 실패해도 신고는 할 수 있어야 하므로 profile과 별개로 받는다 */
  userId: number
  /** 조회 결과. 로딩 중이거나 실패하면 null */
  profile: PublicUserProfile | null
  /** 조회 전·실패 시에도 이름은 보여준다(목록에 이미 떠 있던 값) */
  nickname: string
  loading: boolean
  error: string
}>()

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

// ── 게임별 전적 (-141) — 열리자마자 불러와 고정 상자 안에 그린다 ──────────
// 모달은 v-if로 열 때마다 새로 마운트되므로(닫으면 targetId가 null) 상태가 대상 간에 새지 않는다.
const records = ref<GameRecord[] | null>(null)
const recordsError = ref('')
const selectedGameId = ref<number | null>(null)

/** 게임 카탈로그(썸네일) — 정적이라 모듈 수명 동안 1회만 부른다. */
let gamesCache: Promise<Game[]> | null = null
const games = ref<Game[]>([])

onMounted(async () => {
  gamesCache ??= gamesApi.list().catch(() => {
    gamesCache = null // 실패는 캐시하지 않는다 — 다음 모달이 재시도
    return [] as Game[]
  })
  games.value = await gamesCache

  try {
    records.value = await usersApi.getRecordsOf(props.userId)
    selectedGameId.value = records.value[0]?.gameId ?? null
  } catch (e) {
    records.value = []
    recordsError.value = e instanceof ApiError ? e.message : '전적을 불러오지 못했어요.'
  }
})

const recordsLoading = computed(() => records.value === null)

/** 기록이 있는 게임 타일 목록 — 같은 게임의 멀티/싱글 행을 하나로 묶는다(서버가 게임 순으로 내려줌). */
const recordGames = computed(() => {
  const thumbs = new Map(games.value.map((g) => [g.id, g.thumbnailUrl]))
  const seen = new Map<number, { gameId: number; gameName: string; thumbnailUrl: string }>()
  for (const r of records.value ?? []) {
    if (!seen.has(r.gameId)) {
      seen.set(r.gameId, { gameId: r.gameId, gameName: r.gameName, thumbnailUrl: thumbs.get(r.gameId) ?? '' })
    }
  }
  return [...seen.values()]
})

const selectedGame = computed(() => recordGames.value.find((g) => g.gameId === selectedGameId.value) ?? null)

/** 화면에 내는 기록 한 줄 — 멀티 우선, 멀티가 없으면 싱글. 모드 문구는 내지 않는다. */
const selectedRecord = computed(() => {
  const rows = records.value?.filter((r) => r.gameId === selectedGameId.value) ?? []
  return rows.find((r) => r.mode !== 'SOLO') ?? rows[0] ?? null
})

/**
 * 신고(-112) — 내 프로필에는 숨긴다. 서버도 자기 신고를 400으로 막지만(USER_REPORT_SELF),
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
      <!-- 모서리의 눈에 띄는 자리는 닫기의 것 (AvatarPickerModal과 같은 자리 규칙) -->
      <button type="button" class="close" title="닫기" aria-label="닫기" @click="emit('close')">✕</button>

      <UserAvatar class="avatar" :src="profile?.avatarUrl" :alt="`${nickname} 프로필 사진`" />
      <h3>{{ nickname }}</h3>
      <!-- 상태 줄 — 항상 같은 높이를 차지해 아래 내용이 밀리지 않는다 -->
      <p class="state" :class="{ err: error }">{{ loading ? '불러오는 중…' : error }}</p>

      <!-- 가입일 · 총 접속시간 — 히어로. 로딩·실패여도 카드 크기는 그대로 -->
      <dl class="hero">
        <div>
          <dt>가입일</dt>
          <dd>{{ profile ? joinedAt(profile.createdAt) : '—' }}</dd>
        </div>
        <div>
          <dt>총 접속시간</dt>
          <dd>{{ profile ? connectTime(profile.totalConnectSeconds) : '—' }}</dd>
        </div>
      </dl>

      <!-- 게임별 전적 — 처음부터 자리를 확보해 둔 고정 상자 -->
      <section class="records" aria-label="게임별 전적">
        <span class="records-title">게임별 전적</span>
        <p v-if="recordsLoading" class="records-state">불러오는 중…</p>
        <p v-else-if="recordsError" class="records-state err">{{ recordsError }}</p>
        <p v-else-if="!recordGames.length" class="records-state">아직 게임 기록이 없어요.</p>
        <template v-else>
          <div class="tiles" role="tablist" aria-label="게임 선택">
            <button
              v-for="g in recordGames"
              :key="g.gameId"
              type="button"
              class="tile"
              :class="{ on: selectedGameId === g.gameId }"
              :title="g.gameName"
              :aria-label="g.gameName"
              @click="selectedGameId = g.gameId"
            >
              <img v-if="g.thumbnailUrl" :src="g.thumbnailUrl" alt="" />
              <span v-else>{{ g.gameName.charAt(0) }}</span>
            </button>
          </div>
          <p class="game-name">{{ selectedGame?.gameName }}</p>
          <dl v-if="selectedRecord" class="stats">
            <div><dt>순위</dt><dd>#{{ selectedRecord.rankNo }}</dd></div>
            <div><dt>최고 점수</dt><dd>{{ selectedRecord.bestScore.toLocaleString() }}</dd></div>
            <div><dt>플레이</dt><dd>{{ selectedRecord.playCount }}회</dd></div>
          </dl>
        </template>
      </section>

      <PixelButton variant="primary" block @click="emit('close')">닫기</PixelButton>

      <!-- 신고는 숨겨진 작은 글씨로 — 실수로 누르는 버튼이 아니라 찾아서 누르는 버튼 -->
      <button v-if="showReport" type="button" class="report-link" @click="reporting = true">
        이 사용자 신고하기
      </button>
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
.up { position: relative; text-align: center; }

/* 닫기 — 모달 모서리(AvatarPickerModal의 close와 같은 자리·같은 모양) */
.close {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 30px;
  height: 30px;
  border: 2px solid var(--c-ink);
  border-radius: 9px;
  background: #fff;
  box-shadow: 2px 2px 0 var(--c-ink);
  font-size: 12px;
  cursor: pointer;
}
.close:active { transform: translate(2px, 2px); box-shadow: none; }

.avatar {
  width: 64px; height: 64px; margin: 0 auto 8px;
  border: var(--border); border-radius: 50%;
  background: var(--c-mint-soft); font-size: 30px;
}
h3 { margin: 0; font-size: 16px; }

/* 상태 줄 — 빈 내용이어도 높이를 차지해 레이아웃이 안 흔들린다 */
.state { height: 14px; margin: 2px 0 8px; font-size: 10px; color: var(--c-muted); }
.state.err { color: var(--c-coral); }

/* 히어로 — 메인 정보 2장. 랭킹 칩과 같은 노랑으로 컨셉을 맞춘다 */
.hero { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 8px; margin: 0 0 10px; }
.hero > div {
  height: 58px;
  padding: 9px 8px 0;
  border: 2px solid var(--c-ink); border-radius: 12px;
  background: var(--c-yellow); box-shadow: var(--shadow-sm);
}
.hero dt { font-size: 8px; color: var(--c-ink); opacity: 0.6; }
.hero dd { margin: 5px 0 0; font-size: 15px; font-weight: 700; color: var(--c-ink); }

/* 게임별 전적 — 처음부터 확보된 고정 높이 상자. 내용은 이 안에서만 바뀐다 */
.records {
  position: relative;
  height: 158px;
  margin: 0 0 14px;
  padding: 24px 10px 10px;
  border: 2px solid var(--c-ink);
  border-radius: 12px;
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow: hidden;
}
.records-title {
  position: absolute; top: 7px; left: 12px;
  font-size: 8px; font-weight: 700; color: var(--c-muted); letter-spacing: 0.06em;
}
.records-state { margin: auto 0; font-size: 10px; color: var(--c-muted); }
.records-state.err { color: var(--c-coral); }

/* 게임 선택 타일 — 카탈로그 썸네일. 선택은 랭킹 칩과 같은 노랑 문법 */
.tiles { display: flex; gap: 8px; max-width: 100%; overflow-x: auto; padding: 2px; }
.tile {
  flex: none;
  width: 44px; height: 44px;
  padding: 0;
  border: 2px solid var(--c-ink);
  border-radius: 10px;
  background: var(--c-mint-soft);
  box-shadow: 2px 2px 0 #d8c9d8;
  overflow: hidden;
  cursor: pointer;
  display: grid;
  place-items: center;
  font-size: 15px;
  font-weight: 700;
  color: var(--c-ink);
}
.tile img { width: 100%; height: 100%; object-fit: cover; display: block; image-rendering: pixelated; }
.tile.on { background: var(--c-yellow); box-shadow: var(--shadow-sm); transform: translate(1px, 1px); }
.tile:hover:not(.on) { background: #fff; }

.game-name { margin: 7px 0 5px; font-size: 11px; font-weight: 700; }

.stats { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; width: 100%; margin: 0; }
.stats > div {
  padding: 6px 4px;
  border: 2px solid var(--c-ink); border-radius: 10px; background: var(--c-mint-soft);
}
.stats dt { font-size: 7px; color: var(--c-muted); }
.stats dd { margin: 3px 0 0; font-size: 12px; font-weight: 700; color: var(--c-blue); }

/* 신고 — 찾아서 누르는 작은 글씨. 눈에 띄는 자리를 주지 않는다 */
.report-link {
  margin-top: 10px;
  border: 0; background: transparent; padding: 0;
  font-size: 8px; color: var(--c-muted); text-decoration: underline; cursor: pointer;
}
.report-link:hover { color: var(--c-coral); }
</style>
