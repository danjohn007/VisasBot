-- VISASBOT V3.4 - ROUND ROBIN DE ASESORAS
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `bot_assignment_round_robin` (
  `id` tinyint(3) unsigned NOT NULL,
  `last_assigned_user_id` int(11) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_round_robin_last_user` (`last_assigned_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `bot_assignment_round_robin` (`id`, `last_assigned_user_id`)
VALUES (1, NULL)
ON DUPLICATE KEY UPDATE `id` = VALUES(`id`);

SELECT id, full_name, role, is_active, created_at
FROM users
WHERE role = 'Asesor' AND is_active = 1
ORDER BY created_at ASC, id ASC;
