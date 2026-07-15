-- ============================================================
-- 초기 데이터 시드 스크립트 (명세서 pp.50)
-- 실행 방법:
--   1) 최초 1회 `./gradlew bootRun` 으로 JPA(ddl-auto=update)가 스키마를 생성한 뒤,
--   2) MySQL 클라이언트에서 본 스크립트를 실행한다.
--      예) mysql -u root -p ssafy_web_db < INIT.SQL
-- 멱등 실행을 위해 ON DUPLICATE KEY UPDATE 를 사용한다.
-- ============================================================

-- 한글(홍길동/업무/교육/기타) 삽입을 위해 커넥션 문자셋을 utf8mb4 로 지정한다.
SET NAMES utf8mb4;

-- user 테이블 시드 (`user` 는 예약어이므로 백틱 사용)
-- password: '12345' 의 bcrypt 암호화 값
INSERT INTO `user` (id, user_id, department, name, position, password)
VALUES (1, 'test-1', 'SSAFY', '홍길동', '교육생',
        '$2a$10$0sNlKs6TUMs4hTLydDpC4.LWFpzb4dY20ZYNEegPKHkeEMqvyk85S')
ON DUPLICATE KEY UPDATE user_id = VALUES(user_id);

-- conference_category 테이블 시드
-- (conference 도메인 JPA 는 이후 마일스톤으로 연기되어 있어, 본 스크립트에서 직접 테이블을 생성한다.)
CREATE TABLE IF NOT EXISTS conference_category (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255)
);
INSERT INTO conference_category (id, name)
VALUES (1, '업무'), (2, '교육'), (3, '기타')
ON DUPLICATE KEY UPDATE name = VALUES(name);
