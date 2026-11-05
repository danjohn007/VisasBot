import * as logger from "firebase-functions/logger";
import { SERVICE_BY_CODE } from "../config/services.js";
import {
  addConversationEvent,
  closeCommercialConversation,
  createAdminEvent,
  requestHumanHandoff,
  setSessionState,
  selectService,
  setCommercialInterest,
  tryLinkExistingClient,
} from "../db/repository.js";
import { sendReplyButtons, sendText } from "../whatsapp/sender.js";
import { startFirstContact } from "./firstContact.js";
import { showMainMenu } from "./mainMenu.js";

function dbErrorLog(error, serviceCode, contactId) {
  logger.error("SERVICE_SELECTION_DB_ERROR", {
    serviceCode,
    contactId,
    code: error?.code || null,
    errno: error?.errno || null,
    sqlState: error?.sqlState || null,
    sqlMessage: error?.sqlMessage || error?.message || null,
  });
}

export async function requestAdvisor(
  ctx,
  reason = "El usuario solicitó hablar con una asesora.",
  { commercialInterest = false } = {}
) {
  const resumeState = ctx.session?.state && ctx.session.state !== "ASESOR_SOLICITADO"
    ? ctx.session.state
    : "PERFIL_COMPLETO";

  if (commercialInterest) {
    await setCommercialInterest(ctx.pool, {
      contactId: ctx.contact.id,
      decision: "SI",
    });
  }

  await requestHumanHandoff(ctx.pool, {
    contactId: ctx.contact.id,
    reason,
    resumeState,
  });

  if (ctx.session) {
    ctx.session.state = "ASESOR_SOLICITADO";
    ctx.session.human_handoff = 1;
  }

  if (ctx.conversation) {
    ctx.conversation.mode = "HUMAN";
    ctx.conversation.status = "WAITING_HUMAN";
  }

  await addConversationEvent(ctx.pool, {
    conversationId: ctx.conversation.id,
    eventType: "HANDOFF_REQUESTED",
    actorName: ctx.contact.profile_name || "Cliente",
    actorRole: "Cliente",
    detail: reason,
    metadata: { service_code: ctx.session?.service_code || ctx.contact?.service_code || null },
  });

  await createAdminEvent(ctx.pool, {
    contactId: ctx.contact.id,
    waId: ctx.contact.wa_id,
    profileName: ctx.contact.profile_name,
    serviceCode: ctx.session?.service_code || ctx.contact?.service_code || null,
    action: commercialInterest ? "interes_iniciar_tramite" : "nuevo_contacto",
    description: commercialInterest
      ? "Prospecto interesado en iniciar su trámite o consultar costos. Requiere atención de una asesora en este mismo chat."
      : "El contacto solicita atención humana desde WhatsApp.",
    priority: "alta",
    metadata: commercialInterest ? { interes_continuar: "SI" } : null,
  });

  await sendText(
    ctx.sendArgs,
    commercialInterest
      ? "¡Perfecto! 😊 En unos momentos una de nuestras asesoras se pondrá en contacto con usted por este mismo chat para brindarle costos, resolver sus dudas y, si lo desea, iniciar su trámite.\n\nPuede escribir aquí con normalidad. El bot quedará en pausa mientras recibe atención de la asesora."
      : "Con gusto. 😊 Su conversación quedó en espera para atención humana. En breve, una de nuestras asesoras podrá tomarla desde el CRM. Mientras esté en atención humana, el bot no intervendrá en sus mensajes."
  );
  return true;
}

export async function askAdditionalService(ctx) {
  await setCommercialInterest(ctx.pool, {
    contactId: ctx.contact.id,
    decision: "SI",
  });
  await setSessionState(ctx.pool, ctx.contact.id, "PREGUNTAR_OTRO_SERVICIO");
  if (ctx.session) ctx.session.state = "PREGUNTAR_OTRO_SERVICIO";

  await sendReplyButtons(ctx.sendArgs, {
    body: "Antes de pasar su conversación con una asesora, ¿desea realizar o solicitar información de algún otro trámite o servicio?",
    buttons: [
      { id: "ACTION_ADD_SERVICE_YES", title: "Sí, otro trámite" },
      { id: "ACTION_ADD_SERVICE_NO", title: "No, continuar" },
    ],
    textForLog: "Pregunta de trámite o servicio adicional",
  });
  return true;
}

