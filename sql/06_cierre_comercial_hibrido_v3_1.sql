-- ============================================================
-- VISASBOT V3.1 - CIERRE COMERCIAL / MODO HÍBRIDO
-- Ejecutar si YA habías corrido 04_perfilamiento_visa_usa_v3.sql
-- Compatible con MySQL 5.7+
-- ============================================================

SET NAMES utf8mb4;

SET @db_name := DATABASE();

SET @has_interes := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'bot_prospect_profiles'
    AND COLUMN_NAME = 'interes_continuar'
);

SET @sql_interes := IF(
  @has_interes = 0,
  'ALTER TABLE bot_prospect_profiles ADD COLUMN interes_continuar varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER revision_reason',
  'SELECT ''interes_continuar ya existe'' AS resultado'
);

PREPARE stmt FROM @sql_interes;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_interes_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'bot_prospect_profiles'
    AND COLUMN_NAME = 'interes_continuar_at'
);

SET @sql_interes_at := IF(
  @has_interes_at = 0,
  'ALTER TABLE bot_prospect_profiles ADD COLUMN interes_continuar_at datetime DEFAULT NULL AFTER interes_continuar',
  'SELECT ''interes_continuar_at ya existe'' AS resultado'
);

PREPARE stmt FROM @sql_interes_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'bot_prospect_profiles'
  AND COLUMN_NAME IN ('interes_continuar', 'interes_continuar_at');
