-- ============================================================
-- LIMPIEZA DE PRUEBAS DEL CHATBOT - DANIEL
-- NO elimina users, applications ni audit_trail.
-- Borra únicamente información del módulo WhatsApp/bot asociada
-- a los teléfonos y nombres de prueba indicados.
-- MySQL 5.7+
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TEMPORARY TABLE IF EXISTS `_tmp_bot_contacts_prueba`;
CREATE TEMPORARY TABLE `_tmp_bot_contacts_prueba` (
  `id` int(11) NOT NULL PRIMARY KEY
) ENGINE=MEMORY;

INSERT IGNORE INTO `_tmp_bot_contacts_prueba` (`id`)
SELECT `id`
FROM `bot_contacts`
WHERE
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`wa_id`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', '')
    IN ('4428730578','5214428730578','4426133306','5214426133306')
  OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', '')
    IN ('4428730578','5214428730578','4426133306','5214426133306')
  OR RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`wa_id`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), 10)
    IN ('4428730578','4426133306')
  OR RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`phone`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), 10)
    IN ('4428730578','4426133306')
  OR LOWER(TRIM(COALESCE(`profile_name`,''))) IN ('daniel mota','daniel hernandez','daniel hernández');

-- Eventos administrativos creados por el chatbot no tienen FK, por eso se limpian expresamente.
DELETE FROM `admin_control_events`
WHERE `module` = 'chatbot_whatsapp'
  AND (
    (`entity_type` = 'bot_contact' AND `entity_id` IN (SELECT `id` FROM `_tmp_bot_contacts_prueba`))
    OR COALESCE(`metadata_json`,'') LIKE '%4428730578%'
    OR COALESCE(`metadata_json`,'') LIKE '%5214428730578%'
    OR COALESCE(`metadata_json`,'') LIKE '%4426133306%'
    OR COALESCE(`metadata_json`,'') LIKE '%5214426133306%'
    OR LOWER(COALESCE(`metadata_json`,'')) LIKE '%daniel mota%'
    OR LOWER(COALESCE(`metadata_json`,'')) LIKE '%daniel hernandez%'
  );

-- Tablas nuevas V3 (si ya ejecutaste la migración).
-- Si todavía NO existen, ejecuta primero 01_migracion_perfilamiento_visa_usa.sql
-- o comenta estas dos sentencias.
DELETE bpa
FROM `bot_profile_applicants` bpa
INNER JOIN `bot_prospect_profiles` bpp ON bpp.id = bpa.profile_id
WHERE bpp.contact_id IN (SELECT `id` FROM `_tmp_bot_contacts_prueba`);

DELETE FROM `bot_prospect_profiles`
WHERE `contact_id` IN (SELECT `id` FROM `_tmp_bot_contacts_prueba`);

-- Tablas actuales. Se borran explícitamente para que el script sea claro
-- aun cuando alguna instalación no tenga todos los CASCADE esperados.
DELETE FROM `bot_conversation_events`
WHERE `conversation_id` IN (
  SELECT `id` FROM `bot_conversations`
  WHERE `contact_id` IN (SELECT `id` FROM `_tmp_bot_contacts_prueba`)
);

DELETE FROM `bot_messages`
WHERE `contact_id` IN (SELECT `id` FROM `_tmp_bot_contacts_prueba`);

DELETE FROM `bot_profile_answers`
WHERE `contact_id` IN (SELECT `id` FROM `_tmp_bot_contacts_prueba`);

DELETE FROM `bot_sessions`
WHERE `contact_id` IN (SELECT `id` FROM `_tmp_bot_contacts_prueba`);

DELETE FROM `bot_conversations`
WHERE `contact_id` IN (SELECT `id` FROM `_tmp_bot_contacts_prueba`);

DELETE FROM `bot_contacts`
WHERE `id` IN (SELECT `id` FROM `_tmp_bot_contacts_prueba`);

DROP TEMPORARY TABLE IF EXISTS `_tmp_bot_contacts_prueba`;

SET FOREIGN_KEY_CHECKS = 1;

-- Comprobación: estos SELECT deberían devolver 0 filas.
SELECT * FROM `bot_contacts`
WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`wa_id`, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), 10)
      IN ('4428730578','4426133306');

SELECT * FROM `admin_control_events`
WHERE `module` = 'chatbot_whatsapp'
  AND (
    COALESCE(`metadata_json`,'') LIKE '%4428730578%'
    OR COALESCE(`metadata_json`,'') LIKE '%4426133306%'
  );
