-- password 는 '12345' 를 bcrypt 로 암호화한 값이다.
INSERT IGNORE INTO user (id, department, position, name, user_id, password) VALUES
(1, 'SSAFY', '교육생', '홍길동', 'test-1', '$2a$10$02IGN.mw.MQd9xjg8rpiKO8lMFp50qHU6fbHfzHsGqrgvva1ACghq');

INSERT IGNORE INTO conference_category (id, name) VALUES
(1, '업무'),
(2, '교육'),
(3, '기타');
