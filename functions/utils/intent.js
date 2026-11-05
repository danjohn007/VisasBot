import { normalizeText } from "./normalizeText.js";

const MENU_COMMANDS = new Set([
  "menu",
  "menu principal",
  "regresar al menu",
  "volver al menu",
  "inicio",
  "cambiar tramite",
  "cambiar servicio",
]);

const GREETING_PATTERNS = [
  /^h+o+l+a+$/,
  /^ola+$/,
  /^holi+$/,
  /^buen(os)? dias$/,
  /^buen dia$/,
  /^buenas tardes$/,
  /^buenas noches$/,
  /^informacion$/,
  /^informasion$/,
  /^informes$/,
  /^quiero informacion$/,
  /^quiero informes$/,
  /^me pueden dar informes$/,
  /^necesito informacion$/,
  /^necesito informacion de sus servicios$/,
  /^quiero tramitar una visa$/,
  /^informacion de sus servicios$/,
  /^quiero informacion de sus servicios$/,
];

const TEXT_SERVICE_RULES = [
  { code: "01_VISA_USA_PRIMERA_VEZ", test: (t) => /visa/.test(t) && /(americana|usa|estados unidos)/.test(t) && /(primera vez|primera|nueva)/.test(t) },
  { code: "02_VISA_USA_RENOVACION", test: (t) => /visa/.test(t) && /(americana|usa|estados unidos)/.test(t) && /(renovacion|renovar|renuevo)/.test(t) },
  { code: "03_PASAPORTE_MEXICANO", test: (t) => /pasaporte/.test(t) && /(mexicano|mexico)/.test(t) },
  { code: "04_PASAPORTE_AMERICANO", test: (t) => /pasaporte/.test(t) && /(americano|usa|estados unidos)/.test(t) },
  { code: "05_VISA_CANADA", test: (t) => /visa/.test(t) && /(canada|canadiense)/.test(t) },
  { code: "06_ETA_CANADA", test: (t) => /(^|\s)e\s*t\s*a(\s|$)/.test(t) || /eta canadiense/.test(t) },
  { code: "07_VISA_AUSTRALIA", test: (t) => /visa/.test(t) && /australia/.test(t) },
  { code: "08_VISA_CHINA", test: (t) => /visa/.test(t) && /china/.test(t) },
  { code: "09_ACTA_NACIMIENTO", test: (t) => /(acta|actas)/.test(t) && /nacimiento/.test(t) },
  { code: "10_CLIENTE_SEGUIMIENTO", test: (t) => /(ya soy cliente|soy cliente|seguimiento|mi tramite|estado de mi tramite)/.test(t) },
];

const NUMERIC_CODES = {
  "1": "01_VISA_USA_PRIMERA_VEZ",
  "2": "02_VISA_USA_RENOVACION",
  "3": "03_PASAPORTE_MEXICANO",
  "4": "04_PASAPORTE_AMERICANO",
  "5": "05_VISA_CANADA",
  "6": "06_ETA_CANADA",
  "7": "07_VISA_AUSTRALIA",
  "8": "08_VISA_CHINA",
  "9": "09_ACTA_NACIMIENTO",
  "10": "10_CLIENTE_SEGUIMIENTO",
  "11": "11_ASESOR",
};

export function isMenuCommand(text) {
  return MENU_COMMANDS.has(normalizeText(text));
}

export function isGreetingOrInfoRequest(text) {
  const normalized = normalizeText(text);
  return GREETING_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isAdvisorRequest(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return /(^|\s)(asesor|asesora|humano|persona)(\s|$)/.test(t) && /(hablar|quiero|necesito|atencion|comunicar|contactar)/.test(t);
}

export function detectServiceFromText(text) {
  const normalized = normalizeText(text);
  if (NUMERIC_CODES[normalized]) return NUMERIC_CODES[normalized];
  const matches = TEXT_SERVICE_RULES.filter((rule) => rule.test(normalized));
  return matches.length === 1 ? matches[0].code : null;
}
