/**
 * 소셜 인가(authorize) 리다이렉트 공통 처리.
 *
 * 로그인만 쓰던 흐름을 탈퇴 재인증(-111)도 함께 쓰게 되면서, 인가 URL 조립과 콜백 규약을 한 곳에 모은다.
 * 리다이렉트 URI는 provider 콘솔에 등록된 값이어야 하므로 어떤 용도든 항상 /auth 하나만 쓰고,
 * "왜 인가를 받으러 갔는지"는 sessionStorage의 intent로 구분해 콜백에서 분기한다.
 */
export type SocialProviderId = 'google' | 'kakao'

/** 인가 후 돌아올 곳 — provider 콘솔에 등록된 유일한 리다이렉트 URI. */
export const SOCIAL_REDIRECT_URI = `${window.location.origin}/auth`

const PROVIDER_KEY = 'social_provider'
const INTENT_KEY = 'motok.socialIntent'
/** 탈퇴 재인증으로 받아 온 인가 코드 — URL 히스토리에 남기지 않으려고 sessionStorage로 넘긴다. */
const WITHDRAW_PROOF_KEY = 'motok.withdrawProof'

/** client_id(구글)·REST 키(카카오)는 authorize URL에 노출되는 공개값이라 VITE_ 환경변수로 둔다. */
const CLIENT_IDS: Record<SocialProviderId, string> = {
  kakao: import.meta.env.VITE_KAKAO_REST_KEY ?? '',
  google: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
}

/** 해당 provider가 환경변수로 설정돼 있는지 — 버튼 비활성화 판단용. */
export function isSocialConfigured(provider: SocialProviderId): boolean {
  return CLIENT_IDS[provider] !== ''
}

export interface WithdrawProof {
  provider: SocialProviderId
  authorizationCode: string
  redirectUri: string
}

/**
 * provider authorize 페이지로 이동한다. 설정이 없으면 이동하지 않고 안내 문구를 반환한다.
 * @returns 오류 메시지(이동하지 못한 경우) 또는 null
 */
export function startSocialAuthorize(
  provider: SocialProviderId,
  intent: 'login' | 'withdraw',
): string | null {
  const clientId = CLIENT_IDS[provider]
  if (!clientId) return `${provider} 로그인이 아직 설정되지 않았어요.`

  sessionStorage.setItem(PROVIDER_KEY, provider)
  sessionStorage.setItem(INTENT_KEY, intent)

  const base =
    provider === 'kakao'
      ? 'https://kauth.kakao.com/oauth/authorize'
      : 'https://accounts.google.com/o/oauth2/v2/auth'
  const scope = provider === 'google' ? '&scope=openid%20email%20profile' : ''
  // 매번 계정을 입력하도록 강제 — 이전 소셜 세션이 남아 있어도 자동 로그인/계정 고정을 막고 계정 전환을 허용한다.
  // (kakao: prompt=login 재로그인 강제 / google: select_account 계정 선택)
  const prompt = provider === 'kakao' ? '&prompt=login' : '&prompt=select_account'
  window.location.href =
    `${base}?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(SOCIAL_REDIRECT_URI)}` +
    `&response_type=code${scope}${prompt}`
  return null
}

/** 콜백에서 provider·intent를 꺼내며 소비한다(재진입 시 남지 않도록). */
export function consumeAuthorizeContext(): {
  provider: SocialProviderId | null
  intent: 'login' | 'withdraw'
} {
  const provider = sessionStorage.getItem(PROVIDER_KEY) as SocialProviderId | null
  const intent = (sessionStorage.getItem(INTENT_KEY) as 'login' | 'withdraw' | null) ?? 'login'
  sessionStorage.removeItem(PROVIDER_KEY)
  sessionStorage.removeItem(INTENT_KEY)
  return { provider, intent }
}

export function stashWithdrawProof(proof: WithdrawProof) {
  sessionStorage.setItem(WITHDRAW_PROOF_KEY, JSON.stringify(proof))
}

export function consumeWithdrawProof(): WithdrawProof | null {
  const raw = sessionStorage.getItem(WITHDRAW_PROOF_KEY)
  sessionStorage.removeItem(WITHDRAW_PROOF_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as WithdrawProof
  } catch {
    return null
  }
}
