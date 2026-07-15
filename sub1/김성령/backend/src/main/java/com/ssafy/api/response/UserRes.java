package com.ssafy.api.response;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.ssafy.db.entity.User;

import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

/**
 * 회원 본인 정보 조회 API ([GET] /api/v1/users/me) 요청에 대한 응답값 정의.
 */
@Getter
@Setter
@ApiModel("UserResponse")
public class UserRes{
	@ApiModelProperty(name="소속")
	String department;

	@ApiModelProperty(name="직책")
	String position;

	@ApiModelProperty(name="이름")
	String name;

	/**
	 * 명세서 기준 응답 바디의 키는 snake_case("user_id") 이므로, 직렬화 이름만 맞춘다.
	 */
	@JsonProperty("user_id")
	@ApiModelProperty(name="User ID")
	String userId;

	public static UserRes of(User user) {
		UserRes res = new UserRes();
		res.setDepartment(user.getDepartment());
		res.setPosition(user.getPosition());
		res.setName(user.getName());
		res.setUserId(user.getUserId());
		return res;
	}
}
