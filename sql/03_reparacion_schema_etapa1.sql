-- =============================================================
-- VISASBOT ETAPA 1 - REPARACIÓN / NORMALIZACIÓN DE ESQUEMA
-- MySQL 5.7 compatible. Conserva los registros existentes.
-- Ejecutar sobre la MISMA BD configurada en DB_NAME_VISASBOT.
-- =============================================================

SET NAMES utf8mb4;

-- 1) Las tablas base deben existir. Si no existen, se crean.
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
  UNIQUE KEY `uk_bot_service_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_contacts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `wa_id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(25) COLLATE utf8mb4_unicode_ci NOT NULL,
  `profile_name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'WhatsApp',
  `contact_type` enum('PROSPECTO','CLIENTE_SEGUIMIENTO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PROSPECTO',
  `lead_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NUEVO',
  `service_code` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_existing_client` tinyint(1) NOT NULL DEFAULT '0',
  `client_user_id` int(11) DEFAULT NULL,
  `application_id` int(11) DEFAULT NULL,
  `first_contact_at` datetime NOT NULL,
  `last_contact_at` datetime NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_contact_wa_id` (`wa_id`)
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
  UNIQUE KEY `uk_bot_session_contact` (`contact_id`)
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
  UNIQUE KEY `uk_bot_message_meta_id` (`meta_message_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Helper para agregar columnas que falten en instalaciones parciales.
DROP PROCEDURE IF EXISTS `_visasbot_add_column_if_missing`;
DELIMITER $$
CREATE PROCEDURE `_visasbot_add_column_if_missing`(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table
       AND COLUMN_NAME = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL `_visasbot_add_column_if_missing`('bot_contacts','contact_type',"enum('PROSPECTO','CLIENTE_SEGUIMIENTO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PROSPECTO'");
CALL `_visasbot_add_column_if_missing`('bot_contacts','lead_status',"varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NUEVO'");
CALL `_visasbot_add_column_if_missing`('bot_contacts','service_code',"varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL");
CALL `_visasbot_add_column_if_missing`('bot_contacts','is_existing_client',"tinyint(1) NOT NULL DEFAULT '0'");
CALL `_visasbot_add_column_if_missing`('bot_contacts','client_user_id',"int(11) DEFAULT NULL");
CALL `_visasbot_add_column_if_missing`('bot_contacts','application_id',"int(11) DEFAULT NULL");
CALL `_visasbot_add_column_if_missing`('bot_contacts','updated_at',"timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");

CALL `_visasbot_add_column_if_missing`('bot_sessions','state',"varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MENU_PRINCIPAL'");
CALL `_visasbot_add_column_if_missing`('bot_sessions','flow_code',"varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL");
CALL `_visasbot_add_column_if_missing`('bot_sessions','service_code',"varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL");
CALL `_visasbot_add_column_if_missing`('bot_sessions','human_handoff',"tinyint(1) NOT NULL DEFAULT '0'");
CALL `_visasbot_add_column_if_missing`('bot_sessions','last_message_at',"datetime DEFAULT NULL");
CALL `_visasbot_add_column_if_missing`('bot_sessions','updated_at',"timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");

DROP PROCEDURE `_visasbot_add_column_if_missing`;

-- 3) Normaliza tipos usados por el código (sin borrar datos).
ALTER TABLE `bot_contacts`
  MODIFY `contact_type` enum('PROSPECTO','CLIENTE_SEGUIMIENTO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PROSPECTO',
  MODIFY `lead_status` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NUEVO',
  MODIFY `service_code` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL;

ALTER TABLE `bot_sessions`
  MODIFY `state` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MENU_PRINCIPAL',
  MODIFY `flow_code` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  MODIFY `service_code` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  MODIFY `human_handoff` tinyint(1) NOT NULL DEFAULT '0';

-- 4) Catálogo exacto solicitado por el cliente.
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
  `name`=VALUES(`name`),
  `flow_key`=VALUES(`flow_key`),
  `sort_order`=VALUES(`sort_order`),
  `is_active`=VALUES(`is_active`);

-- 5) Verificación: estas consultas deben devolver 11 servicios y estados válidos.
SELECT COUNT(*) AS servicios_catalogados FROM bot_service_catalog WHERE is_active = 1;
SELECT id, wa_id, service_code, contact_type, lead_status FROM bot_contacts ORDER BY id DESC LIMIT 10;
SELECT contact_id, state, flow_code, service_code, human_handoff FROM bot_sessions ORDER BY id DESC LIMIT 10;
