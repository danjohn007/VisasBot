-- ============================================================
-- VISASBOT V3 - MIGRACIÓN PERFILAMIENTO VISA USA
-- Compatible con MySQL 5.7+
-- Ejecutar UNA VEZ antes de probar el nuevo flujo.
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `bot_prospect_profiles` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `contact_id` int(11) NOT NULL,
  `service_code` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `servicio_interes` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `numero_solicitantes` int(11) DEFAULT NULL,
  `edades_solicitantes_json` longtext COLLATE utf8mb4_unicode_ci,
  `motivo_viaje` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `motivo_viaje_otro` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pasaporte_vigente` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `solicitantes_con_pasaporte` int(11) DEFAULT NULL,
  `quiere_pasaporte_mexicano` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `visa_americana_anterior` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `revisar_primera_vez_renovacion` tinyint(1) NOT NULL DEFAULT '0',
  `ciudad_estado` varchar(250) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `origen_prospecto` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recomendado_por` varchar(250) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ubicacion_volante` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `origen_prospecto_otro` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fecha_primer_contacto` datetime DEFAULT NULL,
  `telefono_whatsapp` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requiere_revision_asesora` tinyint(1) NOT NULL DEFAULT '0',
  `revision_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `interes_continuar` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `interes_continuar_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_prospect_contact_service` (`contact_id`,`service_code`),
  KEY `idx_bot_prospect_origin` (`origen_prospecto`),
  KEY `idx_bot_prospect_service` (`service_code`),
  KEY `idx_bot_prospect_passport` (`quiere_pasaporte_mexicano`),
  KEY `idx_bot_prospect_review` (`requiere_revision_asesora`),
  CONSTRAINT `fk_bot_prospect_contact`
    FOREIGN KEY (`contact_id`) REFERENCES `bot_contacts` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bot_profile_applicants` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `profile_id` bigint(20) NOT NULL,
  `applicant_number` int(11) NOT NULL,
  `age` int(11) DEFAULT NULL,
  `occupation` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `previous_visa_status` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `visa_expiry_text` varchar(250) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `previous_visa_grant_age_text` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `needs_advisor_review` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_applicant_profile_number` (`profile_id`,`applicant_number`),
  KEY `idx_bot_applicant_review` (`needs_advisor_review`),
  CONSTRAINT `fk_bot_applicant_profile`
    FOREIGN KEY (`profile_id`) REFERENCES `bot_prospect_profiles` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Las dos visas usan ahora flujo dinámico desde código.
-- Se eliminan las preguntas genéricas antiguas para evitar confusión administrativa.
DELETE FROM `bot_flow_steps`
WHERE `service_code` IN ('01_VISA_USA_PRIMERA_VEZ','02_VISA_USA_RENOVACION');

SET FOREIGN_KEY_CHECKS = 1;

-- Verificación:
SELECT 'bot_prospect_profiles' tabla, COUNT(*) registros FROM bot_prospect_profiles
UNION ALL
SELECT 'bot_profile_applicants', COUNT(*) FROM bot_profile_applicants;
