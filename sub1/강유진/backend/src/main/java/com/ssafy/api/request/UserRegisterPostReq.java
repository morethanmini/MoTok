package com.ssafy.api.request;

import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

import javax.validation.constraints.NotBlank;

/**
 * 유저 회원가입 API ([POST] /api/v1/users) 요청에 필요한 리퀘스트 바디 정의.
 */
@Getter
@Setter
@ApiModel("UserRegisterPostRequest")
public class UserRegisterPostReq {
	@ApiModelProperty(name="부서")
	String department;

	@ApiModelProperty(name="직급")
	String position;

	@ApiModelProperty(name="이름")
	@NotBlank(message = "이름은 필수입니다.")
	String name;

	@ApiModelProperty(name="유저 ID", example="ssafy_web")
	@NotBlank(message = "아이디는 필수입니다.")
	@JsonProperty("user_id")
	String id;

	@ApiModelProperty(name="유저 Password", example="your_password")
	@NotBlank(message = "비밀번호는 필수입니다.")
	String password;
}
