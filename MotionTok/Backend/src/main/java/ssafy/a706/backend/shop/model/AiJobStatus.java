package ssafy.a706.backend.shop.model;

/** AI 아이템 생성 큐 작업 상태. GPU 워커가 폴링해 PENDING → PROCESSING → DONE/FAILED 순으로 전이시킨다. */
public enum AiJobStatus {
    PENDING, PROCESSING, DONE, FAILED
}
