#!/bin/sh
# Let's Encrypt 인증서 "최초 발급" 스크립트. EC2 에서 딱 한 번만 실행한다.
#
# 선행 조건:
#   1) 가비아 DNS: motok.co.kr A레코드 → EC2 고정 public IP (전파 완료)
#   2) EC2 보안그룹: 인바운드 80, 443 을 0.0.0.0/0 에 허용 (Let's Encrypt 검증용)
#   3) 이 폴더에 .env 존재 (docker compose 가 app 을 띄우므로)
#
# 실행:  chmod +x init-letsencrypt.sh && ./init-letsencrypt.sh
set -e

DOMAIN="motok.co.kr"
EMAIL="physics8196@gmail.com"          # 인증서 만료 알림 받을 메일 (변경 가능)
COMPOSE="docker compose -f docker-compose.prod.yml"
CERT_PATH="/etc/letsencrypt/live/$DOMAIN"

# 참고: compose 의 certbot 서비스 entrypoint 는 "갱신 루프"로 덮여 있으므로
#       아래 일회성 명령에서는 --entrypoint 로 매번 되돌려 준다.

echo "### 1) nginx 기동용 더미 인증서 생성 (진짜 발급 전 임시)"
$COMPOSE run --rm --entrypoint sh certbot -c "mkdir -p $CERT_PATH && openssl req -x509 -nodes -newkey rsa:2048 -days 1 -keyout $CERT_PATH/privkey.pem -out $CERT_PATH/fullchain.pem -subj /CN=localhost"

echo "### 2) nginx 기동 (더미 인증서로 일단 뜸)"
$COMPOSE up -d nginx

echo "### 3) 더미 인증서 제거 (진짜 인증서로 덮어쓰기 위해)"
$COMPOSE run --rm --entrypoint sh certbot -c "rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf"

echo "### 4) Let's Encrypt 실제 인증서 발급 (webroot 방식)"
$COMPOSE run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email --force-renewal

echo "### 5) nginx 재로드 (진짜 인증서 반영)"
$COMPOSE exec nginx nginx -s reload

echo "### 완료! https://$DOMAIN 접속 확인"
