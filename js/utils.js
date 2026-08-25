import { monthKey, todayLocalISO } from "./finance/date-utils.js";

export const DEFAULT_CATEGORIES = [
  "Mercado",
  "Alimentação",
  "Combustível",
  "Compras",
  "Transporte",
  "Moradia",
  "Saúde",
  "Lazer",
  "Educação",
  "Serviços",
  "Salário",
  "Outros"
];

export function uid(prefix = "tx") {
  return crypto.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function parseLooseNumber(input, { localeHint = null } = {}) {
  let raw = String(input ?? "").trim().replace(/[^\d,.-]/g, "");
  raw = raw.replace(/^-/, "");
  if (!raw) return 0;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  if (hasComma && hasDot) {
    if (localeHint === "en-US") return Number(raw.replace(/,/g, ""));
    if (localeHint === "pt-BR") return Number(raw.replace(/\./g, "").replace(",", "."));

    const decimalSeparator = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? "," : ".";
    return decimalSeparator === ","
      ? Number(raw.replace(/\./g, "").replace(",", "."))
      : Number(raw.replace(/,/g, ""));
  }

  if (hasComma) {
    const parts = raw.split(",");
    return parts.length === 2 && parts[1].length === 2
      ? Number(raw.replace(",", "."))
      : Number(raw.replace(/,/g, ""));
  }

  if (hasDot) {
    const parts = raw.split(".");
    if (localeHint === "pt-BR" && parts.length === 2 && parts[1].length === 3) {
      return Number(raw.replace(/\./g, ""));
    }
    return parts.length === 2 && parts[1].length === 2
      ? Number(raw)
      : Number(raw.replace(/\./g, ""));
  }

  return Number(raw);
}

export function formatMoney(value, currency) {
  return new Intl.NumberFormat(currency === "BRL" ? "pt-BR" : "es-PY", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "PYG" ? 0 : 2,
    maximumFractionDigits: currency === "PYG" ? 0 : 2
  }).format(Number(value) || 0);
}

export function formatDate(date) {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function toBaseCurrency(amount, currency, baseCurrency, brlToPyg) {
  if (currency === baseCurrency) return Number(amount) || 0;
  return baseCurrency === "PYG"
    ? (Number(amount) || 0) * brlToPyg
    : (Number(amount) || 0) / brlToPyg;
}

export function normalizeToPYG(amount, currency, brlToPyg) {
  return currency === "PYG" ? Number(amount) || 0 : (Number(amount) || 0) * brlToPyg;
}

export function csvEscape(value) {
  const text = String(value ?? "");
  if (/[;"\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 600);
}

export function startOfMonthISO(date = new Date()) {
  return monthKey(date);
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function todayISO(now = new Date()) {
  return todayLocalISO(now);
}
