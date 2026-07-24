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
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/ws/**").permitAll()
                        .requestMatchers("/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/**").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/users").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/users/check-id").permitAll()
                        // 로비(방 목록)는 로그인 이후 플로우 — 게스트(ROLE_GUEST)는 1인방만 쓰므로 목록을 열지 않는다.
                        // (개별 방 조회·입장·화상 접속은 게스트 1인방에도 필요해 인증만 요구한다)
                        .requestMatchers(HttpMethod.GET, "/api/v1/live-rooms").hasRole("USER")
                        .requestMatchers(HttpMethod.GET, "/api/v1/games/*/leaderboard").permitAll()
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
                        // 공개 조회. /api/v1/*는 명세 이전 경로로, 게임 도메인 마이그레이션 전까지 함께 허용한다.
                        .requestMatchers(HttpMethod.GET, "/api/games/*/leaderboard", "/api/v1/games/*/leaderboard").permitAll()
                        // 회원 전용 — 게스트 토큰(ROLE_GUEST)의 /users/me 접근을 403으로 차단한다
                        .requestMatchers("/api/users/**").hasRole("USER")
                        // 회원 전용 — 상점(-56)은 게스트가 RDB에 영속되지 않아(D5) 대상이 아니다
                        .requestMatchers("/api/shop/**").hasRole("USER")
                        // 관리자 전용(-133) — role claim이 ADMIN인 토큰만(JwtAuthenticationFilter가 ROLE_ADMIN 부여)
                        .requestMatchers("/api/v1/admin/**").hasRole("ADMIN")
                        // 로그아웃은 인증 필요(명세 401)
                        .anyRequest().authenticated())
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
