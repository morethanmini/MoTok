package ssafy.a706.backend.auth.oauth.client;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.util.MultiValueMap;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import ssafy.a706.backend.global.exception.BusinessException;
import ssafy.a706.backend.global.exception.ErrorCode;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;

/**
 * provider 클라이언트 공통부 — form 토큰 요청·Bearer 사용자 조회·오류 변환.
 * 응답은 JsonNode API(Jackson 2/3 간 시그니처 차이) 대신 Map으로 파싱해 안정적으로 다룬다.
 * MVC(블로킹) 컨텍스트라 WebClient 호출을 block()으로 동기화한다.
 */
@Slf4j
abstract class AbstractOauthClient implements OauthClient {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;

    protected AbstractOauthClient(WebClient webClient, ObjectMapper objectMapper) {
        this.webClient = webClient;
        this.objectMapper = objectMapper;
    }

    /** application/x-www-form-urlencoded POST (토큰 엔드포인트). */
    protected Map<String, Object> postForm(String uri, MultiValueMap<String, String> form) {
        return asMap(exchange(webClient.post().uri(uri)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .accept(MediaType.APPLICATION_JSON)
                .body(BodyInserters.fromFormData(form))));
    }

    /** Bearer 토큰 GET (userinfo 엔드포인트). */
    protected Map<String, Object> getWithBearer(String uri, String accessToken) {
        return asMap(exchange(webClient.get().uri(uri)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
                .accept(MediaType.APPLICATION_JSON)));
    }

    private String exchange(WebClient.RequestHeadersSpec<?> spec) {
        try {
            return spec.retrieve().bodyToMono(String.class).block();
        } catch (WebClientResponseException e) {
            // provider가 준 에러 본문(예: 카카오 KOE010, 구글 invalid_grant)까지 남겨 원인 파악을 돕는다.
            throw fail(e.getStatusCode() + " " + e.getResponseBodyAsString());
        } catch (Exception e) {
            throw fail(e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> asMap(String body) {
        if (body == null) {
            throw fail("빈 응답");
        }
        try {
            return objectMapper.readValue(body, Map.class);
        } catch (Exception e) {
            throw fail("응답 파싱 실패");
        }
    }

    @SuppressWarnings("unchecked")
    protected static Map<String, Object> mapOf(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : null;
    }

    protected static String str(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    protected static boolean truthy(Object value) {
        if (value instanceof Boolean b) {
            return b;
        }
        if (value instanceof String s) {
            return Boolean.parseBoolean(s);
        }
        return false;
    }

    protected BusinessException fail(String detail) {
        log.warn("[{}] 소셜 로그인 provider 호출 실패: {}", provider(), detail);
        return new BusinessException(ErrorCode.SOCIAL_LOGIN_FAILED);
    }
}
