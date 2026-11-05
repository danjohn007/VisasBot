# VisasBot V2 - Bot híbrido + primer contacto

Esta versión mantiene el menú principal y agrega un flujo real de primer contacto, handoff humano y una API segura para que el CRM pueda tomar y responder conversaciones.

## Qué cambia

- Primer contacto de 6 pasos para los servicios 1-9.
- Las respuestas se guardan en `bot_profile_answers` y se muestran en el CRM.
- El bot no promete aprobación, precios ni requisitos no configurados; recopila contexto para la asesora.
- `Hablar con asesor` cambia la conversación a `WAITING_HUMAN` y pausa completamente el bot.
- Una asesora puede tomar la conversación desde la web. Una vez tomada queda `IN_PROGRESS`.
- Mientras la conversación está en modo humano el bot guarda los mensajes entrantes pero NO responde.
- La asesora puede devolver la conversación al bot.
- Los mensajes de BOT / CLIENTE / ASESORA / ADMIN quedan diferenciados en el historial.
- No existen funciones para editar ni borrar mensajes.

## Orden de instalación

1. En phpMyAdmin, seleccione la BD `tramitev_crmvisas` y ejecute:
   `database/visasbot_v2_hybrid.sql`
2. Cree una clave larga y aleatoria para comunicar CRM -> Firebase. Ejemplo de creación en PowerShell:
   `[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')`
3. Guárdela en Firebase:
   `firebase functions:secrets:set WEB_ADMIN_KEY_VISASBOT`
4. Desde `functions/`, pruebe:
   `npm test`
5. Despliegue ambas Functions:
   `firebase deploy --only functions:whatsappWebhookVisasBot,functions:crmWhatsAppVisasBot`
6. En la web, copie `config/whatsapp.example.php` como `config/whatsapp.local.php` y coloque la MISMA clave en `WHATSAPP_BOT_API_KEY`.

## Function de CRM

URL esperada:
`https://us-central1-tramite-visa-vaneza-boot.cloudfunctions.net/crmWhatsAppVisasBot`

La Function exige el header `X-Admin-Key` y además valida en BD que una asesora solo responda una conversación que tenga asignada.

## Importante

La conexión MySQL remota debe seguir permitiendo el acceso de las Functions de Firebase. Para producción es preferible usar una salida con IP estática y permitir únicamente esa IP en MySQL.
