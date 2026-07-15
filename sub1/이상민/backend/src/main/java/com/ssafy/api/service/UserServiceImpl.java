package com.ssafy.api.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.api.request.UserPatchReq;
import com.ssafy.api.request.UserRegisterPostReq;
import com.ssafy.db.entity.User;
import com.ssafy.db.repository.ConferenceHistoryRepository;
import com.ssafy.db.repository.ConferenceRepository;
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
	ConferenceRepository conferenceRepository;

	@Autowired
	ConferenceHistoryRepository conferenceHistoryRepository;

	@Autowired
	PasswordEncoder passwordEncoder;

	@Override
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
		return userRepositorySupport.findUserByUserId(userId).isPresent();
	}

	@Override
	public User updateUser(String userId, UserPatchReq userPatchInfo) {
		User user = userRepositorySupport.findUserByUserId(userId).orElse(null);
		if (user == null) {
			return null;
		}
		user.setDepartment(userPatchInfo.getDepartment());
		user.setPosition(userPatchInfo.getPosition());
		user.setName(userPatchInfo.getName());
		return userRepository.save(user);
	}

	@Override
	@Transactional
	public void deleteUser(String userId) {
		User user = userRepositorySupport.findUserByUserId(userId).orElse(null);
		if (user == null) {
			return;
		}
		// 해당 유저가 생성한 방을 모두 삭제한다.
		conferenceRepository.deleteByOwnerId(user.getId());
		// 해당 유저의 지난 회의 이력을 모두 삭제한다.
		conferenceHistoryRepository.deleteByUserId(user.getId());
		// 해당 유저 정보를 삭제한다.
		userRepository.delete(user);
	}
}
