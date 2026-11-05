const FIRST_TIME = "01_VISA_USA_PRIMERA_VEZ";
const RENEWAL = "02_VISA_USA_RENOVACION";

function rowValue(answers, key) {
  const row = answers?.get?.(key);
  return row ? String(row.answer_value ?? row.answerValue ?? "").trim() : "";
}

function intAnswer(answers, key) {
  const n = Number.parseInt(rowValue(answers, key), 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function parsedAges(answers) {
  const raw = rowValue(answers, "EDADES_SOLICITANTES");
  if (!raw) return [];
  try {
    const json = JSON.parse(raw);
    if (Array.isArray(json)) return json.map(Number).filter(Number.isFinite);
  } catch {}
  return raw.split(/[,\n;]+/).map((v) => Number.parseInt(v.trim(), 10)).filter(Number.isFinite);
}

function option(value, label) {
  return { value, label };
}

function textStep(stepKey, prompt, extra = {}) {
  return { stepKey, prompt, inputType: "text", options: [], isRequired: 1, ...extra };
}

function listStep(stepKey, prompt, options, extra = {}) {
  return { stepKey, prompt, inputType: "list", options, isRequired: 1, ...extra };
}

function buttonsStep(stepKey, prompt, options, extra = {}) {
  return { stepKey, prompt, inputType: "buttons", options, isRequired: 1, ...extra };
}

function commonOriginSteps(answers) {
  const steps = [
    listStep(
      "ORIGEN_PROSPECTO",
      "Antes de continuar, nos gustaría saber:\n\n¿Cómo se enteró de nosotros?",
      [
        option("RECOMENDACION", "Recomendación"),
        option("FACEBOOK", "Facebook"),
        option("GOOGLE", "Google"),
        option("INSTAGRAM", "Instagram"),
        option("VOLANTES", "Volantes"),
        option("OTRO", "Otro"),
      ]
    ),
  ];

  const origin = rowValue(answers, "ORIGEN_PROSPECTO");
  if (origin === "RECOMENDACION") {
    steps.push(textStep(
      "RECOMENDADO_POR",
      "¡Muchas gracias!\n\n¿Recuerda el nombre de la persona que nos recomendó?\nSi no lo recuerda, puede escribir NO SÉ."
    ));
  } else if (origin === "VOLANTES") {
    steps.push(textStep(
      "UBICACION_VOLANTE",
      "¿Recuerda aproximadamente dónde recibió o vio nuestro volante?\nEjemplo: Terminal de Autobuses, plaza comercial, calle, negocio, etc.\nSi no lo recuerda, puede escribir NO SÉ."
    ));
  } else if (origin === "OTRO") {
    steps.push(textStep(
      "ORIGEN_PROSPECTO_OTRO",
      "Por favor, indíquenos brevemente cómo se enteró de nosotros."
    ));
  }
  return steps;
}

function passportSteps(answers) {
  const steps = [
    buttonsStep(
      "PASAPORTE_VIGENTE",
      "¿Todos los solicitantes cuentan actualmente con pasaporte mexicano vigente?",
      [
        option("TODOS", "Sí, todos"),
        option("ALGUNOS", "Solo algunos"),
        option("NINGUNO", "No"),
      ]
    ),
  ];
  const passport = rowValue(answers, "PASAPORTE_VIGENTE");
  if (passport === "ALGUNOS") {
    steps.push(textStep(
      "SOLICITANTES_CON_PASAPORTE",
      "¿Cuántos de los solicitantes cuentan actualmente con pasaporte mexicano vigente?",
      { validation: "count_not_greater_than_applicants" }
    ));
  }
  if (passport === "ALGUNOS" || passport === "NINGUNO") {
    steps.push(buttonsStep(
      "QUIERE_PASAPORTE_MEXICANO",
      passport === "NINGUNO"
        ? "No hay problema. También podemos apoyarle con el trámite de Pasaporte Mexicano.\nPara continuar posteriormente con el proceso de visa americana será necesario contar con pasaporte vigente.\n\n¿Desea recibir información para tramitar su Pasaporte Mexicano?"
        : "No hay problema. También podemos apoyarle con el trámite de Pasaporte Mexicano para los solicitantes que aún lo necesiten.\n\n¿Desea recibir información para tramitar también el Pasaporte Mexicano?",
      [option("SI", "Sí"), option("NO", "No")]
    ));
  }
  return steps;
}

function occupationSteps(answers) {
  const count = intAnswer(answers, "NUMERO_SOLICITANTES");
  const ages = parsedAges(answers);
  const steps = [];
  for (let i = 1; i <= count; i += 1) {
    const age = ages[i - 1];
    const isMinor = Number.isFinite(age) && age < 18;
    const examples = isMinor
      ? "Indique el nivel escolar que cursa actualmente, por ejemplo: Estudiante de primaria, secundaria, preparatoria o universidad."
      : "Puede indicar, por ejemplo: Empleado(a), negocio propio, profesionista independiente, ama de casa, jubilado(a), pensionado(a), desempleado(a), etc.";
    steps.push(textStep(
      `OCUPACION_SOLICITANTE_${i}`,
      `¿A qué se dedica actualmente el solicitante ${i}${Number.isFinite(age) ? ` (${age} años)` : ""}?\n${examples}`
    ));
  }
  return steps;
}

function firstTimeSteps(answers) {
  const steps = [
    textStep(
      "NUMERO_SOLICITANTES",
      "Para comenzar, ¿para cuántas personas desea realizar el trámite de visa americana?",
      { validation: "positive_integer" }
    ),
    textStep(
      "EDADES_SOLICITANTES",
      "Perfecto. Ahora indíqueme, por favor, la edad de cada uno de los solicitantes.\nEjemplo: 42, 38, 15 y 8 años.",
      { validation: "ages_match_applicants" }
    ),
    listStep(
      "MOTIVO_VIAJE",
      "¿Cuál es el motivo principal de su viaje a Estados Unidos?",
      [
        option("TURISMO_VACACIONES", "Turismo / vacaciones"),
        option("VISITA_FAMILIAR", "Visita familiar"),
        option("NEGOCIOS", "Negocios"),
        option("COMPRAS", "Compras"),
        option("OTRO", "Otro"),
      ]
    ),
  ];

  if (rowValue(answers, "MOTIVO_VIAJE") === "OTRO") {
    steps.push(textStep("MOTIVO_VIAJE_OTRO", "Por favor, indíqueme brevemente cuál es el motivo principal de su viaje."));
  }

  steps.push(...occupationSteps(answers));
  steps.push(...passportSteps(answers));
  steps.push(buttonsStep(
    "VISA_AMERICANA_ANTERIOR",
    "🇺🇸 ¿Alguno de los solicitantes ha tenido anteriormente una visa americana, aunque actualmente esté vencida?",
    [
      option("NO_NINGUNO", "No, ninguno"),
      option("SI", "Sí"),
      option("NO_SEGURO", "No estoy seguro"),
    ]
  ));
  steps.push(textStep("CIUDAD_ESTADO", "¿En qué ciudad y estado se encuentran actualmente?\nEjemplo: Querétaro, Querétaro."));
  steps.push(...commonOriginSteps(answers));
  return steps;
}

function renewalApplicantSteps(answers) {
  const count = intAnswer(answers, "NUMERO_SOLICITANTES");
  const ages = parsedAges(answers);
  const steps = [];

  for (let i = 1; i <= count; i += 1) {
    steps.push(listStep(
      `ESTATUS_VISA_ANTERIOR_${i}`,
      `Respecto a la visa americana anterior del solicitante ${i}${Number.isFinite(ages[i - 1]) ? ` (${ages[i - 1]} años)` : ""}, ¿cuál opción describe mejor su situación?`,
      [
        option("VIGENTE", "Aún está vigente"),
        option("VENCIDA", "Ya está vencida"),
        option("PROXIMA_VENCER", "Está próxima a vencer"),
        option("ROBADA_EXTRAVIADA", "Robada o extraviada"),
        option("CANCELADA_REVOCADA", "Cancelada o revocada"),
        option("OTRO", "Otro"),
      ]
    ));
  }

  for (let i = 1; i <= count; i += 1) {
    steps.push(textStep(
      `FECHA_VENCIMIENTO_VISA_${i}`,
      `¿En qué fecha venció o vencerá la visa americana del solicitante ${i}?\nSi no recuerda el día exacto, puede indicar mes y año. Ejemplo: Agosto 2025.\nSi no lo recuerda, escriba NO SÉ.`
    ));
  }

  for (let i = 1; i <= count; i += 1) {
    steps.push(textStep(
      `EDAD_AL_OTORGAMIENTO_VISA_ANTERIOR_${i}`,
      `Aproximadamente, ¿qué edad tenía el solicitante ${i} cuando le fue otorgada su visa americana anterior?\nSi no lo recuerda, puede escribir NO SÉ.`
    ));
  }

  steps.push(...occupationSteps(answers));
  return steps;
}

function renewalSteps(answers) {
  const steps = [
    textStep(
      "NUMERO_SOLICITANTES",
      "Para comenzar, ¿para cuántas personas desea realizar la renovación de visa americana?",
      { validation: "positive_integer" }
    ),
    textStep(
      "EDADES_SOLICITANTES",
      "Perfecto. Ahora indíqueme, por favor, la edad actual de cada uno de los solicitantes.\nEjemplo: 45, 42, 17 y 12 años.",
      { validation: "ages_match_applicants" }
    ),
  ];
  steps.push(...renewalApplicantSteps(answers));
  steps.push(...passportSteps(answers));
  steps.push(textStep("CIUDAD_ESTADO", "¿En qué ciudad y estado se encuentran actualmente?\nEjemplo: Querétaro, Querétaro."));
  steps.push(...commonOriginSteps(answers));
  return steps;
}

const COMMON_PREFIX = [
  textStep("applicant_relation", "Para comenzar, ¿el trámite es para usted o para otra persona?"),
  textStep("full_name", "¿Cuál es el nombre completo de la persona que realizará el trámite?"),
  buttonsStep("age_group", "¿La persona solicitante es adulta o menor de edad?", [
    option("ADULT", "Adulto"), option("MINOR", "Menor")
  ]),
  textStep("location", "¿En qué ciudad y estado se encuentra actualmente?"),
  textStep("timeframe", "¿Para qué fecha aproximada necesita realizar o utilizar este trámite?"),
];

const TRAVEL_PURPOSE = listStep("purpose", "¿Cuál es el motivo principal relacionado con este trámite?", [
  option("TOURISM", "Turismo"), option("FAMILY", "Visita familiar"),
  option("BUSINESS", "Negocios"), option("STUDY", "Estudios"), option("OTHER", "Otro"),
]);

export function fallbackStepsForService(serviceCode, answers = new Map()) {
  if (serviceCode === FIRST_TIME) return firstTimeSteps(answers);
  if (serviceCode === RENEWAL) return renewalSteps(answers);
  return [...COMMON_PREFIX, TRAVEL_PURPOSE].map((step, index) => ({
    ...step, sortOrder: index + 1, isRequired: 1,
  }));
}

export function isSpecializedVisaFlow(serviceCode) {
  return serviceCode === FIRST_TIME || serviceCode === RENEWAL;
}

export function introForService(serviceCode) {
  if (serviceCode === FIRST_TIME) {
    return "🇺🇸 VISA AMERICANA – PRIMERA VEZ\n\n¡Con gusto le brindaremos información!\n\nAntes de continuar, le realizaré unas preguntas breves para conocer mejor su trámite.\n\nLa información que proporcione quedará registrada para que, en caso de requerir atención personalizada, una de nuestras asesoras pueda continuar con usted sin necesidad de repetir las mismas preguntas.";
  }
  if (serviceCode === RENEWAL) {
    return "🇺🇸 RENOVACIÓN DE VISA AMERICANA\n\n¡Con gusto le brindaremos información!\n\nAntes de continuar, le realizaré unas preguntas breves para conocer la situación de su visa anterior.\n\nLa información que proporcione quedará registrada para que, en caso de requerir atención personalizada, una de nuestras asesoras pueda continuar con usted sin necesidad de repetir las mismas preguntas.";
  }
  return null;
}

export function makeProfileOptionId(stepKey, value) {
  return `FCOPT__${stepKey}__${value}`;
}

export function parseProfileOptionId(selectionId = "") {
  const match = /^FCOPT__([A-Za-z0-9_-]+)__([A-Za-z0-9_-]+)$/.exec(String(selectionId));
  return match ? { stepKey: match[1], value: match[2] } : null;
}
