package ssafy.a706.backend.global.config;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import ssafy.a706.backend.auth.jwt.JwtAuthenticationFilter;
import ssafy.a706.backend.auth.jwt.JwtTokenProvider;
import ssafy.a706.backend.auth.store.AccountBlockStore;
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.global.response.ErrorResponse;
import ssafy.a706.backend.global.security.InternalApiKeyFilter;
import tools.jackson.databind.ObjectMapper;

import java.util.Arrays;
import java.util.List;

@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtTokenProvider jwtTokenProvider;
    private final AccountBlockStore accountBlockStore;
    private final ObjectMapper objectMapper;

    @Value("${app.cors.allowed-origins}")
    private String allowedOrigins;

    /** Swagger 공개 여부 — springdoc 활성화 플래그(SWAGGER_ENABLED)와 같은 값으로 묶는다. 기본 false(운영 잠금). */
    @Value("${springdoc.swagger-ui.enabled:false}")
    private boolean swaggerEnabled;

    /** GPU 워커 폴링 API(/api/internal/ai-jobs/**) 공유 시크릿 — InternalApiKeyFilter가 실제로 검증한다. */
    @Value("${app.internal.api-key:}")
    private String internalApiKey;

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> {
                    // Swagger — 기본 잠금. springdoc 자체가 SWAGGER_ENABLED(기본 false)로 꺼져 있고,
                    // 우발적 활성화에 대비해 인가 계층도 같은 플래그가 켜졌을 때만 연다(운영 CI/CD 노출 금지).
                    if (swaggerEnabled) {
                        auth.requestMatchers("/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").permitAll();
                    }
                    auth
                            // WS 핸드셰이크는 Authorization 헤더를 못 실어 STOMP CONNECT에서 검증한다(StompAuthChannelInterceptor)
                            .requestMatchers("/ws/**").permitAll()
                            // 명세서 🔓 공개 — 가입·로그인·게스트·중복확인·이메일 인증·토큰 갱신
                            .requestMatchers(HttpMethod.GET, "/api/auth/availability/**").permitAll()
                            .requestMatchers(HttpMethod.POST,
                                    "/api/auth/email/verify-request",
                                    "/api/auth/email/verify",
                                    "/api/auth/signup",
                                    "/api/auth/login",
                                    "/api/auth/social/**",
                                    "/api/auth/guest",
                                    "/api/auth/find-id",
                                    "/api/auth/password/reset-request",
                                    "/api/auth/password/reset",
                                    "/api/auth/token/refresh").permitAll()
                            // 공개 조회 — 게임 카탈로그·상세·리더보드(비로그인·게스트는 myRank만 빠진다)
                            .requestMatchers(HttpMethod.GET, "/api/games", "/api/games/*", "/api/games/*/leaderboard").permitAll()
                            // 회원 전용 로비·멀티방 플로우 — 게스트는 1인방만 쓴다(-109).
                            // 목록·생성·빠른시작·초대코드/직접 입장·강퇴는 전부 멀티 플로우라 ROLE_USER로 좁힌다.
                            // (개별 방 조회·나가기·화상 접속은 게스트 1인방에도 필요해 아래 anyRequest 인증으로 통과)
                            .requestMatchers(HttpMethod.GET, "/api/v1/live-rooms").hasRole("USER")
                            .requestMatchers(HttpMethod.POST,
                                    "/api/v1/live-rooms",
                                    "/api/v1/live-rooms/quick-start",
                                    "/api/v1/live-rooms/join-by-invite-code",
                                    "/api/v1/live-rooms/*/join",
                                    "/api/v1/live-rooms/*/members/*/kick",
                                    "/api/v1/live-rooms/*/invitations").hasRole("USER")
                            // 회원 전용 — 게스트 토큰(ROLE_GUEST)의 /users/me 접근을 403으로 차단한다
                            .requestMatchers("/api/users/**").hasRole("USER")
                            // 회원 전용 — 상점(-56)은 게스트가 RDB에 영속되지 않아(D5) 대상이 아니다
                            .requestMatchers("/api/shop/**").hasRole("USER")
                            // 회원 전용 — 친구(-57)도 같은 이유. 게스트 토큰이 오면 MemberPrincipal이 null이 되므로 필터에서 끊는다
                            .requestMatchers("/api/friends/**").hasRole("USER")
                            // 회원 전용 — 방 초대(-100)는 친구에게만 보낼 수 있어 친구를 가질 수 없는 게스트는 대상이 아니다
                            .requestMatchers("/api/invitations/**").hasRole("USER")
                            // 회원 전용 — 업로드 key가 userId로 갈리므로(public/avatars/{userId}/) 게스트는 대상이 아니다.
                            // 용도별 권한(SONG은 ADMIN)은 한 엔드포인트 안에서 갈려 경로 규칙으로 표현할 수 없어 컨트롤러가 확인한다.
                            .requestMatchers("/api/uploads/**").hasRole("USER")
                            // 회원 전용 — 사용자 신고(-112)는 신고자를 users 행으로 특정해 기록해야 하는데
                            // 게스트는 RDB에 영속되지 않아(D5) 남길 신고자가 없다. 명시하지 않으면
                            // anyRequest().authenticated()로 떨어져 게스트 토큰이 통과한다.
                            .requestMatchers("/api/reports/**").hasRole("USER")
                            // 관리자 전용(-133) — role claim이 ADMIN인 토큰만(JwtAuthenticationFilter가 ROLE_ADMIN 부여)
                            .requestMatchers("/api/admin/**", "/api/v1/admin/**").hasRole("ADMIN")
                            // GPU 워커 전용(-102) — 워커는 JWT가 없어 permitAll로 열되,
                            // X-Internal-Key 공유 시크릿 검증(InternalApiKeyFilter)이 실제 방어선이다.
                            .requestMatchers("/api/internal/**").permitAll()
                            // 나머지(개별 방 조회·나가기·화상 토큰·ICE·로그아웃 등)는 회원+게스트 공통 — 유효한 JWT 필수
                            .anyRequest().authenticated();
                })
                .exceptionHandling(eh -> eh
                        .authenticationEntryPoint((req, res, ex) ->
                                writeError(res, ErrorCode.UNAUTHORIZED, req.getRequestURI()))
                        .accessDeniedHandler((req, res, ex) ->
                                writeError(res, ErrorCode.FORBIDDEN, req.getRequestURI())))
                .addFilterBefore(new JwtAuthenticationFilter(jwtTokenProvider, accountBlockStore, objectMapper),
                        UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(new InternalApiKeyFilter(internalApiKey, objectMapper),
                        UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    /** 인증·인가 실패 응답도 명세서 Error 스키마로 통일한다. */
    private void writeError(jakarta.servlet.http.HttpServletResponse res, ErrorCode ec, String path)
            throws java.io.IOException {
        res.setStatus(ec.getStatus().value());
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        res.setCharacterEncoding("UTF-8");
        objectMapper.writeValue(res.getWriter(),
                ErrorResponse.of(ec.getCode(), ec.getMessage(), path));
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(Arrays.stream(allowedOrigins.split(",")).map(String::trim).toList());
        config.setAllowedMethods(List.of("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
