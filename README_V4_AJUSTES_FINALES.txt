VISASBOT V4.0 - AJUSTES FINALES PROFUNDOS
Fecha: 2026-11-18

IMPORTANTE
- Requiere la misma migración SQL de la Web V6.0 antes del deploy.
- No se modifican secretos ni claves existentes del proyecto.

CAMBIOS PRINCIPALES
- Ya no se asigna responsable antes de que el cliente seleccione servicio.
- 03_PASAPORTE_MEXICANO y 04_PASAPORTE_AMERICANO se asignan exclusivamente a la Gerente configurada en global_config.passport_manager_user_id.
- Los demás servicios conservan round-robin real de asesoras activas.
- Si un contacto en estado NO_RESPONDIO vuelve a escribir, la conversación y la solicitud vinculada se reactivan automáticamente.
- Gerencia puede operar los chats de Pasaportes desde la API administrativa.

DEPLOY
Desde la raíz VisasBot:
  cd functions
  npm install
  npm test
  cd ..
  firebase deploy --only functions:whatsappWebhookVisasBot,functions:crmWhatsAppVisasBot --project tramite-visa-vaneza-boot

VALIDACIÓN
- npm test debe devolver: OK: routing + hybrid first-contact tests passed
- Pasaporte Mexicano/Americano -> Gerencia configurada.
- Visa/ETA/otros -> round-robin de Asesoras.
