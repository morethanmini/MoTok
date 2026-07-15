package com.ssafy.api.request;

import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

/**
 * 유저 정보 수정 API ([PATCH] /api/v1/users/{userId}) 요청에 필요한 리퀘스트 바디 정의.
 */
@Getter
@Setter
@ApiModel("UserModifyPostRequest")
public class UserModifyPostReq {
	@JsonProperty("deparment")
	@ApiModelProperty(name="유저 소속", example="SSAFY")
	String department;
	@ApiModelProperty(name="유저 직책", example="교육생")
	String position;
	@ApiModelProperty(name="유저 이름", example="홍길동")
	String name;
}
