package ssafy.a706.backend.user.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ssafy.a706.backend.user.controller.dto.AdminUserSearchResponse;
import ssafy.a706.backend.user.entity.User;
import ssafy.a706.backend.user.enums.UserStatus;
import ssafy.a706.backend.user.repository.UserRepository;

import java.util.List;

/**
 * 관리자 회원 검색 — 신고·제재 화면이 아는 값은 <b>닉네임</b>인데 조회 필터는 id라서 필요하다.
 *
 * <p>회원 본인용 {@link UserService}와 서비스를 나눈 이유는 포인트 내역과 같다 — 저쪽은 대상이
 * 토큰에서 나오고 이쪽은 대상이 질의 파라미터다. 한 곳에 합치면 "닉네임으로 아무나 찾기"가
 * 인증 경로 안에 생긴다.</p>
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserAdminService {

    private final UserRepository userRepository;

    /**
     * 닉네임 부분 일치 검색(최대 10명).
     *
     * <p>정확 일치만 받으면 오타 하나에 "그런 회원 없음"이 되고, 관리자는 신고 목록으로 돌아가
     * 닉네임을 다시 확인해야 한다. 대신 상한을 두어 한 글자를 넣었을 때 회원 테이블이 통째로
     * 나가지 않게 한다 — 여러 명이면 화면이 고르게 한다.</p>
     *
     * <p>탈퇴 계정은 뺀다. 닉네임이 {@code deleted_...} 자리표시자로 바뀌어 있어 사람이 찾는
     * 이름으로는 걸리지 않고, 걸려 봐야 제재할 대상이 아니다.</p>
     */
    public AdminUserSearchResponse searchByNickname(String nickname) {
        String query = nickname == null ? "" : nickname.trim();
        if (query.isEmpty()) {
            return new AdminUserSearchResponse(List.of());
        }
        List<AdminUserSearchResponse.Entry> users = userRepository
                .findTop10ByNicknameContainingAndStatusNotOrderByIdAsc(query, UserStatus.DELETED)
                .stream()
                .map(this::toEntry)
                .toList();
        return new AdminUserSearchResponse(users);
    }

    private AdminUserSearchResponse.Entry toEntry(User user) {
        return new AdminUserSearchResponse.Entry(user.getId(), user.getNickname());
    }
}
