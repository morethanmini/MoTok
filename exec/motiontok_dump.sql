-- MySQL dump 10.13  Distrib 8.4.10, for Linux (x86_64)
--
-- Host: localhost    Database: motiontok
-- ------------------------------------------------------
-- Server version	8.4.10

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `motiontok`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `motiontok` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `motiontok`;

--
-- Table structure for table `ai_item_job`
--

DROP TABLE IF EXISTS `ai_item_job`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_item_job` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `category` enum('BACKGROUND','EFFECT','MASK','STICKER') COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `error_message` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `item_id` bigint DEFAULT NULL,
  `name` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sketch_base64` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('DONE','FAILED','PENDING','PROCESSING') COLLATE utf8mb4_unicode_ci NOT NULL,
  `updated_at` datetime(6) DEFAULT NULL,
  `user_id` bigint NOT NULL,
  `image_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `parent_job_id` bigint DEFAULT NULL,
  `points_charged` int DEFAULT NULL,
  `provider` enum('FAL','GPU') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_item_job_parent` (`parent_job_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `chart_leaderboard`
--

DROP TABLE IF EXISTS `chart_leaderboard`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chart_leaderboard` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `best_achieved_at` datetime(6) NOT NULL,
  `best_score` int NOT NULL,
  `chart_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `game_id` bigint NOT NULL,
  `play_count` int NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `user_id` bigint NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_chart_leaderboard_game_chart_user` (`game_id`,`chart_id`,`user_id`),
  KEY `idx_chart_leaderboard_board` (`game_id`,`chart_id`,`best_score`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `chat_reports`
--

DROP TABLE IF EXISTS `chat_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_reports` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `created_at` datetime(6) DEFAULT NULL,
  `updated_at` datetime(6) DEFAULT NULL,
  `chat_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `context_json` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` enum('ABUSE','ETC','HATE','SEXUAL','SPAM') COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason_detail` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reported_at` datetime(6) NOT NULL,
  `reported_nickname` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reported_text` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reported_user_id` bigint NOT NULL,
  `reporter_nickname` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reporter_user_id` bigint NOT NULL,
  `room_id` varchar(6) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('RECEIVED','REJECTED','RESOLVED','REVIEWING') COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_chat_report_room_chat_reporter` (`room_id`,`chat_id`,`reporter_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `decor_setting`
--

DROP TABLE IF EXISTS `decor_setting`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `decor_setting` (
  `user_id` bigint NOT NULL,
  `config` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `friendships`
--

DROP TABLE IF EXISTS `friendships`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `friendships` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `created_at` datetime(6) DEFAULT NULL,
  `updated_at` datetime(6) DEFAULT NULL,
  `addressee_id` bigint NOT NULL,
  `requester_id` bigint NOT NULL,
  `responded_at` datetime(6) DEFAULT NULL,
  `status` enum('ACCEPTED','PENDING') COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_friendship_requester_addressee` (`requester_id`,`addressee_id`),
  KEY `idx_friendship_addressee_status` (`addressee_id`,`status`),
  KEY `idx_friendship_requester_status` (`requester_id`,`status`)
) ENGINE=InnoDB AUTO_INCREMENT=138 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `game_reward_grant`
--

DROP TABLE IF EXISTS `game_reward_grant`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_reward_grant` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `created_at` datetime(6) NOT NULL,
  `game_id` bigint NOT NULL,
  `points` int NOT NULL,
  `session_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` bigint NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UK8msq0o2gtqo5jh6b1wxsd3jdu` (`session_id`,`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `games`
--

DROP TABLE IF EXISTS `games`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `games` (
  `id` bigint NOT NULL,
  `is_active` bit(1) NOT NULL,
  `category` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `countdown_sec` int NOT NULL,
  `max_players` int NOT NULL,
  `min_players` int NOT NULL,
  `mode` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `round_duration_sec` int NOT NULL,
  `supports_bot` bit(1) NOT NULL,
  `thumbnail_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `controls` text COLLATE utf8mb4_unicode_ci,
  `rules` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `item`
--

DROP TABLE IF EXISTS `item`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `item` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `is_active` bit(1) NOT NULL,
  `category` enum('BACKGROUND','EFFECT','MASK','STICKER') COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `creator_id` bigint DEFAULT NULL,
  `image_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `item_type` enum('AI_CUSTOM','SHOP') COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `price_point` int DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `leaderboard_weekly`
--

DROP TABLE IF EXISTS `leaderboard_weekly`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `leaderboard_weekly` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `game_id` bigint NOT NULL,
  `last_session_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mode` enum('MULTI','SOLO') COLLATE utf8mb4_unicode_ci NOT NULL,
  `play_count` int NOT NULL,
  `score_sum` bigint NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `user_id` bigint NOT NULL,
  `week_start` date NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_weekly_game_user_mode_week` (`game_id`,`user_id`,`mode`,`week_start`),
  KEY `idx_weekly_board` (`game_id`,`mode`,`week_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `leaderboards`
--

DROP TABLE IF EXISTS `leaderboards`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `leaderboards` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `best_score` int NOT NULL,
  `game_id` bigint NOT NULL,
  `play_count` int NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `user_id` bigint NOT NULL,
  `mode` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MULTI',
  `best_achieved_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_leaderboard_game_user_mode` (`game_id`,`user_id`,`mode`),
  KEY `idx_leaderboard_board` (`game_id`,`mode`,`best_score`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `oauth_account`
--

DROP TABLE IF EXISTS `oauth_account`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `oauth_account` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `linked_at` datetime(6) NOT NULL,
  `provider` enum('GOOGLE','KAKAO') COLLATE utf8mb4_unicode_ci NOT NULL,
  `provider_uid` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` bigint NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_oauth_provider_uid` (`provider`,`provider_uid`),
  KEY `FKfo0bd94g5i95ufayqbge39p2f` (`user_id`),
  CONSTRAINT `FKfo0bd94g5i95ufayqbge39p2f` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `point_history`
--

DROP TABLE IF EXISTS `point_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `point_history` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `amount` int NOT NULL,
  `balance_after` int NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `ref_id` bigint DEFAULT NULL,
  `type` enum('AI_GENERATE','AI_GENERATE_REFUND','GAME_REWARD','GUEST_MIGRATE','SHOP_PURCHASE') COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` bigint NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sanction_history`
--

DROP TABLE IF EXISTS `sanction_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sanction_history` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `acknowledged_at` datetime(6) DEFAULT NULL,
  `admin_nickname` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `admin_user_id` bigint NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `days` int DEFAULT NULL,
  `reason` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ref_report_id` bigint DEFAULT NULL,
  `ref_report_type` enum('CHAT_REPORT','USER_REPORT') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `type` enum('BAN','RELEASE','SUSPEND','UNBAN','WARN') COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` bigint NOT NULL,
  `user_nickname` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_sanction_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_connect_times`
--

DROP TABLE IF EXISTS `user_connect_times`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_connect_times` (
  `user_id` bigint NOT NULL,
  `total_seconds` bigint NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_item`
--

DROP TABLE IF EXISTS `user_item`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_item` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `acquired_at` datetime(6) NOT NULL,
  `item_id` bigint NOT NULL,
  `user_id` bigint NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UKhdnf32xo3oagxse6hhop3sgo0` (`user_id`,`item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_reports`
--

DROP TABLE IF EXISTS `user_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_reports` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `created_at` datetime(6) DEFAULT NULL,
  `updated_at` datetime(6) DEFAULT NULL,
  `reason` enum('ABUSE','ETC','HATE','SEXUAL','SPAM') COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason_detail` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reported_nickname` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reported_user_id` bigint NOT NULL,
  `reporter_nickname` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reporter_user_id` bigint NOT NULL,
  `status` enum('RECEIVED','REJECTED','RESOLVED','REVIEWING') COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_user_report_reported` (`reported_user_id`),
  KEY `ix_user_report_reporter` (`reporter_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `created_at` datetime(6) DEFAULT NULL,
  `updated_at` datetime(6) DEFAULT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `email` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nickname` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `point_balance` int NOT NULL,
  `role` enum('ADMIN','USER') COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('ACTIVE','BANNED','DELETED','SUSPENDED') COLLATE utf8mb4_unicode_ci NOT NULL,
  `nickname_pending` bit(1) NOT NULL,
  `avatar_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UK2ty1xmrrgtn89xt7kyxx6ta7h` (`nickname`),
  UNIQUE KEY `UK6dotkott2kjsp8vw4d0m25fb7` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=297 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `withdrawn_accounts`
--

DROP TABLE IF EXISTS `withdrawn_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `withdrawn_accounts` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `identifier_hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `identifier_type` enum('EMAIL','SOCIAL') COLLATE utf8mb4_unicode_ci NOT NULL,
  `rejoin_available_at` datetime(6) NOT NULL,
  `withdrawn_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_withdrawn_identifier_hash` (`identifier_hash`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping events for database 'motiontok'
--

--
-- Dumping routines for database 'motiontok'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-08-06 16:05:57
-- MySQL dump 10.13  Distrib 8.4.10, for Linux (x86_64)
--
-- Host: localhost    Database: motiontok
-- ------------------------------------------------------
-- Server version	8.4.10

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Dumping data for table `games`
--

LOCK TABLES `games` WRITE;
/*!40000 ALTER TABLE `games` DISABLE KEYS */;
INSERT INTO `games` VALUES (1,0x01,'MOTION',3,8,1,'VERSUS','별따라 손따라',60,0x00,NULL,'카메라에 두 손이 잘 보이도록 자리를 잡고, 열 손가락 끝을 움직여 화면 속 별 위에 올려놓아요.','60초 동안 화면에 나타나는 별자리를 최대한 많이 완성하는 게임이에요. 두 손 열 손가락을 별 위치에 맞게 벌려 모든 별을 동시에 켠 채 3초 유지하면 완성 — 즉시 다음 별자리가 나와요. 완성 개수가 많을수록, 같으면 평균 점수가 높을수록 이겨요.'),(2,0x01,'RHYTHM',3,8,1,'VERSUS','캐치캐치리듬',60,0x00,NULL,'카메라에 두 손이 잘 보이도록 자리를 잡아요. 음표에 다가오는 원이 판정선과 겹치는 순간 손을 대면 됩니다. 파란 음표는 왼손(L), 빨간 음표는 오른손(R), 보라 음표는 아무 손이나 괜찮아요.','날아오는 음표를 손으로 잡는 리듬 게임이에요. 대부분의 음표는 손이 스치기만 해도 잡히고, 길게 이어진 음표는 경로를 따라 손을 움직여야 해요. 가끔 나오는 금색 음표만 주먹을 쥐어서 잡습니다. 방 전원이 똑같은 채보로 동시에 플레이하고 점수로 겨뤄요.'),(4,0x01,'MOTION',3,8,1,'VERSUS','그대로 멈춰라',12,0x00,NULL,'카메라에 상반신이 잘 보이게 앉고, 벽이 다가오면 구멍 모양과 같은 포즈를 취해요.','한 사람이 취한 포즈가 그대로 벽의 구멍이 되고, 나머지 전원이 자기 아바타를 그 구멍에 끼워 맞추는 게임이에요. 구멍에 못 들어가면 벽에 밀려 떨어져요!'),(10,0x01,'PARTY',3,8,3,'COOP','그림으로 말해요',90,0x00,NULL,'펜 손(기본 오른손) 엄지+검지를 집으면 그려지고, 지우개 손(기본 왼손) 주먹을 쥐고 문지르면 지워져요.','총 1분 30초를 인원수로 나눠 한 도화지에 그림을 이어 그리는 협동 게임이에요(3명부터). 완성 그림을 본 AI가 무엇인지 5가지로 추측하고, 그 안에 주제어가 있으면 순위에 따라 점수를 받아요.'),(11,0x01,'MOTION',3,8,1,'VERSUS','모션 낚시',90,0x00,NULL,'양손으로 대를 쥐고 뒤로 젖혀 조준한 뒤 앞으로 휘둘러 던져요. 기다리는 동안 양손 높이로 미끼 깊이를 조절하고, 입질이 오면 손을 위로 번쩍 들어 챔질한 뒤 한 손으로 릴을 감아요.','90초 동안 물고기를 낚아 점수를 모으는 게임이에요. 어종은 깊이 층이 나뉘어 있어서 미끼를 어느 깊이에 두는지가 무엇을 낚는지를 정해요 — 멸치(5점)는 얕고 상어(120점)는 가장 깊어요. 총점이 높은 사람이 이겨요.');
/*!40000 ALTER TABLE `games` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `item`
--

LOCK TABLES `item` WRITE;
/*!40000 ALTER TABLE `item` DISABLE KEYS */;
INSERT INTO `item` VALUES (1,0x01,'STICKER','2026-07-28 20:32:33.670237',NULL,'/assets/item/sticker/heart_1.png','SHOP','하트 스티커',150),(2,0x01,'STICKER','2026-07-28 20:32:33.697782',NULL,'/assets/item/sticker/note_1.png','SHOP','음표 스티커',200),(3,0x01,'STICKER','2026-07-28 20:32:33.722625',NULL,'/assets/item/sticker/star_1.png','SHOP','별 스티커',250),(4,0x01,'STICKER','2026-07-29 17:36:13.499682',NULL,'/assets/item/sticker/cat_balloon.gif','SHOP','고양이 풍선 스티커',1500),(5,0x01,'EFFECT','2026-08-03 10:19:56.339446',NULL,'/assets/item/effect/soft_glow.svg','SHOP','뽀샤시 효과',300),(6,0x01,'EFFECT','2026-08-03 10:19:56.395036',NULL,'/assets/item/effect/grayscale.svg','SHOP','흑백 효과',150),(7,0x01,'BACKGROUND','2026-08-06 14:15:15.039984',NULL,'/assets/item/background/spotlight.svg','SHOP','어두운 배경',350),(8,0x01,'MASK','2026-08-06 14:15:15.089955',NULL,'/assets/item/mask/mong_mask.png','SHOP','몽이 가면',400);
/*!40000 ALTER TABLE `item` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-08-06 16:05:57
