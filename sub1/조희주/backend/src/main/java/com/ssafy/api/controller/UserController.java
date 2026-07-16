package com.ssafy.api.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.api.request.UserPatchReq;
import com.ssafy.api.request.UserRegisterPostReq;
import com.ssafy.api.response.UserRes;
import com.ssafy.api.service.UserService;
import com.ssafy.common.auth.SsafyUserDetails;
import com.ssafy.common.model.response.BaseResponseBody;
import com.ssafy.db.entity.User;

import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import io.swagger.annotations.ApiResponse;
import io.swagger.annotations.ApiResponses;
import springfox.documentation.annotations.ApiIgnore;

/**
 * 유저 관련 API 요청 처리를 위한 컨트롤러 정의.
 */
@Api(value = "유저 API", tags = {"User"})
@RestController
@RequestMapping("/api/v1/users")
public class UserController {

	@Autowired
	UserService userService;

	@PostMapping()
	@ApiOperation(value = "회원 가입", notes = "회원가입에 필요한 정보를 통해 회원가입 한다.")
    @ApiResponses({
        @ApiResponse(code = 201, message = "성공"),
        @ApiResponse(code = 500, message = "서버 오류")
    })
	public ResponseEntity<? extends BaseResponseBody> register(
			@RequestBody @ApiParam(value="회원가입 정보", required = true) UserRegisterPostReq registerInfo) {

		userService.createUser(registerInfo);

		return ResponseEntity.status(201).body(BaseResponseBody.of(201, "Success"));
	}

	@GetMapping("/me")
	@ApiOperation(value = "회원 본인 정보 조회", notes = "로그인한 회원 본인의 정보를 응답한다.")
    @ApiResponses({
        @ApiResponse(code = 200, message = "성공"),
        @ApiResponse(code = 403, message = "인증 실패"),
        @ApiResponse(code = 500, message = "서버 오류")
    })
	public ResponseEntity<UserRes> getUserInfo(@ApiIgnore Authentication authentication) {
		/**
		 * 요청 헤더 액세스 토큰이 포함된 경우에만 실행되는 인증 처리이후, 리턴되는 인증 정보 객체(authentication) 통해서 요청한 유저 식별.
		 * 액세스 토큰이 없이 요청하는 경우, 403 에러({"error": "Forbidden", "message": "Access Denied"}) 발생.
		 */
		SsafyUserDetails userDetails = (SsafyUserDetails)authentication.getDetails();
		String userId = userDetails.getUsername();
		User user = userService.getUserByUserId(userId);

		return ResponseEntity.status(200).body(UserRes.of(user));
	}

	@GetMapping("/{userId}")
	@ApiOperation(value = "유저 정보 (존재하는 회원 확인용)", notes = "로그인 하지 않은 상태에서 해당 아이디를 가진 회원이 존재하는지 확인한다.")
    @ApiResponses({
        @ApiResponse(code = 200, message = "사용 가능"),
        @ApiResponse(code = 409, message = "이미 존재하는 유저")
    })
	public ResponseEntity<? extends BaseResponseBody> checkUserId(
			@ApiParam(value = "확인할 유저 ID", required = true) @PathVariable String userId,
			@ApiIgnore Authentication authentication) {

		boolean isLoggedIn = authentication != null && !(authentication instanceof AnonymousAuthenticationToken);
		// 로그인 한 사용자가 아닌 경우에만 중복 여부를 응답한다.
		if (!isLoggedIn && userService.existsByUserId(userId)) {
			return ResponseEntity.status(409).body(BaseResponseBody.of(409, "이미 존재하는 사용자 ID 입니다."));
		}

		return ResponseEntity.status(200).body(BaseResponseBody.of(200, "Success"));
	}

	@PatchMapping("/{userId}")
	@ApiOperation(value = "유저 정보 수정", notes = "로그인한 회원 본인의 정보를 수정한다.")
    @ApiResponses({
        @ApiResponse(code = 200, message = "성공"),
        @ApiResponse(code = 403, message = "인증 실패")
    })
	public ResponseEntity<? extends BaseResponseBody> updateUser(
			@ApiParam(value = "수정할 유저 ID", required = true) @PathVariable String userId,
			@RequestBody @ApiParam(value = "수정할 유저 정보", required = true) UserPatchReq userPatchInfo) {

		userService.updateUser(userId, userPatchInfo);

		return ResponseEntity.status(200).body(BaseResponseBody.of(200, "Success"));
	}

	@DeleteMapping("/{userId}")
	@ApiOperation(value = "유저 정보 삭제 (탈퇴)", notes = "로그인한 회원 본인의 계정을 삭제한다.")
    @ApiResponses({
        @ApiResponse(code = 204, message = "성공"),
        @ApiResponse(code = 403, message = "인증 실패")
    })
	public ResponseEntity<? extends BaseResponseBody> deleteUser(
			@ApiParam(value = "삭제할 유저 ID", required = true) @PathVariable String userId) {

		userService.deleteUser(userId);

		return ResponseEntity.status(204).body(BaseResponseBody.of(204, "Success"));
	}
}
