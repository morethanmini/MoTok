package ssafy.a706.backend.game.draw;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * application.yaml의 app.gms.* — 그림으로 말해요 AI 채점(GMS 릴레이) 자격증명.
 *
 * <p>프론트에서 직접 호출하면 키가 번들에 노출되므로 채점은 서버에서만 수행한다.
 * api-key가 비어 있으면 채점 요청을 거부한다(조용히 대체하지 않는다 — 실제로 AI가 도는지 판별 가능하게).</p>
 */
@ConfigurationProperties(prefix = "app.gms")
public record GmsProperties(String apiUrl, String apiKey, String model) {

    public boolean configured() {
        return apiKey != null && !apiKey.isBlank() && model != null && !model.isBlank();
    }
}
