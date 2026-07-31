package ssafy.a706.backend.global.config;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.UUID;

/**
 * 요청 하나에 추적 ID를 붙인다 (-153, -121).
 *
 * <h4>왜 필요한가</h4>
 * nginx 액세스 로그(요청 1건 = 1줄)와 앱 로그는 지금 서로 이어 붙일 방법이 없다.
 * "이 요청이 3초 걸렸다"까지는 nginx가 알려 주지만 <b>그 3초 동안 앱 안에서 무슨 일이
 * 있었는지</b>는 알 수 없다. 같은 ID를 양쪽에 남기면 그 둘이 하나로 이어진다.
 *
 * <pre>
 * nginx  {"rid":"a1b2...","uri":"/api/...","req_time":3.2}
 * 앱     {"traceId":"a1b2...","message":"..."}      ← 같은 값으로 조인
 * </pre>
 *
 * <h4>nginx가 만든 값을 이어받는다</h4>
 * nginx의 {@code $request_id}(요청마다 생성되는 16바이트 난수)를 {@code X-Request-Id} 헤더로
 * 받아 그대로 쓴다. 헤더가 없으면(직접 호출·테스트) 여기서 만든다 — 없다고 로그를 포기하지 않는다.
 *
 * <h4>반드시 지워야 한다</h4>
 * MDC는 ThreadLocal이고 톰캣은 스레드를 재사용한다. 정리하지 않으면 다음 요청이 <b>남의
 * traceId를 달고</b> 찍혀서, 로그를 이어 붙이는 순간 엉뚱한 요청들이 한 덩어리로 보인다.
 * 로그를 남기지 않는 것보다 나쁘다 — 틀린 로그는 잘못된 결론을 만든다.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class TraceIdFilter implements Filter {

    public static final String TRACE_ID = "traceId";
    private static final String HEADER = "X-Request-Id";
    /** nginx의 $request_id는 32자다. 자체 생성분도 같은 길이로 맞춰 눈으로 구분되지 않게 한다. */
    private static final int SELF_GENERATED_LENGTH = 32;

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        MDC.put(TRACE_ID, resolveTraceId(request));
        try {
            chain.doFilter(request, response);
        } finally {
            // 스레드 재사용 때문에 반드시 지운다(위 주석 참고).
            MDC.remove(TRACE_ID);
        }
    }

    private String resolveTraceId(ServletRequest request) {
        if (request instanceof HttpServletRequest http) {
            String forwarded = http.getHeader(HEADER);
            if (forwarded != null && !forwarded.isBlank()) {
                // 외부에서 들어오는 값이라 길이를 자른다 — 로그 한 줄이 통째로 오염되지 않게.
                return forwarded.length() > 64 ? forwarded.substring(0, 64) : forwarded;
            }
        }
        return UUID.randomUUID().toString().replace("-", "").substring(0, SELF_GENERATED_LENGTH);
    }
}
