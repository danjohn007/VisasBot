-- =====================================================================
-- CRM VISAS / VISASBOT V6.0 - AJUSTES FINALES PROFUNDOS
-- MySQL 5.7
-- Ejecutar UNA SOLA VEZ antes de subir Web V6.0 y Bot V4.0
-- =====================================================================

USE `tramitev_crmvisas`;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1) SOLICITUDES: búsqueda normalizada + seguimiento independiente
-- ---------------------------------------------------------------------
ALTER TABLE `applications`
  ADD COLUMN `client_phone` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `client_name`,
  ADD COLUMN `client_email` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `client_phone`,
  ADD COLUMN `followup_state` enum('ACTIVO','NO_RESPONDIO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVO' AFTER `client_email`,
  ADD COLUMN `followup_paused_at` datetime DEFAULT NULL AFTER `followup_state`,
  ADD COLUMN `followup_paused_by` int(11) DEFAULT NULL AFTER `followup_paused_at`,
  ADD COLUMN `followup_pause_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `followup_paused_by`,
  ADD KEY `idx_applications_client_name` (`client_name`),
  ADD KEY `idx_applications_client_phone` (`client_phone`),
  ADD KEY `idx_applications_client_email` (`client_email`),
  ADD KEY `idx_applications_followup` (`followup_state`,`created_by`),
  ADD KEY `idx_applications_followup_paused_by` (`followup_paused_by`),
  ADD CONSTRAINT `fk_applications_followup_paused_by`
    FOREIGN KEY (`followup_paused_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Compatibilidad con registros previos si existieran.
UPDATE `applications`
SET `client_phone` = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data_json`, '$.telefono')), '')
WHERE `client_phone` IS NULL AND JSON_VALID(`data_json`) = 1;

UPDATE `applications`
SET `client_email` = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`data_json`, '$.email')), '')
WHERE `client_email` IS NULL AND JSON_VALID(`data_json`) = 1;

-- ---------------------------------------------------------------------
-- 2) WHATSAPP: estado de seguimiento separado del estado técnico
-- ---------------------------------------------------------------------
ALTER TABLE `bot_conversations`
  ADD COLUMN `followup_state` enum('ACTIVO','NO_RESPONDIO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVO' AFTER `status`,
  ADD COLUMN `followup_paused_at` datetime DEFAULT NULL AFTER `followup_state`,
  ADD COLUMN `followup_paused_by` int(11) DEFAULT NULL AFTER `followup_paused_at`,
  ADD COLUMN `followup_pause_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `followup_paused_by`,
  ADD KEY `idx_bot_conv_followup` (`followup_state`,`assigned_agent_id`),
  ADD KEY `idx_bot_conv_followup_paused_by` (`followup_paused_by`),
  ADD CONSTRAINT `fk_bot_conv_followup_paused_by`
    FOREIGN KEY (`followup_paused_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `followup_events` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `source_type` enum('APPLICATION','CONVERSATION') COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_id` bigint(20) NOT NULL,
  `previous_state` enum('ACTIVO','NO_RESPONDIO') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `new_state` enum('ACTIVO','NO_RESPONDIO') COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `changed_by` int(11) DEFAULT NULL,
  `changed_by_name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_followup_source` (`source_type`,`source_id`,`created_at`),
  KEY `idx_followup_state` (`new_state`,`created_at`),
  KEY `idx_followup_user` (`changed_by`),
  CONSTRAINT `fk_followup_user` FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3) FOLIOS POR TIPO DE TRÁMITE
-- ---------------------------------------------------------------------
CREATE TABLE `application_folio_sequences` (
  `prefix` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_number` int(10) UNSIGNED NOT NULL DEFAULT '0',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`prefix`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE `application_folio_history` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `application_id` int(11) NOT NULL,
  `old_folio` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `new_folio` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `changed_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_folio_history_application` (`application_id`,`created_at`),
  KEY `idx_folio_history_old` (`old_folio`),
  KEY `idx_folio_history_new` (`new_folio`),
  CONSTRAINT `fk_folio_history_application`
    FOREIGN KEY (`application_id`) REFERENCES `applications` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_folio_history_user`
    FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Inicializar secuencias desde folios existentes si existieran.
INSERT INTO `application_folio_sequences` (`prefix`,`last_number`)
SELECT 'VISA', COALESCE(MAX(CAST(SUBSTRING_INDEX(`folio`,'-',-1) AS UNSIGNED)),0)
FROM `applications` WHERE `folio` LIKE 'VISA-%'
ON DUPLICATE KEY UPDATE `last_number`=GREATEST(`last_number`,VALUES(`last_number`));

INSERT INTO `application_folio_sequences` (`prefix`,`last_number`)
SELECT 'PASAPORTE', COALESCE(MAX(CAST(SUBSTRING_INDEX(`folio`,'-',-1) AS UNSIGNED)),0)
FROM `applications` WHERE `folio` LIKE 'PASAPORTE-%'
ON DUPLICATE KEY UPDATE `last_number`=GREATEST(`last_number`,VALUES(`last_number`));

INSERT INTO `application_folio_sequences` (`prefix`,`last_number`)
SELECT 'ETA', COALESCE(MAX(CAST(SUBSTRING_INDEX(`folio`,'-',-1) AS UNSIGNED)),0)
FROM `applications` WHERE `folio` LIKE 'ETA-%'
ON DUPLICATE KEY UPDATE `last_number`=GREATEST(`last_number`,VALUES(`last_number`));

-- ---------------------------------------------------------------------
-- 4) EGRESOS: cuenta de origen + comprobante opcional con justificación
-- ---------------------------------------------------------------------
ALTER TABLE `financial_expenses`
  ADD COLUMN `account_id` int(11) DEFAULT NULL AFTER `payment_method`,
  ADD COLUMN `evidence_omission_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `evidence_path`,
  ADD KEY `idx_financial_expenses_account` (`account_id`),
  ADD CONSTRAINT `fk_financial_expenses_account`
    FOREIGN KEY (`account_id`) REFERENCES `finance_accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE `financial_expenses` e
INNER JOIN `finance_accounts` a ON a.`code`='EFECTIVO'
SET e.`account_id`=a.`id`, e.`payment_method`='EFECTIVO'
WHERE e.`account_id` IS NULL;

-- ---------------------------------------------------------------------
-- 5) TRANSFERENCIAS INTERNAS ENTRE CUENTAS
-- ---------------------------------------------------------------------
ALTER TABLE `finance_account_movements`
  MODIFY COLUMN `movement_type`
    enum('INGRESO','EGRESO','AJUSTE_ENTRADA','AJUSTE_SALIDA','TRANSFERENCIA_ENTRADA','TRANSFERENCIA_SALIDA')
    COLLATE utf8mb4_unicode_ci NOT NULL;

