-- =============================================================
-- TRÁMITE DE VISA AMERICANA EN QUERÉTARO BY VANEZA TORRES
-- VISASBOT - MIGRACIÓN ETAPA 1
-- Compatible con MySQL 5.7 / utf8mb4
--
-- Esta migración es ADITIVA:
--   - NO altera applications
--   - NO altera users
--   - NO altera client_messages
--   - NO elimina ni reemplaza datos actuales
-- =============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `bot_service_catalog` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `code` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `flow_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_service_code` (`code`),
  KEY `idx_bot_service_active_order` (`is_active`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_contacts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `wa_id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'WhatsApp user ID enviado por Meta',
  `phone` varchar(25) COLLATE utf8mb4_unicode_ci NOT NULL,
  `profile_name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'WhatsApp',
  `contact_type` enum('PROSPECTO','CLIENTE_SEGUIMIENTO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PROSPECTO',
  `lead_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NUEVO',
  `service_code` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_existing_client` tinyint(1) NOT NULL DEFAULT '0',
  `client_user_id` int(11) DEFAULT NULL COMMENT 'Referencia lógica a users.id; sin FK para no acoplar la migración',
  `application_id` int(11) DEFAULT NULL COMMENT 'Referencia lógica a applications.id; sin FK para no acoplar la migración',
  `first_contact_at` datetime NOT NULL,
  `last_contact_at` datetime NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_contact_wa_id` (`wa_id`),
  KEY `idx_bot_contact_phone` (`phone`),
  KEY `idx_bot_contact_service` (`service_code`),
  KEY `idx_bot_contact_status` (`lead_status`),
  KEY `idx_bot_contact_client_user` (`client_user_id`),
  KEY `idx_bot_contact_application` (`application_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contact_id` int(11) NOT NULL,
  `state` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MENU_PRINCIPAL',
  `flow_code` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `service_code` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `human_handoff` tinyint(1) NOT NULL DEFAULT '0',
  `last_message_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_session_contact` (`contact_id`),
  KEY `idx_bot_session_state` (`state`),
  KEY `idx_bot_session_handoff` (`human_handoff`),
  CONSTRAINT `fk_bot_sessions_contact`
    FOREIGN KEY (`contact_id`) REFERENCES `bot_contacts` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_messages` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `contact_id` int(11) NOT NULL,
  `meta_message_id` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `direction` enum('IN','OUT') COLLATE utf8mb4_unicode_ci NOT NULL,
  `message_type` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message_text` text COLLATE utf8mb4_unicode_ci,
  `payload_json` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_message_meta_id` (`meta_message_id`),
  KEY `idx_bot_message_contact_date` (`contact_id`,`created_at`),
  KEY `idx_bot_message_direction` (`direction`),
  CONSTRAINT `fk_bot_messages_contact`
    FOREIGN KEY (`contact_id`) REFERENCES `bot_contacts` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `bot_service_catalog` (`code`,`name`,`flow_key`,`sort_order`,`is_active`) VALUES
('01_VISA_USA_PRIMERA_VEZ','Visa Americana - Primera vez','VISA_USA_PRIMERA_VEZ',1,1),
('02_VISA_USA_RENOVACION','Visa Americana - Renovación','VISA_USA_RENOVACION',2,1),
('03_PASAPORTE_MEXICANO','Pasaporte Mexicano','PASAPORTE_MEXICANO',3,1),
('04_PASAPORTE_AMERICANO','Pasaporte Americano','PASAPORTE_AMERICANO',4,1),
('05_VISA_CANADA','Visa Canadiense','VISA_CANADA',5,1),
('06_ETA_CANADA','eTA Canadiense','ETA_CANADA',6,1),
('07_VISA_AUSTRALIA','Visa para Australia','VISA_AUSTRALIA',7,1),
('08_VISA_CHINA','Visa para China','VISA_CHINA',8,1),
('09_ACTA_NACIMIENTO','Acta de Nacimiento','ACTA_NACIMIENTO',9,1),
('10_CLIENTE_SEGUIMIENTO','Ya soy cliente - Seguimiento','CLIENTE_SEGUIMIENTO',10,1),
('11_ASESOR','Hablar con un asesor','ASESOR',11,1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `flow_key` = VALUES(`flow_key`),
  `sort_order` = VALUES(`sort_order`),
  `is_active` = VALUES(`is_active`);

SET FOREIGN_KEY_CHECKS = 1;

-- Verificación rápida después de importar:
-- SELECT * FROM bot_service_catalog ORDER BY sort_order;
-- SHOW TABLES LIKE 'bot_%';
