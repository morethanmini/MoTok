-- ============================================================
-- INIT.SQL — 초기 데이터 삽입 스크립트 (명세서 p.50)
--
-- [실행 방법]
--   1. 스키마 생성
--        CREATE DATABASE ssafy_web_db DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
--   2. 애플리케이션을 1회 기동한다.
--      (application.properties 의 spring.jpa.hibernate.ddl-auto=update 설정에 의해
--       user / conference_category 테이블이 자동 생성된다.)
--   3. 이 스크립트를 MySQL Workbench 등에서 실행한다.
--
--   Spring 자동 실행(spring.sql.init.mode=always)을 쓰지 않는 이유는
--   ddl-auto=update 와 함께 쓰면 기동마다 재삽입되어 PK 충돌이 나기 때문이다.
--   아래 INSERT 는 재실행해도 안전하도록 INSERT IGNORE 를 사용한다.
-- ============================================================

USE ssafy_web_db;

-- ------------------------------------------------------------
-- user
--   password 는 평문 '12345' 를 bcrypt 로 암호화한 값이다.
--
--   [주의] 명세서 p.50 에 인쇄된 해시
--          '$2a$10$0sN1Ks6TUMs4hTLydDpC4.LWFpzb4dY20ZYNEegPKHkeEMqvyk85S' 는
--          실제로 BCryptPasswordEncoder.matches("12345", ...) 검증에 실패한다.
--          (명세서의 해시 값 오류로 판단됨) 그대로 넣으면 test-1 로그인이 401 이 된다.
--          따라서 프로젝트의 PasswordEncoder(BCrypt, strength 10)로 '12345' 를 새로 인코딩한
--          아래 해시를 사용한다. bcrypt 는 salt 가 매번 달라 값은 다르지만 '12345' 로 정상 로그인된다.
--
--   컬럼명은 명세서 본문에 'deparment' 로 적혀 있으나 오타로 판단하여
--   팀 결정에 따라 정상 철자인 'department' 를 사용한다. (docs/README.md 참고)
-- ------------------------------------------------------------
INSERT IGNORE INTO user (id, department, position, name, user_id, password) VALUES
(1, 'SSAFY', '교육생', '홍길동', 'test-1', '$2a$10$TcrYYvbz/RLdwSUrRt7BGOf0tu..Tc1O1Taixk/91.T9eDFbkIvN.');

-- ------------------------------------------------------------
-- conference_category
-- ------------------------------------------------------------
INSERT IGNORE INTO conference_category (id, name) VALUES
(1, '업무'),
(2, '교육'),
(3, '기타');
