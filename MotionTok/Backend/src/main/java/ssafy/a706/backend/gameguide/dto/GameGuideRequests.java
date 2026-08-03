package ssafy.a706.backend.gameguide.dto;

/** 게임 설명 동기화 발신 페이로드 (SEND /app/rooms/{roomId}/guide). */
public final class GameGuideRequests {

    private GameGuideRequests() {
    }

    /**
     * 방장이 보내는 설명 화면 상태.
     *
     * <p>박싱 타입인 이유 — 필드가 빠진 프레임을 "0/false로 보냈다"와 구분해야 한다.
     * open이 없으면 닫기로, page가 없으면 첫 장으로 본다(서버가 정하고 그대로 방송한다).</p>
     */
    public record Publish(Boolean open, Long gameId, Integer page) {
    }
}
