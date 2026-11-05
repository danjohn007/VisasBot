import axios from "axios";
import * as logger from "firebase-functions/logger";
import { saveOutboundMessage } from "../db/repository.js";

function apiUrl(phoneNumberId) {
  const version = process.env.WHATSAPP_GRAPH_VERSION || "v25.0";
  return `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
}

async function sendPayload({
  pool,
  contactId,
  conversationId = null,
  to,
  token,
  phoneNumberId,
  payload,
  messageType,
  textForLog = null,
  senderType = "BOT",
  senderUserId = null,
  senderName = null,
  senderRole = null,
}) {
  const response = await axios.post(
    apiUrl(phoneNumberId),
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      ...payload,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }
  );

  const messageId = response.data?.messages?.[0]?.id || null;

  if (pool && contactId) {
    try {
      await saveOutboundMessage(pool, {
        contactId,
        conversationId,
        metaMessageId: messageId,
        messageType,
        text: textForLog,
        payload,
        senderType,
        senderUserId,
        senderName,
        senderRole,
      });
    } catch (dbLogError) {
      logger.error("OUTBOUND_DB_LOG_ERROR", {
        code: dbLogError?.code || null,
        errno: dbLogError?.errno || null,
        sqlState: dbLogError?.sqlState || null,
        sqlMessage: dbLogError?.sqlMessage || dbLogError?.message || null,
      });
    }
  }

  logger.info("Mensaje enviado a WhatsApp.", { to, messageType, status: response.status, messageId, senderType });
  return response.data;
}

export function sendText(args, text) {
  return sendPayload({
    ...args,
    payload: { type: "text", text: { preview_url: false, body: text } },
    messageType: "text",
    textForLog: text,
  });
}


export function sendTemplate(args, {
  name,
  languageCode = "es_MX",
  bodyParameters = [],
  textForLog = null,
}) {
  const parameters = (bodyParameters || []).map((value) => ({
    type: "text",
    text: String(value ?? "").slice(0, 1024),
  }));

  return sendPayload({
    ...args,
    payload: {
      type: "template",
      template: {
        name: String(name),
        language: { code: String(languageCode) },
        components: [
          {
            type: "body",
            parameters,
          },
        ],
      },
    },
    messageType: "template",
    textForLog,
  });
}

export function sendReplyButtons(args, { body, buttons, header = null, footer = null, textForLog = null }) {
  const safeButtons = (buttons || []).slice(0, 3).map((button) => ({
    type: "reply",
    reply: { id: String(button.id).slice(0, 256), title: String(button.title).slice(0, 20) },
  }));
  const interactive = {
    type: "button",
    body: { text: String(body).slice(0, 1024) },
    action: { buttons: safeButtons },
  };
  if (header) interactive.header = { type: "text", text: String(header).slice(0, 60) };
  if (footer) interactive.footer = { text: String(footer).slice(0, 60) };
  return sendPayload({
    ...args,
    payload: { type: "interactive", interactive },
    messageType: "interactive_buttons",
    textForLog: textForLog || body,
  });
}

export function sendList(args, { header, body, button = "Ver opciones", rows, sectionTitle = "Opciones", footer = null, textForLog = null }) {
  const safeRows = (rows || []).slice(0, 10).map((row) => ({
    id: String(row.id).slice(0, 200),
    title: String(row.title).slice(0, 24),
    ...(row.description ? { description: String(row.description).slice(0, 72) } : {}),
  }));
  const interactive = {
    type: "list",
    header: { type: "text", text: String(header || "Opciones").slice(0, 60) },
    body: { text: String(body).slice(0, 1024) },
    action: {
      button: String(button).slice(0, 20),
      sections: [{ title: String(sectionTitle).slice(0, 24), rows: safeRows }],
    },
  };
  if (footer) interactive.footer = { text: String(footer).slice(0, 60) };
  return sendPayload({
    ...args,
    payload: { type: "interactive", interactive },
    messageType: "interactive_list",
    textForLog: textForLog || body,
  });
}

export function sendServiceList(args) {
  return sendList(args, {
    header: "Servicios disponibles",
    body: "Seleccione el trámite sobre el cual desea recibir información:",
    footer: "También puede escribir MENÚ en cualquier momento.",
    button: "Ver trámites",
    sectionTitle: "Trámites",
    rows: [
      { id: "01_VISA_USA_PRIMERA_VEZ", title: "Visa USA - Primera vez" },
      { id: "02_VISA_USA_RENOVACION", title: "Visa USA - Renovación" },
      { id: "03_PASAPORTE_MEXICANO", title: "Pasaporte mexicano" },
      { id: "04_PASAPORTE_AMERICANO", title: "Pasaporte americano" },
      { id: "05_VISA_CANADA", title: "Visa canadiense" },
      { id: "06_ETA_CANADA", title: "eTA canadiense" },
      { id: "07_VISA_AUSTRALIA", title: "Visa Australia" },
      { id: "08_VISA_CHINA", title: "Visa China" },
      { id: "09_ACTA_NACIMIENTO", title: "Acta de nacimiento" },
    ],
    textForLog: "Menú principal - trámites 1 a 9",
  });
}

export function sendSupportButtons(args) {
  return sendReplyButtons(args, {
    body: "¿Necesita otro tipo de atención?",
    buttons: [
      { id: "10_CLIENTE_SEGUIMIENTO", title: "Ya soy cliente" },
      { id: "11_ASESOR", title: "Hablar con asesor" },
    ],
    textForLog: "Opciones de seguimiento y asesor",
  });
}
