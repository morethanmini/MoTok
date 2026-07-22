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
  { title: '초보만 오세요', game: '핑거 스타', emoji: '✨', count: 2, max: 6, state: '대기 중', visibility: '공개', disabled: false },
  { title: '별자리 마스터전', game: '핑거 스타', emoji: '✨', count: 5, max: 8, state: '대기 중', visibility: '공개', disabled: false },
  { title: '심야 낚시 모임', game: '모션 피싱', emoji: '🎣', count: 1, max: 4, state: '대기 중', visibility: '공개', disabled: false },
  { title: '낚시왕 결정전', game: '모션 피싱', emoji: '🎣', count: 4, max: 4, state: '게임 중', visibility: '공개', disabled: true },
  { title: '리듬 신입생 환영', game: '리듬 펀치', emoji: '🥊', count: 3, max: 8, state: '대기 중', visibility: '공개', disabled: false },
  { title: '펀치 랭커들의 격전', game: '리듬 펀치', emoji: '🥊', count: 8, max: 8, state: '게임 중', visibility: '공개', disabled: true },
  { title: '드로잉 초심자 모임', game: '드로잉 릴레이', emoji: '🎨', count: 2, max: 8, state: '대기 중', visibility: '공개', disabled: false },
  { title: '같이 그림 맞히기', game: '드로잉 릴레이', emoji: '🎨', count: 6, max: 8, state: '대기 중', visibility: '공개', disabled: false },
  { title: '포즈 챌린지 방', game: '포즈 매치', emoji: '🕺', count: 2, max: 8, state: '대기 중', visibility: '공개', disabled: false },
  { title: '포즈 배틀 8인전', game: '포즈 매치', emoji: '🕺', count: 8, max: 8, state: '게임 중', visibility: '공개', disabled: true },
  { title: '퇴근 후 힐링방', game: '핑거 스타', emoji: '✨', count: 1, max: 6, state: '대기 중', visibility: '공개', disabled: false },
  { title: '주말 파티룸', game: '리듬 펀치', emoji: '🥊', count: 4, max: 8, state: '대기 중', visibility: '공개', disabled: false },
  { title: '낮잠 대신 게임', game: '모션 피싱', emoji: '🎣', count: 2, max: 4, state: '대기 중', visibility: '공개', disabled: false },
  { title: '즐겜만 하는 방', game: '핑거 스타', emoji: '✨', count: 4, max: 8, state: '대기 중', visibility: '공개', disabled: false },
  { title: '초고수만 입장', game: '리듬 펀치', emoji: '🥊', count: 7, max: 8, state: '대기 중', visibility: '공개', disabled: false },
  { title: '드로잉 고인물방', game: '드로잉 릴레이', emoji: '🎨', count: 8, max: 8, state: '게임 중', visibility: '공개', disabled: true },
  { title: '느긋하게 낚시', game: '모션 피싱', emoji: '🎣', count: 1, max: 4, state: '대기 중', visibility: '공개', disabled: false },
  { title: '포즈 매치 연습방', game: '포즈 매치', emoji: '🕺', count: 3, max: 8, state: '대기 중', visibility: '공개', disabled: false },
  { title: '별빛 신규 환영', game: '핑거 스타', emoji: '✨', count: 6, max: 6, state: '정원 마감', visibility: '공개', disabled: true },
  { title: '펀치 입문자 모임', game: '리듬 펀치', emoji: '🥊', count: 2, max: 8, state: '대기 중', visibility: '공개', disabled: false },
  { title: '오늘의 그림왕', game: '드로잉 릴레이', emoji: '🎨', count: 3, max: 8, state: '대기 중', visibility: '공개', disabled: false },
  { title: '밤낚시 동호회', game: '모션 피싱', emoji: '🎣', count: 3, max: 4, state: '대기 중', visibility: '공개', disabled: false },
  { title: '포즈왕 도전방', game: '포즈 매치', emoji: '🕺', count: 5, max: 8, state: '대기 중', visibility: '공개', disabled: false },
]

export const MOCK_FRIENDS: Friend[] = [
  { name: '민지', face: '🐰', game: '로비에서 둘러보는 중', bg: '#ffe2e3', online: true, playing: false },
  { name: '준호', face: '🐻', game: '리듬 펀치방에 참가중', bg: '#d8f4ec', online: true, playing: true },
  { name: '수아', face: '🐱', game: '로비에서 둘러보는 중', bg: '#fff0b9', online: true, playing: false },
  { name: 'Alex', face: '🦊', game: '모션 피싱방에 참가중', bg: '#dce7ff', online: true, playing: true },
  { name: '하나', face: '🐨', game: '오프라인', bg: '#e6e0f0', online: false, playing: false },
  { name: '태영', face: '🐼', game: '오프라인', bg: '#f0e6df', online: false, playing: false },
]
