// =========================================================
// VISASBOT V2 - WHATSAPP + CRM HÍBRIDO
// Firebase Functions 2nd Gen / Node.js 22 / ESM
// - Bot de primer contacto
// - Handoff BOT <-> HUMANO
// - Bandeja CRM para administradores y asesoras
// - Historial inmutable de mensajes e intervenciones
// =========================================================

import crypto from "node:crypto";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import mysql from "mysql2/promise";

import {
  addConversationEvent,
  closeConversation,
  getConversationById,
  getCapturedContactName,
  getOrCreateContact,
  getOrCreateConversation,
  getOrCreateSession,
  releaseConversationToBot,
  saveInboundMessage,
  takeConversation,
} from "./db/repository.js";
import { getIncomingMessageData } from "./whatsapp/parser.js";
import { showMainMenu } from "./flows/mainMenu.js";
import { askAdditionalService, declineCommercialContinue, finishAdditionalServiceSelection, handleServiceSelection, requestAdvisor, showAdditionalServiceQuestion, showReturningClientHome, startAdditionalService } from "./flows/serviceSelection.js";
import { continueFirstContact, showProfileCompleteHelp } from "./flows/firstContact.js";
import { resolveAction } from "./flows/router.js";
import { askContactName, captureContactName } from "./flows/onboarding.js";
import { SERVICE_BY_CODE } from "./config/services.js";
import { sendReplyButtons, sendTemplate, sendText } from "./whatsapp/sender.js";

const VERIFY_TOKEN = defineSecret("VERIFY_TOKEN_VISASBOT");
const WHATSAPP_TOKEN = defineSecret("WHATSAPP_TOKEN_VISASBOT");
const WHATSAPP_PHONE_NUMBER_ID = defineSecret("WHATSAPP_PHONE_NUMBER_ID_VISASBOT");
const DB_HOST = defineSecret("DB_HOST_VISASBOT");
const DB_USER = defineSecret("DB_USER_VISASBOT");
const DB_PASSWORD = defineSecret("DB_PASSWORD_VISASBOT");
const DB_NAME = defineSecret("DB_NAME_VISASBOT");
const WEB_ADMIN_KEY = defineSecret("WEB_ADMIN_KEY_VISASBOT");

let pool = null;

function getPool(cfg) {
  if (!pool) {
    pool = mysql.createPool({
      host: String(cfg.DB_HOST || "").trim(),
      user: String(cfg.DB_USER || "").trim(),
      password: cfg.DB_PASSWORD,
      database: String(cfg.DB_NAME || "").trim(),
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      timezone: "Z",
      charset: "utf8mb4",
    });
    logger.info("Pool MySQL inicializado.");
  }
  return pool;
}

function buildConfig({ includeVerify = false, includeWebKey = false } = {}) {
  const cfg = {
    WHATSAPP_TOKEN: WHATSAPP_TOKEN.value(),
    WHATSAPP_PHONE_NUMBER_ID: WHATSAPP_PHONE_NUMBER_ID.value(),
    DB_HOST: DB_HOST.value(),
    DB_USER: DB_USER.value(),
    DB_PASSWORD: DB_PASSWORD.value(),
    DB_NAME: DB_NAME.value(),
  };
  if (includeVerify) cfg.VERIFY_TOKEN = VERIFY_TOKEN.value();
  if (includeWebKey) cfg.WEB_ADMIN_KEY = WEB_ADMIN_KEY.value();
  return cfg;
}

