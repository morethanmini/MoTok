package ssafy.a706.backend.rhythm;

import lombok.Getter;

/**
 * 캐치캐치리듬 전용 예외.
 *
 * <p>공용 {@code ErrorCode} enum에 값을 추가하지 않는 이유: 여섯 게임이 하나의 enum에
 * 각자 상수를 붙이면 MR이 거기서 충돌한다. 이 게임의 오류는 이 클래스 안에서 끝난다.
 * 회신 프레임 모양은 기존 채널과 동일하다({@link RhythmController} 핸들러 참고).</p>
 */
@Getter
public class RhythmException extends RuntimeException {

    /** FE가 분기에 쓰는 코드 문자열 */
    private final String code;

    private RhythmException(String code, String message) {
        super(message);
        this.code = code;
    }

    public static RhythmException roomNotFound() {
        return new RhythmException("RHYTHM_ROOM_NOT_FOUND", "존재하지 않는 방입니다.");
    }

    public static RhythmException notInRoom() {
        return new RhythmException("RHYTHM_NOT_IN_ROOM", "방에 참가한 뒤에 이용할 수 있어요.");
    }

    public static RhythmException notHost() {
        return new RhythmException("RHYTHM_NOT_HOST", "방장만 게임을 시작할 수 있어요.");
    }

    public static RhythmException alreadyActive() {
        return new RhythmException("RHYTHM_ALREADY_ACTIVE", "이미 진행 중인 라운드가 있어요.");
    }

    public static RhythmException sessionNotFound() {
        return new RhythmException("RHYTHM_SESSION_NOT_FOUND", "진행 중인 라운드가 없어요.");
    }

    public static RhythmException gameNotFound() {
        return new RhythmException("RHYTHM_GAME_NOT_FOUND", "게임을 찾을 수 없어요.");
    }

    /**
     * 관리자가 카탈로그에서 닫은 상태(games.is_active=false)로 시작을 시도했을 때.
     * gameNotFound와 나누는 이유 — 다시 열리면 플레이되는 게임이라 "찾을 수 없다"는 거짓말이고,
     * 방장이 자기 방이 고장 났다고 읽는다.
     */
    public static RhythmException gameClosed() {
        return new RhythmException("RHYTHM_GAME_CLOSED", "지금은 플레이할 수 없는 게임이에요.");
    }

    public static RhythmException unauthorized() {
        return new RhythmException("RHYTHM_UNAUTHORIZED", "인증이 필요해요.");
    }
}
