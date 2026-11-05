-- VISASBOT - Diagnóstico rápido de BD
SELECT DATABASE() AS base_actual;
SHOW TABLES LIKE 'bot_%';
SELECT COUNT(*) AS servicios_catalogo FROM bot_service_catalog;
SELECT COUNT(*) AS contactos_bot FROM bot_contacts;
SELECT COUNT(*) AS sesiones_bot FROM bot_sessions;
SELECT COUNT(*) AS mensajes_bot FROM bot_messages;
