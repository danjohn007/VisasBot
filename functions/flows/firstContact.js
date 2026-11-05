import { normalizeText } from "../utils/normalizeText.js";
import { SERVICE_BY_CODE } from "../config/services.js";
import {
  fallbackStepsForService,
  introForService,
  isSpecializedVisaFlow,
  makeProfileOptionId,
  parseProfileOptionId,
} from "../config/firstContact.js";
import {
  createAdminEvent,
  getFlowSteps,
  getProfileAnswers,
  markProfileComplete,
  setSessionState,
  syncStructuredVisaProfile,
  upsertProfileAnswer,
} from "../db/repository.js";
import { sendList, sendReplyButtons, sendText } from "../whatsapp/sender.js";

function normalizeStepRows(steps) {
  return (steps || []).map((step, index) => ({
    stepKey: step.stepKey || step.step_key,
    prompt: step.prompt || step.prompt_text,
    inputType: step.inputType || step.input_type || "text",
    options: Array.isArray(step.options) ? step.options : [],
    sortOrder: Number(step.sortOrder ?? step.sort_order ?? index + 1),
    isRequired: Number(step.isRequired ?? step.is_required ?? 1),
    validation: step.validation || null,
  }));
}

function answerMap(rows) {
  const map = new Map();
  for (const row of rows || []) map.set(row.question_key || row.questionKey, row);
  return map;
}

async function stepsFor(ctx, serviceCode, answers) {
  // Estos dos flujos son dinámicos y no deben usar las preguntas genéricas antiguas de bot_flow_steps.
  if (isSpecializedVisaFlow(serviceCode)) {
    return normalizeStepRows(fallbackStepsForService(serviceCode, answers));
  }
  const fromDb = normalizeStepRows(await getFlowSteps(ctx.pool, serviceCode));
  return fromDb.length ? fromDb : normalizeStepRows(fallbackStepsForService(serviceCode, answers));
}

function matchTextOption(text, options) {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const matches = (options || []).filter((option) => {
    const values = [option.value, option.label].map(normalizeText);
    return values.includes(normalized);
  });
  return matches.length === 1 ? matches[0] : null;
}

async function promptStep(ctx, step) {
  if (step.inputType === "buttons") {
    await sendReplyButtons(ctx.sendArgs, {
      body: step.prompt,
      buttons: (step.options || []).map((option) => ({
        id: makeProfileOptionId(step.stepKey, option.value),
        title: option.label,
      })),
      footer: "Escriba MENÚ para cambiar de trámite.",
      textForLog: `Perfilamiento: ${step.prompt}`,
    });
    return;
  }

  if (step.inputType === "list") {
    await sendList(ctx.sendArgs, {
      header: "Perfilamiento",
      body: step.prompt,
      button: "Ver opciones",
      sectionTitle: "Seleccione una opción",
      rows: (step.options || []).map((option) => ({
        id: makeProfileOptionId(step.stepKey, option.value),
        title: option.label,
      })),
      footer: "Escriba MENÚ en cualquier momento.",
      textForLog: `Perfilamiento: ${step.prompt}`,
    });
    return;
  }

  await sendText(ctx.sendArgs, `${step.prompt}\n\nPuede escribir MENÚ para regresar al menú principal.`);
}

async function nextPendingStep(ctx, serviceCode) {
  const answers = answerMap(await getProfileAnswers(ctx.pool, ctx.contact.id, serviceCode));
  const steps = await stepsFor(ctx, serviceCode, answers);
  const next = steps.find((step) => !answers.has(step.stepKey)) || null;
  return { steps, answers, next };
}

