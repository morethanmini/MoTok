package com.ssafy.db.entity;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.Entity;

/**
 * 유저와 컨퍼런스의 N:N 관계(현재 참여중인 방 정보) 매핑 모델 정의.
 */
@Entity
@Getter
@Setter
public class UserConference extends BaseEntity {
    Long conferenceId;
    Long userId;
}
