-- SPEC.md 1.1 초기 시드 데이터
-- User 엔티티(db/entity/User.java) 필드 -> SpringPhysicalNamingStrategy 변환 결과:
--   userId -> user_id, 나머지(id/department/position/name/password)는 동일
-- 재기동 시 ddl-auto=update로 테이블은 유지된 채 data.sql이 매번 실행되므로,
-- PK(id) 충돌 시 재삽입하지 않도록 INSERT IGNORE 사용.
INSERT IGNORE INTO `user` (`id`, `department`, `position`, `name`, `user_id`, `password`)
VALUES (1, 'SSAFY', '교육생', '홍길동', 'test-1', '$2a$10$0sNlKs6TUMs4hTLydDpC4.LWFpzb4dY20ZYNEegPKHkeEMqvyk85S');

-- conference_category 테이블은 아직 Entity/스키마가 없어 Sub2에서 처리 예정 (이번엔 스킵)