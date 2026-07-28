/**
 * 로비 화면용 뷰 타입. 목업 배열은 API 연동(방 목록 -26, 친구 목록 -57) 후 제거했다.
 * 컴포넌트(RoomCard·FriendItem)는 이 타입에만 의존하므로, LobbyView가 API 응답을 여기 맞춰 매핑한다.
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
  /** 비밀방 여부 — 입장 시 비밀번호 입력이 필요한지 판단(-68). 목업에는 없음 */
  hasPassword?: boolean
}

export interface Friend {
  /** 목록 렌더링 키. 배열 인덱스를 키로 쓰면 폴링으로 순서가 바뀔 때마다
   *  <img>가 새로 만들어져 사진을 다시 내려받는다. */
  userId: number
  name: string
  /** 사진이 없는 친구의 기본 얼굴(이모지) */
  face: string
  game: string
  bg: string
  online: boolean
  /** 프로필 사진 URL. 없으면 face를 그린다. */
  avatarUrl: string | null
}
