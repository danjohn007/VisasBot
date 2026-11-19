import assert from "node:assert/strict";
import { getIncomingMessageData } from "../whatsapp/parser.js";
import { resolveAction } from "../flows/router.js";
import { makeProfileOptionId, parseProfileOptionId } from "../config/firstContact.js";
import { isGerenciaPassportService } from "../db/repository.js";

function route(message, session = { state: "MENU_PRINCIPAL", human_handoff: 0, service_code: null }, contact = { name_captured: 1, _is_new_contact: false }) {
  return resolveAction({ parsed: getIncomingMessageData(message), session, contact });
}

const ids = [
  "01_VISA_USA_PRIMERA_VEZ","02_VISA_USA_RENOVACION","03_PASAPORTE_MEXICANO",
  "04_PASAPORTE_AMERICANO","05_VISA_CANADA","06_ETA_CANADA","07_VISA_AUSTRALIA",
  "08_VISA_CHINA","09_ACTA_NACIMIENTO","10_CLIENTE_SEGUIMIENTO","11_ASESOR"
];
for (const id of ids) {
  const msg = id === "10_CLIENTE_SEGUIMIENTO" || id === "11_ASESOR"
    ? { type: "interactive", interactive: { button_reply: { id, title: id } } }
    : { type: "interactive", interactive: { list_reply: { id, title: id } } };
  const action = route(msg);
  assert.equal(action.type, "SELECT_SERVICE", `${id} must select service`);
  assert.equal(action.serviceCode, id);
}

let action = route(
  { type: "text", text: { body: "Querétaro, Querétaro" } },
  { state: "PERFILANDO", human_handoff: 0, service_code: "05_VISA_CANADA" }
);
assert.equal(action.type, "CONTINUE_PROFILE");

action = route(
  { type: "interactive", interactive: { button_reply: { id: "ACTION_REQUEST_ADVISOR", title: "Hablar con asesor" } } },
  { state: "PERFIL_COMPLETO", human_handoff: 0, service_code: "05_VISA_CANADA" }
);
assert.equal(action.type, "REQUEST_ADVISOR");

action = route(
  { type: "text", text: { body: "quiero hablar con una asesora" } },
  { state: "PERFILANDO", human_handoff: 0, service_code: "05_VISA_CANADA" }
);
assert.equal(action.type, "REQUEST_ADVISOR");

action = route(
  { type: "text", text: { body: "MENÚ" } },
  { state: "ASESOR_SOLICITADO", human_handoff: 1, service_code: "05_VISA_CANADA" }
);
assert.equal(action.type, "NO_AUTO_REPLY");

action = route(
  { type: "text", text: { body: "aquí sigo" } },
  { state: "ASESOR_SOLICITADO", human_handoff: 1, service_code: "05_VISA_CANADA" }
);
assert.equal(action.type, "NO_AUTO_REPLY");

// Regresión: al tomar una conversación desde CRM, bot_conversations.mode=HUMAN
// es la fuente de verdad aunque la sesión todavía no esté sincronizada.
const humanMessages = [
  {type:'text',text:{body:'MENÚ'}},
  {type:'text',text:{body:'Necesito información'}},
  {type:'interactive',interactive:{list_reply:{id:'03_PASAPORTE_MEXICANO',title:'Pasaporte'}}}
];
for (const message of humanMessages) {
  const parsed = getIncomingMessageData(message);
  assert.equal(resolveAction({parsed, session:{state:'MENU_PRINCIPAL',human_handoff:0},
    contact:{name_captured:1}, conversation:{mode:'HUMAN',status:'IN_PROGRESS'}}).type,
    'NO_AUTO_REPLY', 'No responder cuando está atendiendo una asesora');
  assert.notEqual(resolveAction({parsed, session:{state:'MENU_PRINCIPAL',human_handoff:0},
    contact:{name_captured:1}, conversation:{mode:'BOT',status:'OPEN'}}).type,
    'NO_AUTO_REPLY', 'Reactivar únicamente cuando se devuelve al bot');
}

assert.equal(isGerenciaPassportService("03_PASAPORTE_MEXICANO"), true);
assert.equal(isGerenciaPassportService("04_PASAPORTE_AMERICANO"), true);
assert.equal(isGerenciaPassportService("01_VISA_USA_PRIMERA_VEZ"), false);
assert.equal(isGerenciaPassportService("06_ETA_CANADA"), false);

// Sin nombre capturado, el primer paso sigue siendo solicitar nombre aunque
// el mensaje ya contenga una selección de servicio.
action = route(
  { type: "interactive", interactive: { list_reply: { id: "03_PASAPORTE_MEXICANO", title: "Pasaporte Mexicano" } } },
  { state: "MENU_PRINCIPAL", human_handoff: 0, service_code: null },
  { name_captured: 0, _is_new_contact: true }
);
assert.equal(action.type, "ASK_NAME");

const optionId = makeProfileOptionId("age_group", "ADULT");
assert.deepEqual(parseProfileOptionId(optionId), { stepKey: "age_group", value: "ADULT" });

console.log("OK: routing + hybrid first-contact tests passed");
