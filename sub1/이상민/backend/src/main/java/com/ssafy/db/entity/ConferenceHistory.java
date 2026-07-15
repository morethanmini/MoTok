package com.ssafy.db.entity;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.Entity;
import javax.persistence.EnumType;
import javax.persistence.Enumerated;
import java.time.LocalDateTime;

/**
 * 컨퍼런스 이력(생성/참여/나가기) 모델 정의.
 */
@Entity
@Getter
@Setter
public class ConferenceHistory extends BaseEntity {
    Long conferenceId;
    Long userId;

    @Enumerated(EnumType.ORDINAL)
    ConferenceAction action;

    LocalDateTime insertedTime;
}
