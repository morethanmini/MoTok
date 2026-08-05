/**
 * 방 안에서 쓰는 게임 표현 — <b>서버 카탈로그 ⨝ 프론트 구현 레지스트리</b>.
 *
 * <p>전에는 이 파일에 게임 11개가 하드코딩돼 있었고 그 배열이 세 가지 일을 겹쳐서 했다.
 * ① 어떤 게임이 존재하나 ② 이름·인원 같은 게임 데이터 ③ 프론트가 그것을 어떻게 그리나.
 * ①②는 서버가 답할 질문인데 프론트에도 사본이 있어 어긋났다 — 서버에 없는 게임 6개가 목록에
 * 남아 있었고, 이름(프론트 `FINGER STAR` vs 서버 `핑거 스타` — 당시 게임① 이름, 현 `별따라
 * 손따라`)과 안내 문구가 서버와 달랐다.</p>
 *
 * <p>그래서 ③만 남긴다. 슬러그·태그·이모지·배경색은 서버가 알 수 없는 값이고(어떤 컴포넌트를
 * 마운트할지는 순전히 이 클라이언트의 문제다), 나머지는 {@link toGameEntries}가 서버 목록에서
 * 채운다.</p>
 */
import type { Game } from '@/api'

/**
 * 화면 분기 키. 이 값으로 게임 컴포넌트·오디오 소유권·전용 테마가 갈린다
 * (`activeGame?.id === 'shape'` → BodyFitGame). <b>서버는 이 값을 모른다.</b>
 */
export type GameSlug = 'finger' | 'rhythm' | 'shape' | 'draw' | 'fish'

/** 서버가 알 수 없는 것만 — 이 클라이언트가 그 게임을 어떻게 보여 주는가. */
interface GameImpl {
  slug: GameSlug
  tag: string
  emoji: string
  thumb: string
}

/**
 * 서버 game id → 프론트 구현. <b>여기 없는 서버 게임은 "준비 중"으로 잠긴 카드가 된다</b> —
 * 조용히 지우지 않는 이유는 닫힌 게임을 목록에 남기는 것과 같다(-106): 어제 있던 게임이 흔적 없이
 * 사라지면 사용자가 이유를 알 수 없고, 백엔드가 게임을 추가했을 때 프론트가 아무것도 안 하면
 * 화면이 빈 채로 열리기 때문이다.
 *
 * id는 백엔드 시더 기준이다(GameCatalogSeeder · RhythmGameSeeder).
 */
const GAME_IMPL: Record<number, GameImpl> = {
  1: { slug: 'finger', tag: '손가락으로 별자리 만들기', emoji: '✨', thumb: '#eafbe0' },
  2: { slug: 'rhythm', tag: '날아오는 음표 잡기', emoji: '🐾', thumb: '#ffe6d8' },
  4: { slug: 'shape', tag: '몸으로 벽 구멍 통과하기', emoji: '🧱', thumb: '#f6e6fb' },
  10: { slug: 'draw', tag: '이어 그리기 · AI 채점', emoji: '🎨', thumb: '#fdeee0' },
  11: { slug: 'fish', tag: '던지고 · 노리고 · 감아올리기', emoji: '🎣', thumb: '#e0f1fb' },
}

/** 구현이 없는 게임의 표현 — 자리는 지키되 그 게임처럼 보이지는 않게 둔다. */
const UNKNOWN_IMPL = { emoji: '🎮', thumb: '#efe7d8' } as const

export interface GameEntry {
  /**
   * 화면 분기 키. <b>구현이 없는 게임은 null</b>이라 어떤 게임 컴포넌트에도 걸리지 않는다.
   * 목록 key로 쓰지 말 것 — null이 여러 개일 수 있다(gameId를 쓴다).
   */
  id: GameSlug | null
  /** 서버 game id — 시작 발신·설명 동기화·썸네일 선택의 기준이다. */
  gameId: number
  /** 이 클라이언트가 그릴 수 있는가. 예전 `playable` 필드가 뜻하던 것이 이것이다. */
  implemented: boolean
  /** 관리자가 열어 둔 상태인가(서버 active). 닫혀 있으면 목록에 남고 시작만 막힌다(-106). */
  active: boolean
  name: string
  tag: string
  emoji: string
  thumb: string
  /** 시작 최소 인원 — 서버 값. 서버도 같은 값으로 거부한다(games.min_players) */
  minPlayers: number
  maxPlayers: number
  description: string
}

/**
 * 서버 목록을 방에서 쓸 모양으로 바꾼다. <b>순서는 서버가 준 그대로</b> 둔다 —
 * 프론트가 다시 정렬하면 게임 목록 화면과 방 안 선택창의 순서가 갈린다.
 */
export function toGameEntries(games: Game[]): GameEntry[] {
  return games.map((game) => {
    const impl = GAME_IMPL[game.id]
    return {
      id: impl?.slug ?? null,
      gameId: game.id,
      implemented: !!impl,
      active: game.active,
      name: game.name,
      tag: impl?.tag ?? game.description,
      emoji: impl?.emoji ?? UNKNOWN_IMPL.emoji,
      thumb: impl?.thumb ?? UNKNOWN_IMPL.thumb,
      minPlayers: game.minPlayers,
      maxPlayers: game.maxPlayers,
      description: game.description,
    }
  })
}

export interface RoomFriend {
  name: string
  crown?: boolean
  muted?: boolean
}

export const LEFT_FRIENDS: RoomFriend[] = [
  { name: 'ALEX', crown: true },
  { name: 'JESS' },
]

export const RIGHT_FRIENDS: RoomFriend[] = [
  { name: 'SAM' },
  { name: 'MINA' },
  { name: 'JORDAN', muted: true },
]

/** 무대 하단 동작(포즈) 선택 버튼의 스틱맨 경로 */
export const MOVE_PATHS: string[] = [
  'M20 11.5v13M20 24.5l-9 12M20 24.5l9 12M20 15l-11 3M20 15l11 3',
  'M20 11.5v15M20 26l-7 11M20 26l7 11M20 15l-9-5M20 15l9-5',
  'M20 11.5v14M20 25.5l-8 11M20 25.5l8 11M20 16l-12 0M20 16l12 0',
  'M20 11.5v14M20 25.5l-4 12M20 25.5l9 9M20 15l-9 6M20 15l8-6',
  'M20 11.5v13M20 24.5l-8 13M20 24.5l6 12M20 15l-10-3M20 15l7 8',
]
