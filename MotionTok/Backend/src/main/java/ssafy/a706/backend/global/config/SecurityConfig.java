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
import ssafy.a706.backend.global.exception.ErrorCode;
import ssafy.a706.backend.global.response.ErrorResponse;
import tools.jackson.databind.ObjectMapper;

import java.util.Arrays;
import java.util.List;

@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtTokenProvider jwtTokenProvider;
    private final ObjectMapper objectMapper;

    @Value("${app.cors.allowed-origins}")
    private String allowedOrigins;

    /** Swagger 공개 여부 — springdoc 활성화 플래그(SWAGGER_ENABLED)와 같은 값으로 묶는다. 기본 false(운영 잠금). */
    @Value("${springdoc.swagger-ui.enabled:false}")
    private boolean swaggerEnabled;

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
                            // 공개 조회 — 게임 카탈로그·리더보드(비로그인·게스트는 myRank만 빠진다)
                            .requestMatchers(HttpMethod.GET, "/api/games", "/api/games/*/leaderboard").permitAll()
                            // 회원 전용 로비·멀티방 플로우 — 게스트는 1인방만 쓴다(-109).
                            // 목록·생성·빠른시작·초대코드/직접 입장·강퇴는 전부 멀티 플로우라 ROLE_USER로 좁힌다.
                            // (개별 방 조회·나가기·화상 접속은 게스트 1인방에도 필요해 아래 anyRequest 인증으로 통과)
                            .requestMatchers(HttpMethod.GET, "/api/v1/live-rooms").hasRole("USER")
                            .requestMatchers(HttpMethod.POST,
                                    "/api/v1/live-rooms",
                                    "/api/v1/live-rooms/quick-start",
                                    "/api/v1/live-rooms/join-by-invite-code",
                                    "/api/v1/live-rooms/*/join",
                                    "/api/v1/live-rooms/*/members/*/kick").hasRole("USER")
                            // 회원 전용 — 게스트 토큰(ROLE_GUEST)의 /users/me 접근을 403으로 차단한다
                            .requestMatchers("/api/users/**").hasRole("USER")
                            // 관리자 리소스 — 아직 어떤 토큰에도 ADMIN 권한을 싣지 않으므로 사실상 전면 차단(기본 잠금).
                            // 관리자 기능 구현 시 권한 발급(JwtAuthenticationFilter 매핑)부터 설계할 것.
                            .requestMatchers("/api/admin/**").hasRole("ADMIN")
                            // 나머지(개별 방 조회·나가기·화상 토큰·ICE·로그아웃 등)는 회원+게스트 공통 — 유효한 JWT 필수
                            .anyRequest().authenticated();
                })
                .exceptionHandling(eh -> eh
                        .authenticationEntryPoint((req, res, ex) ->
                                writeError(res, ErrorCode.UNAUTHORIZED, req.getRequestURI()))
                        .accessDeniedHandler((req, res, ex) ->
                                writeError(res, ErrorCode.FORBIDDEN, req.getRequestURI())))
                .addFilterBefore(new JwtAuthenticationFilter(jwtTokenProvider),
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
