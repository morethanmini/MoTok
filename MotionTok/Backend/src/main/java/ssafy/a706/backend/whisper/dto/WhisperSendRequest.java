package ssafy.a706.backend.whisper.dto;

/** 귓속말 발신 본문(-150). 수신자는 destination에 실리므로 본문에는 내용만 담는다. */
public record WhisperSendRequest(String text) {
}
