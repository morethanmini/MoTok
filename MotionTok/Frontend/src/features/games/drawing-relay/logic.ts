/**
 * 그림으로 말해요 — 이어그리기 시간 분배·펜 제스처·채점 로직 (순수 함수 — 캔버스/DOM 의존 없음).
 *
 * 규칙: 총 1분 30초를 인원수로 나눠(올림) 한 명씩 같은 도화지에 이어 그린다.
 * 완성 그림을 AI가 보고 "무엇을 그린 것인지" 5개를 추측 — 주제어가 몇 순위로
 * 추측됐는지에 따라 점수를 받는다(1순위 100점 … 5순위 20점).
 */

export interface NormalizedPoint {
  x: number
  y: number
}

/**
 * 총 제한 시간(초) — 인원수와 무관하게 고정.
 * 실제 세션의 권위는 서버(games.roundDurationSec)이고 여기 값은 안내 문구·검증용 사본이다.
 * BE GameCatalogSeeder.DRAW_TOTAL_SEC와 동기화할 것.
 */
export const TOTAL_SECONDS = 90
/** 시작 최소 인원 — 이어그리기 게임이라 3명부터(인당 30초). BE 시더 minPlayers와 동기화 */
export const MIN_PLAYERS = 3
export const MAX_PLAYERS = 8

/** 인당 그리기 시간(초) = 총 시간 / 인원수, 나눠떨어지지 않으면 올림 */
export function computeTurnSeconds(playerCount: number): number {
  if (playerCount < 1) return 0
  return Math.ceil(TOTAL_SECONDS / playerCount)
}

// ── 펜 제스처 (핀치) ──────────────────────────
// 엄지 끝(4)과 검지 끝(8)을 집으면 펜 다운(그리기), 벌리면 펜 업(이동), 주먹은 지우개.
// 거리는 손 크기(손목 0 ~ 중지 관절 9)로 나눠 카메라와의 거리에 무관하게 판정한다.
// 다운/업 임계값을 다르게 둬(히스테리시스) 경계에서 펜이 떨리는 것을 막되,
// 업 임계값은 낮게 잡아 손을 펴는 동작을 일찍 감지한다(펜 꼬리 최소화).

export const PINCH_DOWN_RATIO = 0.4
export const PINCH_UP_RATIO = 0.55
/** 검지 끝 landmark 인덱스 — 핀치 중점을 못 구할 때의 펜 끝 폴백 */
export const PEN_TIP_INDEX = 8

/**
 * 펜 끝 좌표 = 엄지·검지 끝의 중점 (정규화 좌표).
 * 검지 끝 단독보다 나은 이유: 손을 펴는 순간 두 손가락이 반대 방향으로 벌어져
 * 중점은 거의 움직이지 않는다 — 펜을 놓을 때 그려지는 꼬리가 크게 준다.
 */
export function pinchMidpoint(landmarks: NormalizedPoint[]): NormalizedPoint | null {
  const thumb = landmarks[4]
  const index = landmarks[8]
  if (!thumb || !index) return null
  return { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 }
}

/**
 * MediaPipe 손 좌/우 라벨 → 게임 역할. 기본: 오른손=펜 · 왼손=지우개.
 * swapHands(왼손잡이 모드)면 반대. 라벨이 없거나 알 수 없으면 null.
 */
export function handRole(
  categoryName: string | undefined,
  swapHands = false,
): 'pen' | 'erase' | null {
  if (categoryName !== 'Right' && categoryName !== 'Left') return null
  return (categoryName === 'Right') !== swapHands ? 'pen' : 'erase'
}

/**
 * 지우개 손 위치 = 너클(네 손가락 MCP 관절) 중심.
 * 주먹을 쥐고 펴는 동안에도 거의 움직이지 않는 안정점이라 문지르기 좌표로 쓴다.
 */
const KNUCKLES = [5, 9, 13, 17]
export function knuckleCenter(landmarks: NormalizedPoint[]): NormalizedPoint | null {
  let sx = 0
  let sy = 0
  for (const i of KNUCKLES) {
    const p = landmarks[i]
    if (!p) return null
    sx += p.x
    sy += p.y
  }
  return { x: sx / KNUCKLES.length, y: sy / KNUCKLES.length }
}

/**
 * 주먹 판정 — 네 손가락(검지~새끼) 끝이 모두 각자의 PIP 관절보다 손목에 가까우면 주먹.
 * 핀치 중에는 검지가 앞으로 뻗어 있어 주먹으로 오인되지 않는다.
 */
const FOLD_PAIRS: [number, number][] = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
]
export function isFist(landmarks: NormalizedPoint[]): boolean {
  const wrist = landmarks[0]
  if (!wrist) return false
  for (const [tip, pip] of FOLD_PAIRS) {
    const t = landmarks[tip]
    const p = landmarks[pip]
    if (!t || !p) return false
    const tipDist = Math.hypot(t.x - wrist.x, t.y - wrist.y)
    const pipDist = Math.hypot(p.x - wrist.x, p.y - wrist.y)
    if (tipDist >= pipDist) return false
  }
  return true
}

