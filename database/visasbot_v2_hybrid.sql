-- =============================================================
-- VISASBOT V2 - Migracion de bot hibrido + primer contacto
-- Compatible con MySQL 5.7
-- Ejecutar UNA VEZ sobre: tramitev_crmvisas
-- No borra conversaciones ni mensajes existentes.
-- =============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `bot_conversations` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `contact_id` int(11) NOT NULL,
  `service_code` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mode` enum('BOT','HUMAN') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'BOT',
  `status` enum('OPEN','WAITING_HUMAN','IN_PROGRESS','CLOSED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `assigned_agent_id` int(11) DEFAULT NULL,
  `assigned_agent_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `handoff_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `handoff_requested_at` datetime DEFAULT NULL,
  `handoff_taken_at` datetime DEFAULT NULL,
  `bot_resume_state` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MENU_PRINCIPAL',
  `last_message_at` datetime DEFAULT NULL,
  `last_customer_message_at` datetime DEFAULT NULL,
  `last_staff_message_at` datetime DEFAULT NULL,
  `closed_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_conversation_contact` (`contact_id`),
  KEY `idx_bot_conv_status` (`status`),
  KEY `idx_bot_conv_agent` (`assigned_agent_id`),
  KEY `idx_bot_conv_service` (`service_code`),
  KEY `idx_bot_conv_last_message` (`last_message_at`),
  CONSTRAINT `fk_bot_conv_contact` FOREIGN KEY (`contact_id`) REFERENCES `bot_contacts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_bot_conv_agent` FOREIGN KEY (`assigned_agent_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_conversation_events` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `conversation_id` bigint(20) NOT NULL,
  `event_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_user_id` int(11) DEFAULT NULL,
  `actor_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actor_role` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `detail` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `metadata_json` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bot_event_conv_date` (`conversation_id`,`created_at`),
  KEY `idx_bot_event_actor` (`actor_user_id`),
  CONSTRAINT `fk_bot_event_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `bot_conversations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_bot_event_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_profile_answers` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `contact_id` int(11) NOT NULL,
  `service_code` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `question_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `question_label` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `answer_value` text COLLATE utf8mb4_unicode_ci,
  `answer_label` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_profile_answer` (`contact_id`,`service_code`,`question_key`),
  KEY `idx_bot_profile_service` (`service_code`),
  CONSTRAINT `fk_bot_profile_contact` FOREIGN KEY (`contact_id`) REFERENCES `bot_contacts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_flow_steps` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `service_code` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `step_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `prompt_text` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL,
  `input_type` enum('text','buttons','list') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'text',
  `options_json` longtext COLLATE utf8mb4_unicode_ci,
  `sort_order` int(11) NOT NULL DEFAULT '0',
  `is_required` tinyint(1) NOT NULL DEFAULT '1',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_flow_step` (`service_code`,`step_key`),
  KEY `idx_bot_flow_order` (`service_code`,`is_active`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Crea la conversación persistente para contactos existentes sin alterar su historial.
INSERT INTO bot_conversations
(contact_id, service_code, mode, status, bot_resume_state, last_message_at, created_at, updated_at)
SELECT bc.id, bc.service_code,
       IF(COALESCE(bs.human_handoff,0)=1,'HUMAN','BOT'),
       IF(COALESCE(bs.human_handoff,0)=1,'WAITING_HUMAN','OPEN'),
       COALESCE(bs.state,'MENU_PRINCIPAL'),
       COALESCE(bs.last_message_at, bc.last_contact_at),
       NOW(), NOW()
FROM bot_contacts bc
LEFT JOIN bot_sessions bs ON bs.contact_id = bc.id
ON DUPLICATE KEY UPDATE
  service_code = COALESCE(VALUES(service_code), bot_conversations.service_code),
  bot_resume_state = COALESCE(VALUES(bot_resume_state), bot_conversations.bot_resume_state),
  updated_at = NOW();

-- Perfilamiento inicial. ON DUPLICATE solo reactiva; NO sobreescribe texto editado posteriormente.
INSERT INTO bot_flow_steps
(service_code, step_key, prompt_text, input_type, options_json, sort_order, is_required, is_active, created_at, updated_at)
VALUES
('01_VISA_USA_PRIMERA_VEZ','applicant_relation','Para comenzar, ¿el trámite es para usted o para otra persona?','buttons','[{"value":"SELF","label":"Para mí"},{"value":"OTHER","label":"Otra persona"}]',1,1,1,NOW(),NOW()),
('01_VISA_USA_PRIMERA_VEZ','full_name','¿Cuál es el nombre completo de la persona que realizará el trámite?','text','[]',2,1,1,NOW(),NOW()),
('01_VISA_USA_PRIMERA_VEZ','age_group','¿La persona solicitante es adulta o menor de edad?','buttons','[{"value":"ADULT","label":"Adulto"},{"value":"MINOR","label":"Menor"}]',3,1,1,NOW(),NOW()),
('01_VISA_USA_PRIMERA_VEZ','location','¿En qué ciudad y estado se encuentra actualmente?','text','[]',4,1,1,NOW(),NOW()),
('01_VISA_USA_PRIMERA_VEZ','timeframe','¿Para qué fecha aproximada necesita realizar o utilizar este trámite? Puede responder, por ejemplo: diciembre 2026, lo antes posible o aún no tengo fecha.','text','[]',5,1,1,NOW(),NOW()),
('01_VISA_USA_PRIMERA_VEZ','purpose','¿Cuál es el motivo principal relacionado con este trámite?','list','[{"value":"TOURISM","label":"Turismo"},{"value":"FAMILY","label":"Visita familiar"},{"value":"BUSINESS","label":"Negocios"},{"value":"STUDY","label":"Estudios"},{"value":"OTHER","label":"Otro"}]',6,1,1,NOW(),NOW()),
('02_VISA_USA_RENOVACION','applicant_relation','Para comenzar, ¿el trámite es para usted o para otra persona?','buttons','[{"value":"SELF","label":"Para mí"},{"value":"OTHER","label":"Otra persona"}]',1,1,1,NOW(),NOW()),
('02_VISA_USA_RENOVACION','full_name','¿Cuál es el nombre completo de la persona que realizará el trámite?','text','[]',2,1,1,NOW(),NOW()),
('02_VISA_USA_RENOVACION','age_group','¿La persona solicitante es adulta o menor de edad?','buttons','[{"value":"ADULT","label":"Adulto"},{"value":"MINOR","label":"Menor"}]',3,1,1,NOW(),NOW()),
('02_VISA_USA_RENOVACION','location','¿En qué ciudad y estado se encuentra actualmente?','text','[]',4,1,1,NOW(),NOW()),
('02_VISA_USA_RENOVACION','timeframe','¿Para qué fecha aproximada necesita realizar o utilizar este trámite? Puede responder, por ejemplo: diciembre 2026, lo antes posible o aún no tengo fecha.','text','[]',5,1,1,NOW(),NOW()),
('02_VISA_USA_RENOVACION','purpose','¿Cuál es el motivo principal relacionado con este trámite?','list','[{"value":"TOURISM","label":"Turismo"},{"value":"FAMILY","label":"Visita familiar"},{"value":"BUSINESS","label":"Negocios"},{"value":"STUDY","label":"Estudios"},{"value":"OTHER","label":"Otro"}]',6,1,1,NOW(),NOW()),
('03_PASAPORTE_MEXICANO','applicant_relation','Para comenzar, ¿el trámite es para usted o para otra persona?','buttons','[{"value":"SELF","label":"Para mí"},{"value":"OTHER","label":"Otra persona"}]',1,1,1,NOW(),NOW()),
('03_PASAPORTE_MEXICANO','full_name','¿Cuál es el nombre completo de la persona que realizará el trámite?','text','[]',2,1,1,NOW(),NOW()),
('03_PASAPORTE_MEXICANO','age_group','¿La persona solicitante es adulta o menor de edad?','buttons','[{"value":"ADULT","label":"Adulto"},{"value":"MINOR","label":"Menor"}]',3,1,1,NOW(),NOW()),
('03_PASAPORTE_MEXICANO','location','¿En qué ciudad y estado se encuentra actualmente?','text','[]',4,1,1,NOW(),NOW()),
('03_PASAPORTE_MEXICANO','timeframe','¿Para qué fecha aproximada necesita realizar o utilizar este trámite? Puede responder, por ejemplo: diciembre 2026, lo antes posible o aún no tengo fecha.','text','[]',5,1,1,NOW(),NOW()),
('03_PASAPORTE_MEXICANO','document_situation','¿Cuál describe mejor su situación actual con el pasaporte?','list','[{"value":"FIRST_TIME","label":"Primera vez"},{"value":"RENEWAL","label":"Renovación"},{"value":"EXPIRED","label":"Vencido o por vencer"},{"value":"LOST","label":"Robo o extravío"},{"value":"OTHER","label":"Otro"}]',6,1,1,NOW(),NOW()),
('04_PASAPORTE_AMERICANO','applicant_relation','Para comenzar, ¿el trámite es para usted o para otra persona?','buttons','[{"value":"SELF","label":"Para mí"},{"value":"OTHER","label":"Otra persona"}]',1,1,1,NOW(),NOW()),
('04_PASAPORTE_AMERICANO','full_name','¿Cuál es el nombre completo de la persona que realizará el trámite?','text','[]',2,1,1,NOW(),NOW()),
('04_PASAPORTE_AMERICANO','age_group','¿La persona solicitante es adulta o menor de edad?','buttons','[{"value":"ADULT","label":"Adulto"},{"value":"MINOR","label":"Menor"}]',3,1,1,NOW(),NOW()),
('04_PASAPORTE_AMERICANO','location','¿En qué ciudad y estado se encuentra actualmente?','text','[]',4,1,1,NOW(),NOW()),
('04_PASAPORTE_AMERICANO','timeframe','¿Para qué fecha aproximada necesita realizar o utilizar este trámite? Puede responder, por ejemplo: diciembre 2026, lo antes posible o aún no tengo fecha.','text','[]',5,1,1,NOW(),NOW()),
('04_PASAPORTE_AMERICANO','document_situation','¿Cuál describe mejor su situación actual con el pasaporte?','list','[{"value":"FIRST_TIME","label":"Primera vez"},{"value":"RENEWAL","label":"Renovación"},{"value":"EXPIRED","label":"Vencido o por vencer"},{"value":"LOST","label":"Robo o extravío"},{"value":"OTHER","label":"Otro"}]',6,1,1,NOW(),NOW()),
('05_VISA_CANADA','applicant_relation','Para comenzar, ¿el trámite es para usted o para otra persona?','buttons','[{"value":"SELF","label":"Para mí"},{"value":"OTHER","label":"Otra persona"}]',1,1,1,NOW(),NOW()),
('05_VISA_CANADA','full_name','¿Cuál es el nombre completo de la persona que realizará el trámite?','text','[]',2,1,1,NOW(),NOW()),
('05_VISA_CANADA','age_group','¿La persona solicitante es adulta o menor de edad?','buttons','[{"value":"ADULT","label":"Adulto"},{"value":"MINOR","label":"Menor"}]',3,1,1,NOW(),NOW()),
('05_VISA_CANADA','location','¿En qué ciudad y estado se encuentra actualmente?','text','[]',4,1,1,NOW(),NOW()),
('05_VISA_CANADA','timeframe','¿Para qué fecha aproximada necesita realizar o utilizar este trámite? Puede responder, por ejemplo: diciembre 2026, lo antes posible o aún no tengo fecha.','text','[]',5,1,1,NOW(),NOW()),
('05_VISA_CANADA','purpose','¿Cuál es el motivo principal relacionado con este trámite?','list','[{"value":"TOURISM","label":"Turismo"},{"value":"FAMILY","label":"Visita familiar"},{"value":"BUSINESS","label":"Negocios"},{"value":"STUDY","label":"Estudios"},{"value":"OTHER","label":"Otro"}]',6,1,1,NOW(),NOW()),
('06_ETA_CANADA','applicant_relation','Para comenzar, ¿el trámite es para usted o para otra persona?','buttons','[{"value":"SELF","label":"Para mí"},{"value":"OTHER","label":"Otra persona"}]',1,1,1,NOW(),NOW()),
('06_ETA_CANADA','full_name','¿Cuál es el nombre completo de la persona que realizará el trámite?','text','[]',2,1,1,NOW(),NOW()),
('06_ETA_CANADA','age_group','¿La persona solicitante es adulta o menor de edad?','buttons','[{"value":"ADULT","label":"Adulto"},{"value":"MINOR","label":"Menor"}]',3,1,1,NOW(),NOW()),
('06_ETA_CANADA','location','¿En qué ciudad y estado se encuentra actualmente?','text','[]',4,1,1,NOW(),NOW()),
('06_ETA_CANADA','timeframe','¿Para qué fecha aproximada necesita realizar o utilizar este trámite? Puede responder, por ejemplo: diciembre 2026, lo antes posible o aún no tengo fecha.','text','[]',5,1,1,NOW(),NOW()),
('06_ETA_CANADA','purpose','¿Cuál es el motivo principal relacionado con este trámite?','list','[{"value":"TOURISM","label":"Turismo"},{"value":"FAMILY","label":"Visita familiar"},{"value":"BUSINESS","label":"Negocios"},{"value":"STUDY","label":"Estudios"},{"value":"OTHER","label":"Otro"}]',6,1,1,NOW(),NOW()),
('07_VISA_AUSTRALIA','applicant_relation','Para comenzar, ¿el trámite es para usted o para otra persona?','buttons','[{"value":"SELF","label":"Para mí"},{"value":"OTHER","label":"Otra persona"}]',1,1,1,NOW(),NOW()),
('07_VISA_AUSTRALIA','full_name','¿Cuál es el nombre completo de la persona que realizará el trámite?','text','[]',2,1,1,NOW(),NOW()),
('07_VISA_AUSTRALIA','age_group','¿La persona solicitante es adulta o menor de edad?','buttons','[{"value":"ADULT","label":"Adulto"},{"value":"MINOR","label":"Menor"}]',3,1,1,NOW(),NOW()),
('07_VISA_AUSTRALIA','location','¿En qué ciudad y estado se encuentra actualmente?','text','[]',4,1,1,NOW(),NOW()),
('07_VISA_AUSTRALIA','timeframe','¿Para qué fecha aproximada necesita realizar o utilizar este trámite? Puede responder, por ejemplo: diciembre 2026, lo antes posible o aún no tengo fecha.','text','[]',5,1,1,NOW(),NOW()),
('07_VISA_AUSTRALIA','purpose','¿Cuál es el motivo principal relacionado con este trámite?','list','[{"value":"TOURISM","label":"Turismo"},{"value":"FAMILY","label":"Visita familiar"},{"value":"BUSINESS","label":"Negocios"},{"value":"STUDY","label":"Estudios"},{"value":"OTHER","label":"Otro"}]',6,1,1,NOW(),NOW()),
('08_VISA_CHINA','applicant_relation','Para comenzar, ¿el trámite es para usted o para otra persona?','buttons','[{"value":"SELF","label":"Para mí"},{"value":"OTHER","label":"Otra persona"}]',1,1,1,NOW(),NOW()),
('08_VISA_CHINA','full_name','¿Cuál es el nombre completo de la persona que realizará el trámite?','text','[]',2,1,1,NOW(),NOW()),
('08_VISA_CHINA','age_group','¿La persona solicitante es adulta o menor de edad?','buttons','[{"value":"ADULT","label":"Adulto"},{"value":"MINOR","label":"Menor"}]',3,1,1,NOW(),NOW()),
('08_VISA_CHINA','location','¿En qué ciudad y estado se encuentra actualmente?','text','[]',4,1,1,NOW(),NOW()),
('08_VISA_CHINA','timeframe','¿Para qué fecha aproximada necesita realizar o utilizar este trámite? Puede responder, por ejemplo: diciembre 2026, lo antes posible o aún no tengo fecha.','text','[]',5,1,1,NOW(),NOW()),
('08_VISA_CHINA','purpose','¿Cuál es el motivo principal relacionado con este trámite?','list','[{"value":"TOURISM","label":"Turismo"},{"value":"FAMILY","label":"Visita familiar"},{"value":"BUSINESS","label":"Negocios"},{"value":"STUDY","label":"Estudios"},{"value":"OTHER","label":"Otro"}]',6,1,1,NOW(),NOW()),
('09_ACTA_NACIMIENTO','applicant_relation','Para comenzar, ¿el trámite es para usted o para otra persona?','buttons','[{"value":"SELF","label":"Para mí"},{"value":"OTHER","label":"Otra persona"}]',1,1,1,NOW(),NOW()),
('09_ACTA_NACIMIENTO','full_name','¿Cuál es el nombre completo de la persona que realizará el trámite?','text','[]',2,1,1,NOW(),NOW()),
('09_ACTA_NACIMIENTO','age_group','¿La persona solicitante es adulta o menor de edad?','buttons','[{"value":"ADULT","label":"Adulto"},{"value":"MINOR","label":"Menor"}]',3,1,1,NOW(),NOW()),
('09_ACTA_NACIMIENTO','location','¿En qué ciudad y estado se encuentra actualmente?','text','[]',4,1,1,NOW(),NOW()),
('09_ACTA_NACIMIENTO','timeframe','¿Para qué fecha aproximada necesita realizar o utilizar este trámite? Puede responder, por ejemplo: diciembre 2026, lo antes posible o aún no tengo fecha.','text','[]',5,1,1,NOW(),NOW()),
('09_ACTA_NACIMIENTO','birth_state','¿En qué estado fue registrada el acta de nacimiento que necesita?','text','[]',6,1,1,NOW(),NOW())
ON DUPLICATE KEY UPDATE
  is_active = 1,
  sort_order = VALUES(sort_order);

-- Verificación rápida
SELECT 'bot_conversations' AS tabla, COUNT(*) AS registros FROM bot_conversations
UNION ALL
SELECT 'bot_conversation_events', COUNT(*) FROM bot_conversation_events
UNION ALL
SELECT 'bot_profile_answers', COUNT(*) FROM bot_profile_answers
UNION ALL
SELECT 'bot_flow_steps', COUNT(*) FROM bot_flow_steps;
