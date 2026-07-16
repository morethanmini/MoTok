-- 초기 데이터 (스켈레톤 재실행 시에도 안전하도록 INSERT IGNORE 사용)
INSERT IGNORE INTO user (id, department, position, name, user_id, password)
VALUES (1, 'SSAFY', '교육생', '홍길동', 'test-1', '$2a$10$0sNlKs6TUMs4hTLydDpC4.LWFpzb4dY20ZYNEegPKHkeEMqvyk85S');

INSERT IGNORE INTO conference_category (id, name) VALUES (1, '업무');
INSERT IGNORE INTO conference_category (id, name) VALUES (2, '교육');
INSERT IGNORE INTO conference_category (id, name) VALUES (3, '기타');