/** 엄지-검지 거리 / 손 크기. 랜드마크가 모자라거나 손 크기가 0이면 null */
export function pinchRatio(landmarks: NormalizedPoint[]): number | null {
  const thumb = landmarks[4]
  const index = landmarks[8]
  const wrist = landmarks[0]
  const midMcp = landmarks[9]
  if (!thumb || !index || !wrist || !midMcp) return null
  const handSpan = Math.hypot(wrist.x - midMcp.x, wrist.y - midMcp.y)
  if (handSpan < 1e-6) return null
  return Math.hypot(thumb.x - index.x, thumb.y - index.y) / handSpan
}

/** 히스테리시스 적용 펜 상태 전이 — ratio가 null(손 미검출)이면 무조건 펜 업 */
export function applyPinchHysteresis(prevDown: boolean, ratio: number | null): boolean {
  if (ratio === null) return false
  return prevDown ? ratio < PINCH_UP_RATIO : ratio < PINCH_DOWN_RATIO
}

// ── 획(스트로크) 꼬리 제거 ────────────────────
// 펜 업은 임계값을 넘어야 감지되므로, 손을 펴는 동안 몇 프레임은 펜이 내려간 채
// 손가락이 움직여 꼬리가 그려진다. 획을 점 목록으로 들고 있다가 펜을 놓는 순간
// 마지막 RELEASE_TRIM_MS 구간의 점을 소급 삭제해 꼬리를 지운다.

export interface StrokePoint {
  x: number
  y: number
  /** 기록 시각 (performance.now() ms) */
  t: number
}

export const RELEASE_TRIM_MS = 160

/**
 * 펜을 놓은 시각(releaseT) 직전 trimMs 안에 찍힌 꼬리 점들을 제거한다.
 * 획 전체가 잘리면 첫 점 하나는 남긴다 — 짧은 핀치 탭으로 찍은 점이 사라지지 않게.
 */
export function trimStrokeTail(
  points: StrokePoint[],
  releaseT: number,
  trimMs = RELEASE_TRIM_MS,
): StrokePoint[] {
  if (points.length <= 1) return points
  const cutoff = releaseT - trimMs
  const kept = points.filter((p) => p.t <= cutoff)
  return kept.length > 0 ? kept : points.slice(0, 1)
}

// ── AI 채점 ───────────────────────────────────

/** 추측 순위(1~5)별 점수 — 1순위 100점, 3순위 60점 … */
export const RANK_SCORES = [100, 80, 60, 40, 20] as const

export function scoreForRank(rank: number): number {
  return RANK_SCORES[rank - 1] ?? 0
}

/** 비교용 정규화 — 공백·따옴표·구두점 제거 + 소문자화 */
export function normalizeWord(s: string): string {
  return s
    .toLowerCase()
    .replace(/["'`.,!?~()[\]{}]/g, '')
    .replace(/\s+/g, '')
}

/**
 * 주제어가 추측 목록의 몇 순위인지(1-based). 없으면 0.
 * 정확 일치 우선, 두 글자 이상일 때만 포함 관계도 인정한다
 * ("사과나무" 추측 ↔ 주제 "사과"는 정답, 주제 "배" ↔ 추측 "배구"는 오답).
 */
export function findAnswerRank(topic: string, guesses: string[]): number {
  const t = normalizeWord(topic)
  if (!t) return 0
  for (let i = 0; i < guesses.length; i++) {
    const g = normalizeWord(guesses[i] ?? '')
    if (!g) continue
    if (g === t) return i + 1
    if (t.length >= 2 && g.includes(t)) return i + 1
    if (g.length >= 2 && t.includes(g)) return i + 1
  }
  return 0
}

/**
 * AI 응답 텍스트 → 추측 단어 목록(최대 5개).
 * JSON 배열 응답을 우선 파싱하고, 아니면 "1. 사과" / "- 사과" 형태의 줄 목록으로 파싱한다.
 */
export function parseGuesses(text: string): string[] {
  const jsonMatch = text.match(/\[[\s\S]*?\]/)
  if (jsonMatch) {
    try {
      const arr: unknown = JSON.parse(jsonMatch[0])
      if (Array.isArray(arr)) {
        const words = arr.map((v) => String(v).trim()).filter(Boolean)
        if (words.length > 0) return words.slice(0, 5)
      }
    } catch {
      /* JSON 형식이 아니면 줄 목록 파싱으로 폴백 */
    }
  }
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•]|\d+\s*[.)순위:]+)\s*/, '')
        .replace(/["'`]/g, '')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 5)
}
