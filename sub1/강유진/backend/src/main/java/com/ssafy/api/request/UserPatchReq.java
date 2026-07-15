package com.ssafy.api.request;

import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.Getter;
import lombok.Setter;

/**
 * 유저 정보 수정 API ([PATCH] /api/v1/users/{userId}) 요청에 필요한 리퀘스트 바디 정의.
 */
@Getter
@Setter
@ApiModel("UserPatchRequest")
public class UserPatchReq {
	@ApiModelProperty(name="부서")
	String department;

	@ApiModelProperty(name="직급")
	String position;

	@ApiModelProperty(name="이름")
	String name;
}
