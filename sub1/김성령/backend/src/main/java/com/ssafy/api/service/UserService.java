package com.ssafy.api.service;

import com.ssafy.api.request.UserPatchReq;
import com.ssafy.api.request.UserRegisterPostReq;
import com.ssafy.db.entity.User;

/**
 *	유저 관련 비즈니스 로직 처리를 위한 서비스 인터페이스 정의.
 */
public interface UserService {
	User createUser(UserRegisterPostReq userRegisterInfo);
	User getUserByUserId(String userId);
	/** 해당 userId 를 가진 회원이 이미 존재하는지 여부. (회원가입 중복 확인용) */
	boolean existsByUserId(String userId);
	/** 소속/직책/이름 수정. 대상이 없으면 null 반환. */
	User updateUser(String userId, UserPatchReq userPatchInfo);
	/** 회원 탈퇴. 삭제한 경우 true, 대상이 없으면 false. */
	boolean deleteUserByUserId(String userId);
}
