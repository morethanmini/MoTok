package ssafy.a706.backend.signal;

/**
 * 시그널 검증이 필요로 하는 방 상태 읽기 전용 포트.
 * 시그널링은 방 존재·참가 여부만 알면 되므로 저장소 전체 인터페이스에 의존하지 않는다.
 */
public interface RoomMembershipReader {

    boolean existsRoom(String roomId);

    boolean isMember(String roomId, String participantId);
}
