export const SERVICES = [
  { code: "01_VISA_USA_PRIMERA_VEZ", name: "Visa Americana - Primera vez", flowKey: "VISA_USA_PRIMERA_VEZ", sortOrder: 1 },
  { code: "02_VISA_USA_RENOVACION", name: "Visa Americana - Renovación", flowKey: "VISA_USA_RENOVACION", sortOrder: 2 },
  { code: "03_PASAPORTE_MEXICANO", name: "Pasaporte Mexicano", flowKey: "PASAPORTE_MEXICANO", sortOrder: 3 },
  { code: "04_PASAPORTE_AMERICANO", name: "Pasaporte Americano", flowKey: "PASAPORTE_AMERICANO", sortOrder: 4 },
  { code: "05_VISA_CANADA", name: "Visa Canadiense", flowKey: "VISA_CANADA", sortOrder: 5 },
  { code: "06_ETA_CANADA", name: "eTA Canadiense", flowKey: "ETA_CANADA", sortOrder: 6 },
  { code: "07_VISA_AUSTRALIA", name: "Visa para Australia", flowKey: "VISA_AUSTRALIA", sortOrder: 7 },
  { code: "08_VISA_CHINA", name: "Visa para China", flowKey: "VISA_CHINA", sortOrder: 8 },
  { code: "09_ACTA_NACIMIENTO", name: "Acta de Nacimiento", flowKey: "ACTA_NACIMIENTO", sortOrder: 9 },
  { code: "10_CLIENTE_SEGUIMIENTO", name: "Ya soy cliente - Seguimiento", flowKey: "CLIENTE_SEGUIMIENTO", sortOrder: 10 },
  { code: "11_ASESOR", name: "Hablar con un asesor", flowKey: "ASESOR", sortOrder: 11 },
];

export const SERVICE_BY_CODE = Object.fromEntries(
  SERVICES.map((service) => [service.code, service])
);
