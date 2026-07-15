package com.ssafy.db.repository;

import com.querydsl.jpa.impl.JPAQueryFactory;
import com.ssafy.db.entity.ConferenceCategory;
import com.ssafy.db.entity.QConferenceCategory;

import java.util.List;
import java.util.Optional;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Repository;

/**
 * 컨퍼런스 종류 모델 관련 디비 쿼리 생성을 위한 구현 정의.
 */
@Repository
public class ConferenceCategoryRepositorySupport {
    @Autowired
    private JPAQueryFactory jpaQueryFactory;
    QConferenceCategory qConferenceCategory = QConferenceCategory.conferenceCategory;

    public List<ConferenceCategory> findAllCategories() {
        return jpaQueryFactory.select(qConferenceCategory).from(qConferenceCategory).fetch();
    }

    public Optional<ConferenceCategory> findCategoryById(Long id) {
        ConferenceCategory category = jpaQueryFactory.select(qConferenceCategory).from(qConferenceCategory)
                .where(qConferenceCategory.id.eq(id)).fetchOne();
        return Optional.ofNullable(category);
    }
}
