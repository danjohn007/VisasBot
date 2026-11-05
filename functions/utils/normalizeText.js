export function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhone(value = "") {
  return String(value).replace(/\D/g, "");
}

export function last10Digits(value = "") {
  const digits = normalizePhone(value);
  return digits.slice(-10);
}