export async function showAdditionalServiceQuestion(ctx) {
  return askAdditionalService(ctx);
}

export async function startAdditionalService(ctx) {
  await addConversationEvent(ctx.pool, {
    conversationId: ctx.conversation.id,
    eventType: "ADDITIONAL_SERVICE_REQUESTED",
    actorName: ctx.contact.profile_name || "Cliente",
    actorRole: "Cliente",
    detail: "El prospecto desea registrar otro trámite antes de pasar con una asesora.",
  });

  await showMainMenu(ctx, {
    reset: true,
    intro: "Perfecto. El trámite que ya registró se conservará. Seleccione ahora el trámite o servicio adicional que desea consultar:",
  });
  return true;
}

export async function finishAdditionalServiceSelection(ctx) {
  return requestAdvisor(
    ctx,
    "El prospecto terminó su perfilamiento y no desea agregar otro trámite. Solicita continuar con una asesora.",
    { commercialInterest: true }
  );
}

export async function declineCommercialContinue(ctx) {
  await setCommercialInterest(ctx.pool, {
    contactId: ctx.contact.id,
    decision: "NO",
  });

  await closeCommercialConversation(ctx.pool, {
    contactId: ctx.contact.id,
    conversationId: ctx.conversation.id,
  });

  if (ctx.session) {
    ctx.session.state = "CONVERSACION_CERRADA";
    ctx.session.human_handoff = 0;
  }

  if (ctx.conversation) {
    ctx.conversation.mode = "BOT";
    ctx.conversation.status = "CLOSED";
  }

  await addConversationEvent(ctx.pool, {
    conversationId: ctx.conversation.id,
    eventType: "COMMERCIAL_DECLINED",
    actorName: ctx.contact.profile_name || "Cliente",
    actorRole: "Cliente",
    detail: "El prospecto indicó que no desea continuar por ahora.",
    metadata: {
      service_code: ctx.session?.service_code || ctx.contact?.service_code || null,
      interes_continuar: "NO",
    },
  });

  await sendText(
    ctx.sendArgs,
    "Muchas gracias por comunicarse con nosotros. 😊\n\nCuando lo desee, puede volver a escribirnos por este mismo chat para iniciar nuevamente la conversación. ¡Será un gusto atenderle!"
  );

  return true;
}

