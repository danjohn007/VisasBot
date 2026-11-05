import { SERVICE_BY_CODE } from "../config/services.js";
import { detectServiceFromText, isAdvisorRequest, isGreetingOrInfoRequest, isMenuCommand } from "../utils/intent.js";

export function resolveAction({ parsed, session, contact }) {
  const state = session?.state || "MENU_PRINCIPAL";

  // Mientras una asesora atiende la conversación el bot permanece totalmente en pausa.
  if (Number(session?.human_handoff || 0) === 1 || state === "ASESOR_SOLICITADO") {
    return { type: "NO_AUTO_REPLY", reason: "human_handoff" };
  }

  // El nombre y apellido se solicitan una sola vez antes de mostrar el menú.
  if (!contact?.name_captured) {
    if (state === "ESPERANDO_NOMBRE") {
      return { type: "CAPTURE_NAME", reason: "waiting_name" };
    }
    return { type: "ASK_NAME", reason: "name_required" };
  }

  if (parsed?.kind === "text" && isMenuCommand(parsed.text)) {
    return { type: "SHOW_MENU", reset: true, invalid: false, reason: "menu_command" };
  }

  if (parsed?.selectionId === "ACTION_MENU") {
    return { type: "SHOW_MENU", reset: true, invalid: false, reason: "menu_action" };
  }

  if (parsed?.selectionId === "ACTION_COMMERCIAL_CONTINUE") {
    return { type: "COMMERCIAL_CONTINUE", reason: "commercial_continue" };
  }

  if (parsed?.selectionId === "ACTION_COMMERCIAL_DECLINE") {
    return { type: "COMMERCIAL_DECLINE", reason: "commercial_decline" };
  }

  if (parsed?.selectionId === "ACTION_ADD_SERVICE_YES") {
    return { type: "ADD_SERVICE_YES", reason: "additional_service_yes" };
  }

  if (parsed?.selectionId === "ACTION_ADD_SERVICE_NO") {
    return { type: "ADD_SERVICE_NO", reason: "additional_service_no" };
  }

  if (parsed?.selectionId === "ACTION_REQUEST_ADVISOR") {
    return { type: "REQUEST_ADVISOR", reason: "advisor_action" };
  }

  if (parsed?.selectionId && SERVICE_BY_CODE[parsed.selectionId]) {
    return { type: "SELECT_SERVICE", serviceCode: parsed.selectionId, reason: "interactive_selection" };
  }

  if (state === "PREGUNTAR_OTRO_SERVICIO" && parsed?.kind === "text") {
    const answer = String(parsed.text || "").trim().toLowerCase();
    if (["si", "sí", "claro", "ok", "de acuerdo"].includes(answer)) {
      return { type: "ADD_SERVICE_YES", reason: "additional_service_yes_text" };
    }
    if (["no", "no gracias", "por ahora no"].includes(answer)) {
      return { type: "ADD_SERVICE_NO", reason: "additional_service_no_text" };
    }
    return { type: "ASK_ADDITIONAL_SERVICE_AGAIN", reason: "additional_service_invalid" };
  }

  if (parsed?.kind === "text" && isAdvisorRequest(parsed.text)) {
    return { type: "REQUEST_ADVISOR", reason: "advisor_text" };
  }

  if (state === "PERFILANDO") {
    return { type: "CONTINUE_PROFILE", reason: "profile_input" };
  }

  if (state === "PERFIL_COMPLETO") {
    return { type: "PROFILE_COMPLETE_HELP", reason: "profile_complete" };
  }

  if (state === "CLIENTE_SEGUIMIENTO") {
    return { type: "FOLLOWUP_HELP", reason: "followup" };
  }

  if (state === "CONVERSACION_CERRADA") {
    if (parsed?.kind === "text" && isGreetingOrInfoRequest(parsed.text)) {
      return { type: "SHOW_MENU", reset: true, invalid: false, reason: "reopen_by_greeting" };
    }
    return { type: "SHOW_MENU", reset: true, invalid: false, reason: "reopen_closed" };
  }

  if (parsed?.kind === "text") {
    const serviceCode = detectServiceFromText(parsed.text);
    if (serviceCode) return { type: "SELECT_SERVICE", serviceCode, reason: "text_service_detection" };

    if (state === "PENDIENTE_FLUJO") {
      return { type: "STAY_IN_SELECTED_SERVICE", serviceCode: session?.service_code || null };
    }

    if (state === "MENU_PRINCIPAL") {
      const greeting = isGreetingOrInfoRequest(parsed.text);
      if (greeting && contact?._is_new_contact === false) {
        return { type: "RETURNING_CLIENT_HOME", reason: "returning_contact_greeting" };
      }
      return { type: "SHOW_MENU", reset: true, invalid: !greeting, reason: greeting ? "greeting" : "invalid_menu_text" };
    }

    return { type: "SHOW_MENU", reset: true, invalid: true, reason: "unknown_state" };
  }

  if (state === "PENDIENTE_FLUJO") {
    return { type: "STAY_IN_SELECTED_SERVICE", serviceCode: session?.service_code || null };
  }

  return { type: "SHOW_MENU", reset: true, invalid: true, reason: "unsupported_message" };
}
