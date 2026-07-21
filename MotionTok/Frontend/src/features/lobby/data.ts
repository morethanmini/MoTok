/**
 * 로비 목업 데이터 + 타입. 실제 API 연동 시 이 파일을 fetch 결과로 대체하면 됩니다.
 * (컴포넌트는 이 타입에만 의존 → 데이터 소스 교체가 쉬움)
 */
export interface Room {
  title: string
  game: string
  emoji: string
  count: number
  max: number
  state: string
  visibility: string
  disabled: boolean
  /** API 연동 시의 방 식별자 (목업에는 없음) */
  roomId?: string
}

export interface Friend {
  name: string
  face: string
  game: string
  bg: string
  online: boolean
  playing: boolean
}

export const MOCK_ROOMS: Room[] = [
  { title: '별빛 손가락 탐험대', game: '핑거 스타', emoji: '✨', count: 3, max: 6, state: '대기 중', visibility: '공개', disabled: false },
  { title: '댄스 초보 환영!', game: '리듬 펀치', emoji: '🥊', count: 6, max: 8, state: '대기 중', visibility: '공개', disabled: false },
  { title: '오늘은 대어를 낚자', game: '모션 피싱', emoji: '🎣', count: 4, max: 4, state: '정원 마감', visibility: '공개', disabled: true },
  { title: '그림 천재들의 릴레이', game: '드로잉 릴레이', emoji: '🎨', count: 5, max: 8, state: '게임 중', visibility: '공개', disabled: true },
]

export const MOCK_FRIENDS: Friend[] = [
  { name: '민지', face: '🐰', game: '로비에서 둘러보는 중', bg: '#ffe2e3', online: true, playing: false },
  { name: '준호', face: '🐻', game: '댄스 배틀 플레이 중', bg: '#d8f4ec', online: false, playing: true },
  { name: '수아', face: '🐱', game: '로비에서 둘러보는 중', bg: '#fff0b9', online: true, playing: false },
  { name: 'Alex', face: '🦊', game: '모션 피싱 플레이 중', bg: '#dce7ff', online: false, playing: true },
]
