import assert from "node:assert/strict";
import { getIncomingMessageData } from "../whatsapp/parser.js";
import { resolveAction } from "../flows/router.js";
import { makeProfileOptionId, parseProfileOptionId } from "../config/firstContact.js";

function route(message, session = { state: "MENU_PRINCIPAL", human_handoff: 0, service_code: null }) {
  return resolveAction({ parsed: getIncomingMessageData(message), session });
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
assert.equal(action.type, "SHOW_MENU");
assert.equal(action.invalid, false);

action = route(
  { type: "text", text: { body: "aquí sigo" } },
  { state: "ASESOR_SOLICITADO", human_handoff: 1, service_code: "05_VISA_CANADA" }
);
assert.equal(action.type, "NO_AUTO_REPLY");

const optionId = makeProfileOptionId("age_group", "ADULT");
assert.deepEqual(parseProfileOptionId(optionId), { stepKey: "age_group", value: "ADULT" });

console.log("OK: routing + hybrid first-contact tests passed");
