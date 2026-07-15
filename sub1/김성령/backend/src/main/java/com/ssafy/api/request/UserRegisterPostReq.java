package com.ssafy.api.request;

import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

/**
 * 유저 회원가입 API ([POST] /api/v1/users) 요청에 필요한 리퀘스트 바디 정의.
 */
@Getter
@Setter
@ApiModel("UserRegisterPostRequest")
public class UserRegisterPostReq {
	@ApiModelProperty(name="소속", example="SSAFY")
	String department;

	@ApiModelProperty(name="직책", example="교육생")
	String position;

	@ApiModelProperty(name="이름", example="홍길동")
	String name;

	/**
	 * 명세서 기준 요청 바디의 키는 snake_case("user_id") 이므로, 직렬화 이름만 맞춘다.
	 * 자바 필드는 스켈레톤 엔티티(User.userId)와 동일하게 camelCase 를 유지한다.
	 */
	@JsonProperty("user_id")
	@ApiModelProperty(name="유저 ID", example="ssafy_web")
	String userId;

	@ApiModelProperty(name="유저 Password", example="your_password")
	String password;
}
