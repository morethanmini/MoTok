package ssafy.a706.backend.gameguide;

import lombok.Getter;

/**
 * 게임 설명 동기화 전용 예외.
 *
 * <p>공용 {@code ErrorCode} enum에 값을 붙이지 않는 이유는 {@code RhythmException}과 같다 —
 * 기능마다 거기에 상수를 더하면 MR이 그 파일에서 충돌한다. 회신 프레임 모양(code·message·path)은
 * 다른 채널과 동일하다({@link GameGuideController} 핸들러 참고).</p>
 */
@Getter
public class GameGuideException extends RuntimeException {

    /** FE가 분기에 쓰는 코드 문자열 */
    private final String code;

    private GameGuideException(String code, String message) {
        super(message);
        this.code = code;
    }

    public static GameGuideException roomNotFound() {
        return new GameGuideException("GUIDE_ROOM_NOT_FOUND", "존재하지 않는 방입니다.");
    }

    public static GameGuideException notInRoom() {
        return new GameGuideException("GUIDE_NOT_IN_ROOM", "방에 참가한 뒤에 이용할 수 있어요.");
    }

    public static GameGuideException notHost() {
        return new GameGuideException("GUIDE_NOT_HOST", "방장만 설명을 넘길 수 있어요.");
    }

    public static GameGuideException gameRequired() {
        return new GameGuideException("GUIDE_GAME_REQUIRED", "어떤 게임의 설명인지 알 수 없어요.");
    }

    public static GameGuideException unauthorized() {
        return new GameGuideException("GUIDE_UNAUTHORIZED", "인증이 필요해요.");
    }
}
