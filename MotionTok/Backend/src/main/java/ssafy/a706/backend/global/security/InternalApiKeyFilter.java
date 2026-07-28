package ssafy.a706.backend.global.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.global.response.ErrorResponse;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * GPU 워커 폴링 API(/api/internal/**) 전용 인증. SecurityConfig는 이 경로를 permitAll로 열어 두는데
 * (워커는 JWT가 없다) 그러면 실질적으로 아무나 호출할 수 있게 되므로, 공유 시크릿 헤더 검증이
 * 실제 방어선이다. JwtAuthenticationFilter와 같은 이유로 @Component로 두지 않고
 * SecurityConfig가 직접 생성해 등록한다(서블릿 이중 등록 방지).
 */
@Slf4j
public class InternalApiKeyFilter extends OncePerRequestFilter {

    private static final String INTERNAL_PATH_PREFIX = "/api/internal/";
    private static final String HEADER_NAME = "X-Internal-Key";

    private final String apiKey;
    private final ObjectMapper objectMapper;

    public InternalApiKeyFilter(String apiKey, ObjectMapper objectMapper) {
        this.apiKey = apiKey;
        this.objectMapper = objectMapper;
        if (apiKey == null || apiKey.isBlank()) {
            // 조용히 넘어가면 배포 후 워커 폴링이 전부 401로 막히는 걸 로그도 없이 겪는다.
            // INTERNAL_API_KEY 미설정 시에는 어떤 X-Internal-Key로도 통과할 수 없어 안전한 쪽으로 닫힌다.
            log.warn("INTERNAL_API_KEY 미설정 — /api/internal/** 요청이 모두 401로 거부됩니다.");
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith(INTERNAL_PATH_PREFIX);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!isValid(request.getHeader(HEADER_NAME))) {
            writeUnauthorized(response, request.getRequestURI());
            return;
        }
        chain.doFilter(request, response);
    }

    /** 타이밍 공격 방지를 위해 상수 시간 비교를 쓴다. */
    private boolean isValid(String presented) {
        if (apiKey == null || apiKey.isBlank() || presented == null) {
            return false;
        }
        return MessageDigest.isEqual(
                apiKey.getBytes(StandardCharsets.UTF_8),
                presented.getBytes(StandardCharsets.UTF_8));
    }

    private void writeUnauthorized(HttpServletResponse res, String path) throws IOException {
        ErrorCode ec = ErrorCode.INTERNAL_UNAUTHORIZED;
        res.setStatus(ec.getStatus().value());
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        res.setCharacterEncoding("UTF-8");
        objectMapper.writeValue(res.getWriter(), ErrorResponse.of(ec.getCode(), ec.getMessage(), path));
    }
}
