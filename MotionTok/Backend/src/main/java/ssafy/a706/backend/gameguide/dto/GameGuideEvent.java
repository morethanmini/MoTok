package ssafy.a706.backend.gameguide.dto;

/**
 * 방 전체에 배포되는 게임 설명 화면 상태 (SUBSCRIBE /topic/rooms/{roomId}/guide).
 *
 * <p><b>type 유니온이 아니라 상태 스냅샷인 이유</b> — 다른 채널(GameEventResponse 등)은
 * "무슨 일이 있었다"를 알리지만 이건 "지금 무엇이 보여야 한다"다. 열기·페이지 넘김·닫기를
 * 각각의 이벤트로 나누면 프레임 순서가 뒤집히거나 하나를 놓쳤을 때 방마다 다른 페이지가
 * 열린 채로 갈린다. 매번 전체 상태를 보내면 마지막 프레임만 이기면 되고, 늦게 들어온
 * 사람에게 현재 상태를 돌려주는 sync 응답도 같은 모양을 그대로 쓸 수 있다(멱등).</p>
 *
 * @param open   설명 모달이 떠 있어야 하는지. false면 gameId·page는 의미 없다
 * @param gameId 설명 중인 게임(games.id)
 * @param page   방장이 보고 있는 0-based 페이지 — 모두 이 페이지로 맞춘다
 */
public record GameGuideEvent(boolean open, Long gameId, int page) {

    public static GameGuideEvent closed() {
        return new GameGuideEvent(false, null, 0);
    }
}
