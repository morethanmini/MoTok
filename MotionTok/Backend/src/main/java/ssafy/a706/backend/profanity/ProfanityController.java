package ssafy.a706.backend.profanity;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ssafy.a706.backend.global.response.ApiResponse;
import ssafy.a706.backend.global.text.ProfanityWordlist;

/**
 * 비속어 사전 서빙(S15P11A706-152) — FE 폼 선검사(가입 닉네임·방 제목 등)가 BE와 같은 사전을 쓰도록
 * 리소스 파일을 그대로 내려준다. 가입 화면(비로그인)에서도 필요해 공개 GET이다(SecurityConfig).
 * 실제 강제는 서버 검증·마스킹이 담당하므로 이 응답이 낡거나 실패해도 보안 문제는 없다.
 */
@RestController
@RequestMapping("/api/v1/profanity")
@RequiredArgsConstructor
public class ProfanityController {

    private final ProfanityWordlist wordlist;

    /** GET /api/v1/profanity/wordlist — base64 단어 배열을 포함한 사전 JSON 원본. */
    @GetMapping("/wordlist")
    public ApiResponse<JsonNode> wordlist() {
        return ApiResponse.ok(wordlist.raw());
    }
}