CREATE TABLE `finance_internal_transfers` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `transfer_folio` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `from_account_id` int(11) NOT NULL,
  `to_account_id` int(11) NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `transfer_date` date NOT NULL,
  `transfer_time` time DEFAULT NULL,
  `reference` varchar(180) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_finance_internal_transfer_folio` (`transfer_folio`),
  KEY `idx_finance_internal_transfer_date` (`transfer_date`,`id`),
  KEY `idx_finance_internal_transfer_from` (`from_account_id`),
  KEY `idx_finance_internal_transfer_to` (`to_account_id`),
  KEY `idx_finance_internal_transfer_user` (`created_by`),
  CONSTRAINT `fk_finance_internal_transfer_from` FOREIGN KEY (`from_account_id`) REFERENCES `finance_accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_finance_internal_transfer_to` FOREIGN KEY (`to_account_id`) REFERENCES `finance_accounts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_finance_internal_transfer_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 6) ROSY / GERENCIA COMO RESPONSABLE CONFIGURABLE DE PASAPORTES
-- ---------------------------------------------------------------------
INSERT INTO `global_config` (`config_key`,`config_value`,`config_type`)
SELECT 'passport_manager_user_id', CAST(u.`id` AS CHAR), 'text'
FROM `users` u
WHERE u.`role`='Gerente' AND u.`is_active`=1
  AND (LOWER(u.`full_name`) LIKE 'rosa%' OR LOWER(u.`full_name`) LIKE '%rosy%' OR LOWER(u.`username`) LIKE 'rose%')
ORDER BY u.`id` DESC
LIMIT 1
ON DUPLICATE KEY UPDATE `config_value`=VALUES(`config_value`), `config_type`='text';

-- Si no se encontró Rosy por nombre, usar la Gerente activa más reciente.
INSERT INTO `global_config` (`config_key`,`config_value`,`config_type`)
SELECT 'passport_manager_user_id', CAST(u.`id` AS CHAR), 'text'
FROM `users` u
WHERE u.`role`='Gerente' AND u.`is_active`=1
  AND NOT EXISTS (SELECT 1 FROM `global_config` g WHERE g.`config_key`='passport_manager_user_id' AND NULLIF(g.`config_value`,'') IS NOT NULL)
ORDER BY u.`id` DESC
LIMIT 1
ON DUPLICATE KEY UPDATE `config_value`=VALUES(`config_value`), `config_type`='text';

SET FOREIGN_KEY_CHECKS = 1;

-- Verificación rápida
SELECT `config_key`,`config_value` FROM `global_config` WHERE `config_key`='passport_manager_user_id';
SELECT `id`,`full_name`,`role`,`is_active` FROM `users`
WHERE `id`=(SELECT CAST(`config_value` AS UNSIGNED) FROM `global_config` WHERE `config_key`='passport_manager_user_id' LIMIT 1);
