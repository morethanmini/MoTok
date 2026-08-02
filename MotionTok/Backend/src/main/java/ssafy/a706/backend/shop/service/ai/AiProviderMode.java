package ssafy.a706.backend.shop.service.ai;

/**
 * AI 아이템 생성을 어디서 돌릴지(app.shop.ai-provider).
 *
 * <p>GPU  — GPU 워커만. 워커가 죽어 있으면 job은 PENDING에 머물다 타임아웃 정리·환불된다(기존 동작).</p>
 * <p>FAL  — fal만. 워커 폴링 창구({@code /internal/ai-jobs/next})를 닫아 두므로 워커가 살아 있어도
 *           집어가지 못한다. 창구를 안 닫으면 설정이 무의미해진다.</p>
 * <p>AUTO — GPU 우선. 아무도 가져가지 않은 채 정해진 시간이 지난 job만 fal이 넘겨받는다.</p>
 *
 * <p><b>넘겨받는 건 PENDING뿐이다.</b> 이미 워커가 가져간(PROCESSING) job은 건드리지 않는다 —
 * 그래야 같은 job을 둘이 동시에 만드는 상황 자체가 없고, 조건부 UPDATE 하나로 안전하게 끝난다.
 * 워커가 가져가 놓고 죽은 job은 기존 {@code AiItemJobTimeoutSweeper}가 정리·환불한다.</p>
 */
public enum AiProviderMode {
    GPU,
    FAL,
    AUTO;

    /** fal이 job을 가져갈 수 있는 모드인지. */
    public boolean usesFal() {
        return this != GPU;
    }

    /** GPU 워커의 폴링 창구를 열어 둘지. */
    public boolean allowsGpuWorker() {
        return this != FAL;
    }
}
