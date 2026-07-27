/**
 * 다른 사용자의 공개 프로필 조회(-96) — 랭킹·친구 목록에서 공용으로 쓴다.
 *
 * 화면마다 조회 상태(로딩·오류·대상)를 따로 들고 있으면 "게스트는 로그인 유도", "탈퇴 계정은
 * 404 전용 문구" 같은 규칙이 화면 수만큼 복제된다. 조회는 여기서 한 번만 정의하고
 * 화면은 언제 열지만 정한다.
 *
 * 사용 예)
 *   const viewer = useUserProfile()
 *   viewer.open(friend.userId, friend.nickname)
 *   <UserProfileModal v-if="viewer.isOpen.value" ... @close="viewer.close()" />
 */
import { computed, ref } from 'vue'
import { ApiError, usersApi, type PublicUserProfile } from '@/api'
import { useSessionStore } from '@/stores/session'
import { askLogin } from '@/composables/useLoginRequired'

export function useUserProfile() {
  const session = useSessionStore()

  const targetId = ref<number | null>(null)
  /** 조회 전에도 이름은 보여줄 수 있게 호출부가 아는 닉네임을 받아 둔다(목록에 이미 떠 있는 값). */
  const fallbackNickname = ref('')
  const profile = ref<PublicUserProfile | null>(null)
  const loading = ref(false)
  const error = ref('')

  const isOpen = computed(() => targetId.value !== null)
  const nickname = computed(() => profile.value?.nickname ?? fallbackNickname.value)

  async function open(userId: number, knownNickname = '') {
    // 공개 프로필도 회원 전용이다(SecurityConfig /api/users/**) — 게스트·비로그인은 로그인으로 유도한다.
    if (!session.isMember) {
      askLogin('다른 사용자의 프로필은 로그인 후 볼 수 있어요.')
      return
    }
    targetId.value = userId
    fallbackNickname.value = knownNickname
    profile.value = null
    error.value = ''
    loading.value = true
    try {
      profile.value = await usersApi.getProfile(userId)
    } catch (e) {
      error.value = toMessage(e)
    } finally {
      loading.value = false
    }
  }

  function close() {
    targetId.value = null
  }

  return { targetId, profile, loading, error, isOpen, nickname, open, close }
}

function toMessage(e: unknown): string {
  if (e instanceof ApiError) {
    // 404는 "없는 사용자"가 아니라 탈퇴·정지 계정인 경우가 대부분이라 따로 안내한다.
    return e.status === 404 ? '탈퇴했거나 조회할 수 없는 계정이에요.' : e.message
  }
  return '프로필을 불러오지 못했어요.'
}
