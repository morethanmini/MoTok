package com.ssafy.api.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

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
	public User createUser(UserRegisterPostReq userRegisterInfo) {
		User user = new User();
		user.setUserId(userRegisterInfo.getId());
		user.setName(userRegisterInfo.getName());
		user.setDepartment(userRegisterInfo.getDepartment());
		user.setPosition(userRegisterInfo.getPosition());
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
	public boolean isDuplicateUserId(String userId) {
		// 아이디 중복 확인 (회원가입 전 프론트 '아이디 중복확인' 버튼용).
		return userRepository.findByUserId(userId).isPresent();
	}

	@Override
	public User updateUser(String userId, UserPatchReq updateInfo) {
		User user = getUserByUserId(userId);
		if (user == null) {
			return null;
		}
		if (updateInfo.getDepartment() != null) {
			user.setDepartment(updateInfo.getDepartment());
		}
		if (updateInfo.getPosition() != null) {
			user.setPosition(updateInfo.getPosition());
		}
		if (updateInfo.getName() != null) {
			user.setName(updateInfo.getName());
		}
		return userRepository.save(user);
	}

	@Override
	public boolean deleteUser(String userId) {
		User user = getUserByUserId(userId);
		if (user == null) {
			return false;
		}
		// Sub1 단계에선 유저 삭제 로직만 처리. conference/history 삭제는 Sub2에서 연계.
		userRepository.delete(user);
		return true;
	}
}
