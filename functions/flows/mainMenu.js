import * as logger from "firebase-functions/logger";
import { addConversationEvent, resetToMainMenu } from "../db/repository.js";
import { sendServiceList, sendSupportButtons, sendText } from "../whatsapp/sender.js";

const MENU_INTRO = `Seleccione el trámite o servicio sobre el cual desea recibir atención:`;

const INVALID = `No logré identificar el servicio que requiere. Por favor, seleccione una de las opciones disponibles en nuestro menú principal para poder brindarle la información correcta. 😊`;

export async function showMainMenu(ctx, { reset = true, invalid = false, intro = MENU_INTRO } = {}) {
  if (reset) {
    try {
      await resetToMainMenu(ctx.pool, ctx.contact.id);
      if (ctx.session) {
        ctx.session.state = "MENU_PRINCIPAL";
        ctx.session.flow_code = null;
        ctx.session.service_code = null;
        ctx.session.human_handoff = 0;
      }
      if (ctx.conversation) {
        ctx.conversation.mode = "BOT";
        ctx.conversation.status = "OPEN";
        ctx.conversation.service_code = null;
      }
      if (ctx.conversation?.id) {
        await addConversationEvent(ctx.pool, {
          conversationId: ctx.conversation.id,
          eventType: "MENU_OPENED",
          actorName: ctx.contact.profile_name || "Cliente",
          actorRole: "Cliente",
          detail: "El usuario regresó al menú principal.",
        });
      }
    } catch (error) {
      logger.error("MENU_RESET_DB_ERROR", {
        contactId: ctx.contact?.id,
        code: error?.code || null,
        errno: error?.errno || null,
        sqlState: error?.sqlState || null,
        sqlMessage: error?.sqlMessage || error?.message || null,
      });
      throw error;
    }
  }

  if (invalid) await sendText(ctx.sendArgs, INVALID);
  if (intro) await sendText(ctx.sendArgs, intro);
  await sendServiceList(ctx.sendArgs);
  await sendSupportButtons(ctx.sendArgs);
}