function uniqueTrackedItems(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = `${item?.folio || ""}|${item?.service_code || ""}|${item?.id || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function showReturningClientHome(ctx, { selectedFollowup = false } = {}) {
  let linked = null;
  try {
    linked = await tryLinkExistingClient(ctx.pool, ctx.contact);
  } catch (error) {
    logger.error("RETURNING_CLIENT_LINK_ERROR", {
      contactId: ctx.contact?.id,
      code: error?.code || null,
      errno: error?.errno || null,
      sqlState: error?.sqlState || null,
      sqlMessage: error?.sqlMessage || error?.message || null,
    });
  }

  const applications = uniqueTrackedItems(linked?.applications || (linked?.application ? [linked.application] : []));
  const services = linked?.services || [];

  if (!applications.length && !services.length) {
    if (selectedFollowup) {
      await sendText(
        ctx.sendArgs,
        "No pude vincular automáticamente un trámite previo con este número. No se preocupe: una asesora puede revisar sus datos manualmente, o puede iniciar un trámite adicional desde el menú."
      );
      await sendReplyButtons(ctx.sendArgs, {
        body: "¿Cómo desea continuar?",
        buttons: [
          { id: "ACTION_REQUEST_ADVISOR", title: "Hablar con asesora" },
          { id: "ACTION_MENU", title: "Ver otros trámites" },
        ],
        textForLog: "Opciones de seguimiento sin vínculo automático",
      });
      return true;
    }

    await showMainMenu(ctx, {
      reset: true,
      intro: `¡Hola de nuevo${ctx.contact?.profile_name ? `, ${ctx.contact.profile_name}` : ""}! 😊\n\nNo encontré un perfilamiento previo para mostrarle. Seleccione el trámite o servicio que desea consultar:`,
    });
    return true;
  }

  const lines = [];

  for (const app of applications.slice(0, 5)) {
    const type = [app.type, app.subtype].filter(Boolean).join(" - ");
    lines.push(
      `• ${type || "Trámite"}${app.folio ? `\n  Folio: ${app.folio}` : ""}${app.status ? `\n  Estado: ${app.status}` : ""}`
    );
  }

  for (const item of services.slice(0, 8)) {
    const serviceName = SERVICE_BY_CODE[item.service_code]?.name || item.service_name || item.service_code;
    if (serviceName) {
      lines.push(`• ${serviceName}\n  Información/perfilamiento registrado`);
    }
  }

  await sendText(
    ctx.sendArgs,
    `¡Hola de nuevo${ctx.contact?.profile_name ? `, ${ctx.contact.profile_name}` : ""}! 👋\n\nEncontré la siguiente información registrada con este número:\n\n${lines.join("\n\n")}\n\nEstos registros se conservarán aunque decida consultar otro servicio.`
  );

  await sendReplyButtons(ctx.sendArgs, {
    body: "¿Desea dar seguimiento a lo que ya tiene registrado o iniciar/consultar otro trámite adicional?",
    buttons: [
      { id: "ACTION_REQUEST_ADVISOR", title: "Dar seguimiento" },
      { id: "ACTION_MENU", title: "Otro trámite" },
    ],
    textForLog: "Opciones para cliente con historial",
  });

  return true;
}

export async function handleServiceSelection(ctx, serviceCode) {
  const service = SERVICE_BY_CODE[serviceCode];
  if (!service) return false;

  if (serviceCode === "11_ASESOR") {
    return requestAdvisor(ctx, "El usuario eligió “Hablar con un asesor” en el menú principal.");
  }

  try {
    const persisted = await selectService(ctx.pool, { contactId: ctx.contact.id, service });
    if (ctx.session) {
      ctx.session.state = persisted.state;
      ctx.session.flow_code = service.flowKey;
      ctx.session.service_code = service.code;
      ctx.session.human_handoff = 0;
    }
    if (ctx.contact) ctx.contact.service_code = service.code;
    if (ctx.conversation) {
      ctx.conversation.service_code = service.code;
      ctx.conversation.mode = "BOT";
      ctx.conversation.status = "OPEN";
    }
  } catch (error) {
    dbErrorLog(error, serviceCode, ctx.contact?.id);
    await sendText(
      ctx.sendArgs,
      `Recibimos su selección de ${service.name}, pero en este momento no fue posible registrarla en el sistema. Por favor intente nuevamente en unos minutos o escriba “hablar con asesor”.\n\nNo es necesario volver a iniciar la conversación.`
    );
    return true;
  }

  await addConversationEvent(ctx.pool, {
    conversationId: ctx.conversation.id,
    eventType: "SERVICE_SELECTED",
    actorName: ctx.contact.profile_name || "Cliente",
    actorRole: "Cliente",
    detail: `Servicio seleccionado: ${service.name}.`,
    metadata: { service_code: service.code },
  });

  if (serviceCode === "10_CLIENTE_SEGUIMIENTO") {
    await createAdminEvent(ctx.pool, {
      contactId: ctx.contact.id,
      waId: ctx.contact.wa_id,
      profileName: ctx.contact.profile_name,
      serviceCode,
      description: "Cliente solicita seguimiento por WhatsApp.",
      priority: "alta",
    });

    return showReturningClientHome(ctx, { selectedFollowup: true });
  }

  await createAdminEvent(ctx.pool, {
    contactId: ctx.contact.id,
    waId: ctx.contact.wa_id,
    profileName: ctx.contact.profile_name,
    serviceCode,
    description: `Nuevo prospecto de WhatsApp interesado en: ${service.name}.`,
    priority: "normal",
  });

  // No borramos respuestas previas: así los trámites ya perfilados permanecen guardados
  // cuando el prospecto decide registrar un servicio adicional.
  return startFirstContact(ctx, service.code);
}
