package ssafy.a706.backend.user.sanction.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 정지 수동 해제 요청 — 해제도 제재만큼 사유가 남아야 하는 결정이라 필수로 받는다. */
public record ReleaseSuspensionRequest(@NotBlank @Size(max = 200) String reason) {
}
