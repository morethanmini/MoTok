/** 게임룸 목업 데이터 + 타입. */
export interface GameEntry {
  id: string
  name: string
  tag: string
  emoji: string
  thumb: string
  playable: boolean
}

export interface RoomFriend {
  name: string
  crown?: boolean
  muted?: boolean
}

export const GAME_CATALOG: GameEntry[] = [
  { id: 'finger', name: 'FINGER STAR', tag: '손가락으로 별자리 만들기', emoji: '✨', thumb: '#eafbe0', playable: false },
  { id: 'fishing', name: 'MOTION FISH', tag: '두 손으로 낚시하기', emoji: '🎣', thumb: '#dff1fb', playable: false },
  { id: 'dance', name: 'DANCE BATTLE', tag: '리듬 · 풀바디 모션', emoji: '💃', thumb: '#fbf3d9', playable: false },
  { id: 'shape', name: 'SHAPE MATCH', tag: '제시된 포즈 따라하기', emoji: '🤸', thumb: '#f6e6fb', playable: false },
  { id: 'punch', name: 'RHYTHM PUNCH', tag: '비트에 맞춰 펀치', emoji: '🥊', thumb: '#fbe2e2', playable: false },
  { id: 'bubble', name: 'BUBBLE POP', tag: '손으로 거품 터뜨리기', emoji: '🫧', thumb: '#dff6f4', playable: false },
  { id: 'jump', name: 'SKY JUMP', tag: '점프로 장애물 넘기', emoji: '🦘', thumb: '#e6f6ea', playable: false },
  { id: 'mirror', name: 'MIRROR DANCE', tag: '상대 동작 거울처럼', emoji: '🪩', thumb: '#ece6fb', playable: false },
  { id: 'speed', name: 'HAND SPEED', tag: '반응 속도 테스트', emoji: '⚡', thumb: '#fbf3d9', playable: false },
]

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
