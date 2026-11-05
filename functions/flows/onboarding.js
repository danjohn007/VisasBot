import { saveCapturedContactName, setSessionState } from "../db/repository.js";
import { sendText } from "../whatsapp/sender.js";
import { showMainMenu } from "./mainMenu.js";

const WELCOME = `👋 ¡Hola! Gracias por comunicarse con TRÁMITE DE VISA AMERICANA EN QUERÉTARO BY VANEZA TORRES.

Será un placer asistirle. ✈️

Soy el asistente de primer contacto. Puedo registrar el trámite que necesita, recopilar información inicial para preparar su atención y, cuando usted lo solicite, pasar la conversación a una asesora.

¿Con quién tengo el gusto?
Por favor, indíqueme su nombre y apellido.`;

function normalizeName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validName(value) {
  const name = normalizeName(value);
  if (name.length < 5 || name.length > 150) return false;
  const parts = name.split(" ").filter(Boolean);
  if (parts.length < 2) return false;
  return parts.every((part) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’.-]{2,}$/.test(part));
}

export async function askContactName(ctx) {
  await setSessionState(ctx.pool, ctx.contact.id, "ESPERANDO_NOMBRE");
  if (ctx.session) ctx.session.state = "ESPERANDO_NOMBRE";
  await sendText(ctx.sendArgs, WELCOME);
  return true;
}

export async function captureContactName(ctx) {
  if (ctx.parsed?.kind !== "text" || !validName(ctx.parsed?.text)) {
    await sendText(
      ctx.sendArgs,
      "Para continuar, por favor escríbame su nombre y apellido.\nEjemplo: Daniel Hernández."
    );
    return true;
  }

  const fullName = normalizeName(ctx.parsed.text);
  await saveCapturedContactName(ctx.pool, { contactId: ctx.contact.id, fullName });
  if (ctx.contact) {
    ctx.contact.profile_name = fullName;
    ctx.contact.name_captured = true;
  }
  if (ctx.session) ctx.session.state = "MENU_PRINCIPAL";

  await sendText(ctx.sendArgs, `¡Mucho gusto, ${fullName}! 😊`);
  await showMainMenu(ctx, {
    reset: true,
    intro: "Seleccione el trámite o servicio sobre el cual desea recibir atención:",
  });
  return true;
}
