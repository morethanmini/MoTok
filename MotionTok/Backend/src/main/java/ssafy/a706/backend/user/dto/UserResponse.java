package ssafy.a706.backend.user.dto;

import ssafy.a706.backend.user.User;

public record UserResponse(String userId, String nickname) {

    public static UserResponse from(User user) {
        return new UserResponse(user.getUserId(), user.getNickname());
    }
}