function errorDetails(error) {
  return {
    name: error?.name || null,
    code: error?.code || null,
    errno: error?.errno || null,
    sqlState: error?.sqlState || null,
    sqlMessage: error?.sqlMessage || null,
    message: error?.message || String(error),
    status: error?.response?.status || null,
    data: error?.response?.data || null,
  };
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function sendBootstrapFallback({ cfg, msg }) {
  const to = msg?.from;
  if (!to) return;
  const { sendText: sendPlain, sendServiceList, sendSupportButtons } = await import("./whatsapp/sender.js");
  const args = {
    pool: null,
    contactId: null,
    conversationId: null,
    to,
    token: cfg.WHATSAPP_TOKEN,
    phoneNumberId: cfg.WHATSAPP_PHONE_NUMBER_ID,
  };
  await sendPlain(args, "👋 ¡Hola! Gracias por comunicarse con TRÁMITE DE VISA AMERICANA EN QUERÉTARO BY VANEZA TORRES.\n\nEn este momento no pudimos guardar su conversación en el CRM, pero puede consultar el menú mientras restablecemos la conexión.");
  await sendServiceList(args);
  await sendSupportButtons(args);
}

async function processIncomingMessage({ cfg, db, value, msg }) {
  const from = msg?.from;
  if (!from) return;

  const profileName = value?.contacts?.[0]?.profile?.name || null;
  const parsed = getIncomingMessageData(msg);

  let contact;
  let session;
  let conversation;
  try {
    contact = await getOrCreateContact(db, { waId: from, phone: from, profileName });
    session = await getOrCreateSession(db, contact.id);
    conversation = await getOrCreateConversation(db, contact.id);
    const capturedName = await getCapturedContactName(db, contact.id);

    // Contactos ya existentes de versiones anteriores no deben volver a
    // pasar por la captura de nombre. Los contactos realmente nuevos sí.
    contact.name_captured = Boolean(capturedName) || contact._is_new_contact === false;
    if (capturedName) contact.profile_name = capturedName;

    const isNewMessage = await saveInboundMessage(db, {
      contactId: contact.id,
      conversationId: conversation.id,
      metaMessageId: msg?.id || null,
      messageType: parsed?.kind || msg?.type || "unknown",
      text: parsed?.text || null,
      payload: msg,
    });

    if (!isNewMessage) {
      logger.info("Mensaje duplicado ignorado.", { messageId: msg?.id, from });
      return;
    }
  } catch (error) {
    const details = errorDetails(error);
    logger.error("BOOTSTRAP_DB_ERROR", { ...details, messageId: msg?.id, from });
    await sendBootstrapFallback({ cfg, msg });
    return;
  }

  const sendArgs = {
    pool: db,
    contactId: contact.id,
    conversationId: conversation.id,
    to: from,
    token: cfg.WHATSAPP_TOKEN,
    phoneNumberId: cfg.WHATSAPP_PHONE_NUMBER_ID,
  };
  const ctx = { cfg, pool: db, contact, session, conversation, parsed, sendArgs };
  const action = resolveAction({ parsed, session, contact });

  logger.info("FLOW_ROUTE", {
    messageId: msg?.id,
    from,
    parsedKind: parsed?.kind,
    selectionId: parsed?.selectionId || null,
    sessionState: session?.state,
    conversationStatus: conversation?.status,
    action: action.type,
    serviceCode: action.serviceCode || null,
    reason: action.reason || null,
  });

  switch (action.type) {
    case "ASK_NAME":
      await askContactName(ctx);
      return;

    case "CAPTURE_NAME":
      await captureContactName(ctx);
      return;

    case "SHOW_MENU":
      await showMainMenu(ctx, { reset: action.reset, invalid: action.invalid });
      return;

    case "RETURNING_CLIENT_HOME":
      await showReturningClientHome(ctx);
      return;

    case "SELECT_SERVICE":
      await handleServiceSelection(ctx, action.serviceCode);
      return;

    case "COMMERCIAL_CONTINUE":
      await askAdditionalService(ctx);
      return;

    case "ADD_SERVICE_YES":
      await startAdditionalService(ctx);
      return;

    case "ADD_SERVICE_NO":
      await finishAdditionalServiceSelection(ctx);
      return;

    case "ASK_ADDITIONAL_SERVICE_AGAIN":
      await showAdditionalServiceQuestion(ctx);
      return;

    case "COMMERCIAL_DECLINE":
      await declineCommercialContinue(ctx);
      return;

    case "REQUEST_ADVISOR":
      await requestAdvisor(ctx, action.reason === "advisor_text"
        ? "El usuario escribió que desea hablar con una asesora."
        : "El usuario solicitó atención humana desde el bot.");
      return;

    case "CONTINUE_PROFILE":
      await continueFirstContact(ctx);
      return;

    case "PROFILE_COMPLETE_HELP":
      await showProfileCompleteHelp(ctx);
      return;

    case "FOLLOWUP_HELP":
      await sendReplyButtons(sendArgs, {
        body: "Su solicitud de seguimiento ya está registrada. Puede pedir atención de una asesora o volver al menú principal.",
        buttons: [
          { id: "ACTION_REQUEST_ADVISOR", title: "Hablar con asesor" },
          { id: "ACTION_MENU", title: "Menú principal" },
        ],
        textForLog: "Ayuda de seguimiento",
      });
      return;

    case "NO_AUTO_REPLY":
      logger.info("Conversación en atención humana: mensaje guardado sin respuesta automática.", { contactId: contact.id, conversationId: conversation.id });
      return;

    case "STAY_IN_SELECTED_SERVICE": {
      const service = SERVICE_BY_CODE[action.serviceCode] || null;
      await sendText(
        sendArgs,
        service
          ? `Su trámite seleccionado actualmente es ${service.name}. Continuaremos con el primer contacto. Si desea cambiar de trámite, escriba MENÚ.`
          : "Su servicio ya está seleccionado. Para regresar al menú principal, escriba MENÚ."
      );
      return;
    }

    default:
      logger.warn("Acción de flujo desconocida; se recupera al menú.", { action });
      await showMainMenu(ctx, { reset: true, invalid: true });
  }
}

export const whatsappWebhookVisasBot = onRequest(
  {
    region: "us-central1",
    invoker: "public",
    cors: true,
    secrets: [VERIFY_TOKEN, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, DB_HOST, DB_USER, DB_PASSWORD, DB_NAME],
  },
  async (req, res) => {
    const cfg = buildConfig({ includeVerify: true });

    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      if (mode === "subscribe" && token === cfg.VERIFY_TOKEN) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.status(200).send(String(challenge ?? ""));
      }
      return res.status(403).send("Forbidden");
    }

    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    try {
      const body = req.body;
      if (!body || body.object !== "whatsapp_business_account") return res.sendStatus(200);

      const db = getPool(cfg);
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change?.value;
          if (!value) continue;

          if (Array.isArray(value.statuses) && value.statuses.length) {
            logger.info("Estado de WhatsApp recibido.", {
              status: value.statuses[0]?.status,
              messageId: value.statuses[0]?.id,
            });
          }

          for (const msg of value.messages || []) {
            try {
              await processIncomingMessage({ cfg, db, value, msg });
            } catch (messageError) {
              const details = errorDetails(messageError);
              logger.error("MESSAGE_FATAL", { ...details, messageId: msg?.id, from: msg?.from });
              try {
                const args = {
                  pool: null,
                  contactId: null,
                  conversationId: null,
                  to: msg?.from,
                  token: cfg.WHATSAPP_TOKEN,
                  phoneNumberId: cfg.WHATSAPP_PHONE_NUMBER_ID,
                };
                await sendText(args, "Tuvimos un inconveniente interno al procesar su mensaje. Por favor intente nuevamente en unos minutos o escriba MENÚ.");
              } catch (sendError) {
                logger.error("MESSAGE_FATAL_FALLBACK_SEND_ERROR", errorDetails(sendError));
              }
            }
          }
        }
      }
      return res.sendStatus(200);
    } catch (error) {
      logger.error("WEBHOOK_FATAL", errorDetails(error));
      return res.sendStatus(200);
    }
  }
);

