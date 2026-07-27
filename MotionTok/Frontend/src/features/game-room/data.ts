/** 게임룸 목업 데이터 + 타입. */
export interface GameEntry {
  id: string
  /** 게임 제안(game-suggest) 발신용 숫자 ID — 실제 게임 카탈로그 연동 전까지의 고정값 */
  gameId: number
  name: string
  tag: string
  emoji: string
  thumb: string
  playable: boolean
  /** 게임 선택창 상세 패널에 보여줄 설명 */
  description: string
  /** 게임 선택창 상세 패널의 플레이 방법 단계 */
  howToPlay: string[]
}

export interface RoomFriend {
  name: string
  crown?: boolean
  muted?: boolean
}

export const GAME_CATALOG: GameEntry[] = [
  {
    id: 'finger', gameId: 1, name: 'FINGER STAR', tag: '손가락으로 별자리 만들기', emoji: '✨', thumb: '#eafbe0', playable: true,
    description: '두 손 열 손가락을 별 위치에 맞게 벌려 별자리 모양을 만드는 게임이에요. 어떤 손가락이든 별 위에 가 있으면 그 별이 켜져요.',
    howToPlay: ['카메라에 두 손이 잘 보이도록 위치를 잡아요', '열 손가락을 움직여 모든 별을 동시에 켜요', '그대로 10초간 유지하면 완성 — 모양이 비슷할수록 고득점!'],
  },
  {
    id: 'rhythm', gameId: 2, name: '캐치캐치리듬', tag: '날아오는 음표 잡기', emoji: '🐾', thumb: '#ffe6d8', playable: true,
    description: '날아오는 음표 버블을 손으로 잡는 리듬 게임이에요. 방 전원이 똑같은 채보로 동시에 플레이하고 점수로 겨뤄요.',
    howToPlay: ['카메라에 두 손이 잘 보이도록 위치를 잡아요', '음표가 다가와 커지는 순간 그 위에서 주먹을 쥐어요', '쥔 채로 쓸고 다니면 안 잡혀요 — 잡을 때마다 새로 쥐어야 해요'],
  },
  {
    id: 'dance', gameId: 3, name: 'DANCE BATTLE', tag: '리듬 · 풀바디 모션', emoji: '💃', thumb: '#fbf3d9', playable: false,
    description: '음악 비트에 맞춰 화면에 나오는 안무를 온몸으로 따라 하는 리듬 게임이에요.',
    howToPlay: ['카메라에 상반신 전체가 나오도록 물러서요', '화면 속 실루엣과 같은 자세를 비트에 맞춰 취해요', '정확도가 높을수록 더 높은 점수를 받아요'],
  },
  {
    id: 'shape', gameId: 4, name: 'SHAPE MATCH', tag: '제시된 포즈 따라하기', emoji: '🤸', thumb: '#f6e6fb', playable: false,
    description: '화면에 제시되는 포즈 실루엣을 몸으로 똑같이 만들어 맞추는 게임이에요.',
    howToPlay: ['카메라에 몸 전체가 보이게 서요', '제시된 실루엣과 같은 포즈를 취해요', '일치율이 높을수록 점수가 올라가요'],
  },
  {
    id: 'punch', gameId: 5, name: 'RHYTHM PUNCH', tag: '비트에 맞춰 펀치', emoji: '🥊', thumb: '#fbe2e2', playable: false,
    description: '박자에 맞춰 날아오는 타겟을 정확한 타이밍에 주먹으로 쳐내는 리듬 액션 게임이에요.',
    howToPlay: ['양손을 가슴 앞에 두고 준비해요', '타겟이 판정선에 오면 그 방향으로 주먹을 뻗어요', '박자를 놓치지 않을수록 콤보가 이어져요'],
  },
  {
    id: 'bubble', gameId: 6, name: 'BUBBLE POP', tag: '손으로 거품 터뜨리기', emoji: '🫧', thumb: '#dff6f4', playable: false,
    description: '화면 위로 떠오르는 거품을 제한 시간 안에 손으로 최대한 많이 터뜨리는 게임이에요.',
    howToPlay: ['손을 카메라 앞에서 자유롭게 움직여요', '떠오르는 거품에 손을 갖다 대면 터져요', '제한 시간 안에 많이 터뜨릴수록 고득점!'],
  },
  {
    id: 'jump', gameId: 7, name: 'SKY JUMP', tag: '점프로 장애물 넘기', emoji: '🦘', thumb: '#e6f6ea', playable: false,
    description: '실제로 제자리 점프를 하며 화면 속 캐릭터가 장애물을 피하도록 조작하는 게임이에요.',
    howToPlay: ['카메라에 전신이 보이도록 거리를 두고 서요', '장애물이 다가오면 실제로 제자리에서 점프해요', '더 멀리 갈수록 높은 점수를 받아요'],
  },
  {
    id: 'mirror', gameId: 8, name: 'MIRROR DANCE', tag: '상대 동작 거울처럼', emoji: '🪩', thumb: '#ece6fb', playable: false,
    description: '상대방의 동작을 거울처럼 똑같이 따라 하며 동시성을 겨루는 2인용 게임이에요.',
    howToPlay: ['상대와 화면을 마주 보고 준비해요', '한 명이 자유롭게 동작을 하면 다른 한 명이 따라 해요', '동작이 얼마나 일치하는지로 점수가 매겨져요'],
  },
  {
    id: 'speed', gameId: 9, name: 'HAND SPEED', tag: '반응 속도 테스트', emoji: '⚡', thumb: '#fbf3d9', playable: false,
    description: '무작위 위치에 표시되는 신호에 손으로 최대한 빠르게 반응하는 반사신경 게임이에요.',
    howToPlay: ['카메라 앞에 양손을 자연스럽게 두어요', '신호가 켜지는 위치로 재빨리 손을 뻗어요', '평균 반응 속도가 빠를수록 높은 점수를 받아요'],
  },
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
