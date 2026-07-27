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
  name: string
  face: string
  game: string
  bg: string
  online: boolean
}