export const crmWhatsAppVisasBot = onRequest(
  {
    region: "us-central1",
    invoker: "public",
    cors: true,
    secrets: [WEB_ADMIN_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, DB_HOST, DB_USER, DB_PASSWORD, DB_NAME],
  },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    const cfg = buildConfig({ includeWebKey: true });
    if (!secureEqual(req.get("x-admin-key"), cfg.WEB_ADMIN_KEY)) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const action = String(req.body?.action || "").trim();
    const conversationId = Number(req.body?.conversationId || 0);
    const actorUserId = Number(req.body?.actorUserId || 0);
    const actorName = String(req.body?.actorName || "Usuario CRM").slice(0, 100);
    const actorRole = String(req.body?.actorRole || "").slice(0, 50);

    if (!conversationId || !actorUserId || !["Administrador", "Asesor"].includes(actorRole)) {
      return res.status(400).json({ ok: false, error: "INVALID_ACTOR_OR_CONVERSATION" });
    }

    const db = getPool(cfg);

    try {
      if (action === "take") {
        const conversation = await takeConversation(db, { conversationId, actorUserId, actorName, actorRole });
        return res.json({ ok: true, conversation });
      }

      if (action === "release") {
        const before = await getConversationById(db, conversationId);
        const conversation = await releaseConversationToBot(db, { conversationId, actorUserId, actorName, actorRole });
        if (before) {
          await sendText({
            pool: db,
            contactId: before.contact_id,
            conversationId,
            to: before.wa_id,
            token: cfg.WHATSAPP_TOKEN,
            phoneNumberId: cfg.WHATSAPP_PHONE_NUMBER_ID,
            senderType: "BOT",
          }, "La atención personal ha finalizado y el asistente automático vuelve a estar disponible. Si desea consultar otro trámite, escriba MENÚ.");
        }
        return res.json({ ok: true, conversation });
      }

      if (action === "close") {
        const conversation = await closeConversation(db, { conversationId, actorUserId, actorName, actorRole });
        return res.json({ ok: true, conversation });
      }

      if (action === "send") {
        const text = String(req.body?.message || "").trim();
        if (!text || text.length > 4000) return res.status(400).json({ ok: false, error: "INVALID_MESSAGE" });

        const conversation = await getConversationById(db, conversationId);
        if (!conversation) return res.status(404).json({ ok: false, error: "CONVERSATION_NOT_FOUND" });
        if (conversation.status !== "IN_PROGRESS" || conversation.mode !== "HUMAN") {
          return res.status(409).json({ ok: false, error: "CONVERSATION_NOT_IN_HUMAN_MODE" });
        }
        if (actorRole !== "Administrador" && Number(conversation.assigned_agent_id || 0) !== actorUserId) {
          return res.status(403).json({ ok: false, error: "NOT_ASSIGNED" });
        }

        await sendText({
          pool: db,
          contactId: conversation.contact_id,
          conversationId,
          to: conversation.wa_id,
          token: cfg.WHATSAPP_TOKEN,
          phoneNumberId: cfg.WHATSAPP_PHONE_NUMBER_ID,
          senderType: actorRole === "Administrador" ? "ADMIN" : "AGENT",
          senderUserId: actorUserId,
          senderName: actorName,
          senderRole: actorRole,
        }, text);

        await addConversationEvent(db, {
          conversationId,
          eventType: "STAFF_MESSAGE",
          actorUserId,
          actorName,
          actorRole,
          detail: `${actorName} envió un mensaje desde el CRM.`,
        });
        return res.json({ ok: true });
      }

      if (action === "send_template") {
        const followupMessage = String(req.body?.message || "").trim();
        if (!followupMessage || followupMessage.length > 1000) {
          return res.status(400).json({ ok: false, error: "INVALID_TEMPLATE_MESSAGE" });
        }

        const conversation = await getConversationById(db, conversationId);
        if (!conversation) return res.status(404).json({ ok: false, error: "CONVERSATION_NOT_FOUND" });
        if (conversation.status === "CLOSED") {
          return res.status(409).json({ ok: false, error: "CONVERSATION_CLOSED" });
        }
        if (actorRole !== "Administrador" && Number(conversation.assigned_agent_id || 0) !== actorUserId) {
          return res.status(403).json({ ok: false, error: "NOT_ASSIGNED" });
        }

        const clientName = String(conversation.profile_name || "cliente").trim().slice(0, 120) || "cliente";
        const renderedText = `Hola ${clientName} 👋\n\n${followupMessage}\n\nEsperamos que tenga un excelente día. Si necesita apoyo o desea continuar con su trámite, estamos a sus órdenes.`;

        await sendTemplate({
          pool: db,
          contactId: conversation.contact_id,
          conversationId,
          to: conversation.wa_id,
          token: cfg.WHATSAPP_TOKEN,
          phoneNumberId: cfg.WHATSAPP_PHONE_NUMBER_ID,
          senderType: actorRole === "Administrador" ? "ADMIN" : "AGENT",
          senderUserId: actorUserId,
          senderName: actorName,
          senderRole: actorRole,
        }, {
          name: "seguimiento_tramite_visas",
          languageCode: "es_MX",
          bodyParameters: [clientName, followupMessage],
          textForLog: renderedText,
        });

        await addConversationEvent(db, {
          conversationId,
          eventType: "META_TEMPLATE_SENT",
          actorUserId,
          actorName,
          actorRole,
          detail: `${actorName} envió la plantilla seguimiento_tramite_visas.`,
          metadata: {
            template_name: "seguimiento_tramite_visas",
            template_language: "es_MX",
            variable_1: clientName,
            variable_2: followupMessage,
          },
        });

        return res.json({ ok: true });
      }


      return res.status(400).json({ ok: false, error: "UNKNOWN_ACTION" });
    } catch (error) {
      const details = errorDetails(error);
      logger.error("CRM_WHATSAPP_ERROR", { action, conversationId, actorUserId, actorRole, ...details });
      const status = ["NOT_ASSIGNED", "ADMIN_ONLY"].includes(error?.code) ? 403
        : ["CONVERSATION_NOT_AVAILABLE", "CONVERSATION_ASSIGNED", "CONVERSATION_CLOSED"].includes(error?.code) ? 409
        : error?.code === "CONVERSATION_NOT_FOUND" ? 404
        : 500;
      return res.status(status).json({ ok: false, error: error?.code || "INTERNAL_ERROR", message: error?.message || "Error interno" });
    }
  }
);
