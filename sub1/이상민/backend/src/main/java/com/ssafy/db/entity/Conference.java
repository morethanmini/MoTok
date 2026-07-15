package com.ssafy.db.entity;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.Entity;
import java.time.LocalDateTime;

/**
 * 컨퍼런스(방) 모델 정의.
 */
@Entity
@Getter
@Setter
public class Conference extends BaseEntity {
    Long ownerId;
    Long conferenceCategory;
    LocalDateTime callStartTime;
    LocalDateTime callEndTime;
    String thumbnailUrl;
    String title;
    String description;
    Boolean isActive;
}
