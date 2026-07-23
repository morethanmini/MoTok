package ssafy.a706.backend.chat.dto;

/**
 * 대기실 채팅 발신 페이로드 (AsyncAPI SendChat).
 * 발신자 신원은 페이로드가 아니라 STOMP 세션의 인증 Principal에서 얻는다(위조 방지).
 */
public record ChatSendRequest(String text) {
}
