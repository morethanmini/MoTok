package ssafy.a706.backend.shop.model;

/**
 * 이 job의 결과를 누가 만들었는지. 비용 정산·장애 추적에 쓴다.
 *
 * <p>GPU는 워커가 {@code /internal/ai-jobs/next}로 가져갈 때, FAL은 서버가 대신 넘겨받을 때
 * 기록된다. 아직 아무도 가져가지 않은 PENDING job은 null이다.</p>
 */
public enum AiJobProvider {
    GPU, FAL
}
