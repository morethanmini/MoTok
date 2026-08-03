package ssafy.a706.backend.shop.service.ai;

/** fal 생성 실패. 호출부는 이걸 받아 job을 FAILED로 돌리고 포인트를 환불한다. */
public class FalGenerationException extends RuntimeException {

    public FalGenerationException(String message) {
        super(message);
    }

    public FalGenerationException(String message, Throwable cause) {
        super(message, cause);
    }
}
