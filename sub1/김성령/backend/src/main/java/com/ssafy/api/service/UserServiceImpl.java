package com.ssafy.api.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.api.request.UserPatchReq;
import com.ssafy.api.request.UserRegisterPostReq;
import com.ssafy.db.entity.User;
import com.ssafy.db.repository.UserRepository;
import com.ssafy.db.repository.UserRepositorySupport;

/**
 *	유저 관련 비즈니스 로직 처리를 위한 서비스 구현 정의.
 */
@Service("userService")
public class UserServiceImpl implements UserService {
	@Autowired
	UserRepository userRepository;

	@Autowired
	UserRepositorySupport userRepositorySupport;

	@Autowired
	PasswordEncoder passwordEncoder;

	@Override
	@Transactional
	public User createUser(UserRegisterPostReq userRegisterInfo) {
		User user = new User();
		user.setUserId(userRegisterInfo.getUserId());
		user.setDepartment(userRegisterInfo.getDepartment());
		user.setPosition(userRegisterInfo.getPosition());
		user.setName(userRegisterInfo.getName());
		// 보안을 위해서 유저 패스워드 암호화 하여 디비에 저장.
		user.setPassword(passwordEncoder.encode(userRegisterInfo.getPassword()));
		return userRepository.save(user);
	}

	@Override
	public User getUserByUserId(String userId) {
		// 디비에 유저 정보 조회 (userId 를 통한 조회).
		User user = userRepositorySupport.findUserByUserId(userId).orElse(null);
		return user;
	}

	@Override
	public boolean existsByUserId(String userId) {
		return userRepository.findByUserId(userId).isPresent();
	}

	@Override
	@Transactional
	public User updateUser(String userId, UserPatchReq userPatchInfo) {
		User user = getUserByUserId(userId);
		if (user == null) {
			return null;
		}
		// PATCH 이므로 요청 바디에 포함된 값만 반영한다. (null 인 필드는 기존 값 유지)
		if (userPatchInfo.getDepartment() != null) {
			user.setDepartment(userPatchInfo.getDepartment());
		}
		if (userPatchInfo.getPosition() != null) {
			user.setPosition(userPatchInfo.getPosition());
		}
		if (userPatchInfo.getName() != null) {
			user.setName(userPatchInfo.getName());
		}
		return userRepository.save(user);
	}

	@Override
	@Transactional
	public boolean deleteUserByUserId(String userId) {
		User user = getUserByUserId(userId);
		if (user == null) {
			return false;
		}
		/**
		 * 명세서 상 탈퇴 시 "해당 유저가 생성한 방"과 "지난 회의 이력"도 함께 삭제해야 하나,
		 * conference / conference_history 테이블은 Sub 2 에서 생성되므로 이번 단계에서는 유저 정보만 삭제한다.
		 * 해당 테이블 추가 시 이 메서드에 삭제 로직을 이어서 구현한다.
		 */
		userRepository.delete(user);
		return true;
	}
}