function parsePositiveInteger(text) {
  const raw = String(text || "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return n > 0 ? n : null;
}

function parseAges(text) {
  const normalized = String(text || "")
    .replace(/\baños?\b/gi, "")
    .replace(/\by\b/gi, ",")
    .replace(/[;/\n]+/g, ",");
  const parts = normalized.split(",").map((v) => v.trim()).filter(Boolean);
  if (!parts.length) return null;
  const ages = parts.map((v) => (/^\d{1,3}$/.test(v) ? Number.parseInt(v, 10) : NaN));
  if (ages.some((age) => !Number.isInteger(age) || age < 0 || age > 120)) return null;
  return ages;
}

function answerValue(answers, key) {
  const row = answers.get(key);
  return row ? String(row.answer_value ?? "").trim() : "";
}

async function validateTextAnswer(ctx, next, text, answers) {
  const raw = String(text || "").trim();
  if (!raw) return { ok: false, message: "Para continuar, responda esta pregunta con un mensaje de texto." };

  if (next.validation === "positive_integer") {
    const n = parsePositiveInteger(raw);
    if (!n) {
      return {
        ok: false,
        message: "Por favor, indíqueme únicamente el número de personas que realizarán el trámite.\nEjemplo: 1, 2, 3, 4...",
      };
    }
    return { ok: true, value: String(n), label: String(n) };
  }

  if (next.validation === "ages_match_applicants") {
    const count = Number.parseInt(answerValue(answers, "NUMERO_SOLICITANTES"), 10);
    const ages = parseAges(raw);
    if (!ages) {
      return {
        ok: false,
        message: "No pude identificar correctamente las edades. Escríbalas separadas por comas.\nEjemplo: 42, 38, 15, 8.",
      };
    }
    if (count > 0 && ages.length !== count) {
      return {
        ok: false,
        message: `Me indicó que el trámite será para ${count} ${count === 1 ? "persona" : "personas"}, pero tengo registradas ${ages.length} ${ages.length === 1 ? "edad" : "edades"}.\nPor favor, indíqueme las edades de los ${count} solicitantes.`,
      };
    }
    return { ok: true, value: JSON.stringify(ages), label: ages.join(", ") + (ages.length === 1 ? " año" : " años") };
  }

  if (next.validation === "count_not_greater_than_applicants") {
    const n = parsePositiveInteger(raw);
    const count = Number.parseInt(answerValue(answers, "NUMERO_SOLICITANTES"), 10);
    if (!n || (count > 0 && n >= count)) {
      return {
        ok: false,
        message: count > 0
          ? `Indíqueme un número mayor a 0 y menor a ${count}, ya que seleccionó que solo algunos cuentan con pasaporte vigente.`
          : "Indíqueme únicamente cuántos solicitantes cuentan con pasaporte vigente.",
      };
    }
    return { ok: true, value: String(n), label: String(n) };
  }

  return { ok: true, value: raw.slice(0, 2000), label: raw.slice(0, 2000) };
}

async function emitSpecialAlerts(ctx, serviceCode, questionKey, answerValue) {
  if (questionKey === "QUIERE_PASAPORTE_MEXICANO" && answerValue === "SI") {
    await createAdminEvent(ctx.pool, {
      contactId: ctx.contact.id,
      waId: ctx.contact.wa_id,
      profileName: ctx.contact.profile_name,
      serviceCode,
      action: "interes_pasaporte",
      description: "Prospecto de Visa Americana también solicita información de Pasaporte Mexicano.",
      priority: "alta",
      metadata: { additional_service: "03_PASAPORTE_MEXICANO" },
    });

    const currentService = SERVICE_BY_CODE[serviceCode]?.name || "su trámite de Visa Americana";
    await sendText(
      ctx.sendArgs,
      `¡Gracias! He anotado que también está interesado(a) en el trámite de Pasaporte Mexicano. Una de nuestras asesoras podrá darle seguimiento sobre ese servicio.\n\nPor ahora continuaremos con el perfilamiento de su trámite actual: ${currentService}.`
    );
  }

  if (questionKey === "VISA_AMERICANA_ANTERIOR" && ["SI", "NO_SEGURO"].includes(answerValue)) {
    await sendText(
      ctx.sendArgs,
      "Gracias por indicarlo.\n\nEn este caso necesitamos revisar si el trámite corresponde a Primera Vez o Renovación, ya que dependerá de la situación de la visa anterior.\n\nUna de nuestras asesoras podrá ayudarle a identificar el trámite correcto."
    );
    await createAdminEvent(ctx.pool, {
      contactId: ctx.contact.id,
      waId: ctx.contact.wa_id,
      profileName: ctx.contact.profile_name,
      serviceCode,
      action: "revision_tipo_tramite",
      description: "Revisar si el trámite corresponde a Primera Vez o Renovación.",
      priority: "alta",
      metadata: { revisar_primera_vez_o_renovacion: true, respuesta: answerValue },
    });
  }

  if (/^ESTATUS_VISA_ANTERIOR_\d+$/.test(questionKey) &&
      ["ROBADA_EXTRAVIADA", "CANCELADA_REVOCADA", "OTRO"].includes(answerValue)) {
    const applicant = Number.parseInt(questionKey.match(/\d+$/)?.[0] || "0", 10);
    await createAdminEvent(ctx.pool, {
      contactId: ctx.contact.id,
      waId: ctx.contact.wa_id,
      profileName: ctx.contact.profile_name,
      serviceCode,
      action: "revision_visa_anterior",
      description: `Renovación marcada para revisión por situación especial de visa anterior${applicant ? ` (solicitante ${applicant})` : ""}.`,
      priority: "alta",
      metadata: { applicant_number: applicant || null, status: answerValue },
    });
  }
}

export async function startFirstContact(ctx, serviceCode) {
  const service = SERVICE_BY_CODE[serviceCode];
  if (!service) return false;

  await setSessionState(ctx.pool, ctx.contact.id, "PERFILANDO");
  if (ctx.session) ctx.session.state = "PERFILANDO";

  const specializedIntro = introForService(serviceCode);
  if (specializedIntro) {
    await sendText(ctx.sendArgs, specializedIntro);
  } else {
    await sendText(
      ctx.sendArgs,
      `✅ Servicio registrado: ${service.name}.\n\nAntes de que una asesora continúe, le haré unas preguntas breves de primer contacto.`
    );
  }

  const { next } = await nextPendingStep(ctx, serviceCode);
  if (!next) return finishFirstContact(ctx, serviceCode);
  await promptStep(ctx, next);
  return true;
}

async function finishFirstContact(ctx, serviceCode) {
  await syncStructuredVisaProfile(ctx.pool, {
    contactId: ctx.contact.id,
    serviceCode,
    waId: ctx.contact.wa_id,
  });

  await markProfileComplete(ctx.pool, ctx.contact.id);
  if (ctx.session) ctx.session.state = "PERFIL_COMPLETO";

  if (isSpecializedVisaFlow(serviceCode)) {
    await sendText(
      ctx.sendArgs,
      "¡Gracias! Hemos registrado su información.\n\nCon los datos que nos proporcionó, una de nuestras asesoras podrá brindarle la información completa sobre:\n\n• Nuestro servicio y qué incluye\n• Proceso y programación de citas\n• Opciones de traslado y acompañamiento a CDMX, cuando corresponda\n• Costos y formas de pago\n• Requisitos para iniciar"
    );
    await sendReplyButtons(ctx.sendArgs, {
      body: "¿Está interesado en que iniciemos su trámite o desea consultar costos y formas de pago con una de nuestras asesoras?",
      buttons: [
        { id: "ACTION_COMMERCIAL_CONTINUE", title: "Sí, quiero continuar" },
        { id: "ACTION_COMMERCIAL_DECLINE", title: "No por ahora" },
      ],
      textForLog: "Cierre comercial de perfilamiento Visa Americana",
    });
    return true;
  }

  await sendReplyButtons(ctx.sendArgs, {
    body: "Su información de primer contacto quedó registrada. ¿Cómo desea continuar?",
    buttons: [
      { id: "ACTION_REQUEST_ADVISOR", title: "Hablar con asesor" },
      { id: "ACTION_MENU", title: "Menú principal" },
    ],
    textForLog: "Acciones después del primer contacto",
  });
  return true;
}

export async function continueFirstContact(ctx) {
  const serviceCode = ctx.session?.service_code || ctx.contact?.service_code;
  if (!serviceCode || !SERVICE_BY_CODE[serviceCode]) {
    await sendText(ctx.sendArgs, "No pude identificar el trámite activo. Escriba MENÚ para seleccionar uno nuevamente.");
    return true;
  }

  const { answers, next } = await nextPendingStep(ctx, serviceCode);
  if (!next) return finishFirstContact(ctx, serviceCode);

  const optionSelection = parseProfileOptionId(ctx.parsed?.selectionId || "");
  let answerValue = null;
  let answerLabel = null;

  if (next.inputType === "text") {
    if (ctx.parsed?.kind !== "text") {
      await sendText(ctx.sendArgs, "Para continuar, responda esta pregunta con un mensaje de texto.");
      await promptStep(ctx, next);
      return true;
    }
    const validated = await validateTextAnswer(ctx, next, ctx.parsed.text, answers);
    if (!validated.ok) {
      await sendText(ctx.sendArgs, validated.message);
      await promptStep(ctx, next);
      return true;
    }
    answerValue = validated.value;
    answerLabel = validated.label;
  } else if (optionSelection && optionSelection.stepKey === next.stepKey) {
    const selected = (next.options || []).find((option) => String(option.value) === String(optionSelection.value));
    if (selected) {
      answerValue = selected.value;
      answerLabel = selected.label;
    }
  } else if (ctx.parsed?.kind === "text") {
    const selected = matchTextOption(ctx.parsed.text, next.options);
    if (selected) {
      answerValue = selected.value;
      answerLabel = selected.label;
    }
  }

  if (answerValue === null) {
    await sendText(ctx.sendArgs, "No pude relacionar esa respuesta con las opciones de esta pregunta. Por favor seleccione una de las opciones disponibles.");
    await promptStep(ctx, next);
    return true;
  }

  await upsertProfileAnswer(ctx.pool, {
    contactId: ctx.contact.id,
    serviceCode,
    questionKey: next.stepKey,
    questionLabel: next.prompt,
    answerValue,
    answerLabel,
  });

  await emitSpecialAlerts(ctx, serviceCode, next.stepKey, answerValue);

  await syncStructuredVisaProfile(ctx.pool, {
    contactId: ctx.contact.id,
    serviceCode,
    waId: ctx.contact.wa_id,
  });

  const pending = await nextPendingStep(ctx, serviceCode);
  if (!pending.next) return finishFirstContact(ctx, serviceCode);
  await promptStep(ctx, pending.next);
  return true;
}

export async function showProfileCompleteHelp(ctx) {
  const serviceCode = ctx.session?.service_code || ctx.contact?.service_code;

  if (isSpecializedVisaFlow(serviceCode)) {
    await sendReplyButtons(ctx.sendArgs, {
      body: "Su información ya quedó registrada. ¿Está interesado en que iniciemos su trámite o desea consultar costos y formas de pago con una de nuestras asesoras?",
      buttons: [
        { id: "ACTION_COMMERCIAL_CONTINUE", title: "Sí, quiero continuar" },
        { id: "ACTION_COMMERCIAL_DECLINE", title: "No por ahora" },
      ],
      textForLog: "Cierre comercial de perfil completado",
    });
    return;
  }

  await sendReplyButtons(ctx.sendArgs, {
    body: "Su información de primer contacto ya está registrada. Puede solicitar una asesora o regresar al menú principal.",
    buttons: [
      { id: "ACTION_REQUEST_ADVISOR", title: "Hablar con asesor" },
      { id: "ACTION_MENU", title: "Menú principal" },
    ],
    textForLog: "Ayuda de perfil completado",
  });
}
