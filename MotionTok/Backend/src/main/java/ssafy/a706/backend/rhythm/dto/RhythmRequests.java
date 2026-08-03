package ssafy.a706.backend.rhythm.dto;

/**
 * 캐치캐치리듬 STOMP 요청 DTO 묶음.
 * 파일을 잘게 쪼개면 이 게임에만 쓰이는 레코드가 dto 폴더에 흩어지므로 한곳에 모았다.
 * 전부 래퍼 타입 — primitive면 필드를 생략한 요청이 400이 된다.
 */
public final class RhythmRequests {

    private RhythmRequests() {
    }

    /**
     * 방장이 라운드를 연다.
     * difficulty가 없거나 알 수 없는 값이면 NORMAL, mode는 catch로 폴백한다.
     *
     * <p>곡 지정 라운드(-168): song(번들 채보 id)이 오면 시드 채보 대신 전원이 같은
     * 번들을 로드한다. durationSec은 그 곡의 길이(서버는 30초~7분으로 클램프해 endAt 계산).
     * 둘 다 없으면 기존 랜덤 채보 라운드 그대로다.</p>
     */
    public record Start(String difficulty, String mode, String song, Integer durationSec) {
    }

    /** 라운드 중 실시간 점수 중계(1초 스로틀). 저장하지 않는다. */
    public record Progress(Integer score, Integer combo) {
    }

    /** 최종 제출 — 최초 1회만 수리된다. */
    public record Finish(Integer score, Integer maxCombo, Integer perfect, Integer good, Integer miss) {
    }
}
