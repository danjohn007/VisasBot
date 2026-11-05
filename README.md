# VisasBot – Etapa 1 (flujo corregido)

Esta versión corrige el problema en el que una selección válida de lista/botón terminaba mostrando otra vez el menú principal.

## Flujo implementado

1. Saludo o solicitud genérica -> MENÚ PRINCIPAL.
2. Opciones 1-9 -> registra `service_code`, deja `state=PENDIENTE_FLUJO` y confirma el servicio. NO vuelve al menú.
3. Opción 10 -> `state=CLIENTE_SEGUIMIENTO`; intenta vincular cliente/trámite sin entrar a flujo comercial.
4. Opción 11 -> `state=ASESOR_SOLICITADO`, `human_handoff=1`; el bot deja de contestar automáticamente.
5. `MENÚ`, `Menú principal`, `Regresar al menú`, `Inicio`, `Cambiar trámite` -> vuelve al menú desde cualquier estado.
6. Entrada no válida estando en el menú -> mensaje de opción no válida + menú.
7. Entrada cualquiera estando en `PENDIENTE_FLUJO` -> conserva el flujo seleccionado; no reinicia.

## Corrección clave

La versión anterior usaba el menú completo como contingencia para cualquier excepción interna. Si fallaba `selectService()` en MySQL, una opción válida parecía comportarse como si el usuario hubiera pedido volver al inicio. Esta versión separa:

- error de bootstrap de BD -> menú de contingencia;
- error al guardar una selección -> mensaje técnico y el flujo NO se reinicia;
- opción inválida real -> mensaje de opción inválida + menú.

## Instalación

1. Respaldar la BD.
2. Importar `sql/03_reparacion_schema_etapa1.sql` en la misma BD configurada en `DB_NAME_VISASBOT`.
3. En `functions/` ejecutar:
   - `npm install`
   - `npm test`
4. Verificar proyecto Firebase: `firebase use` debe ser `tramite-visa-vaneza-boot`.
5. Desplegar: `firebase deploy --only functions:whatsappWebhookVisasBot`

## Prueba mínima

- `Hola` -> muestra bienvenida + lista + botones.
- Elegir `Visa USA - Primera vez` -> responde confirmación de ese servicio, no menú.
- Elegir `Ya soy cliente` -> seguimiento, no menú comercial.
- Elegir `Hablar con asesor` -> mensaje de atención humana y luego silencio automático.
- Escribir `MENÚ` -> vuelve al menú principal.
