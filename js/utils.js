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

/**
 * Faz parsing de números nos formatos pt-BR/es-PY/en-US.
 *
 * O parser preserva o sinal por padrão. Cada domínio decide se aceita valores
 * negativos: transações, transferências e agendas validam valores positivos;
 * saldos iniciais, passivos e conciliação podem usar valores assinados.
 */
export function parseLooseNumber(input, { localeHint = null, allowNegative = true } = {}) {
  const original = String(input ?? "").trim();
  const isNegative = /^\s*[^\d]*-/.test(original);
  const raw = original.replace(/[^\d,.-]/g, "").replace(/-/g, "");

  if (!raw) return 0;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let parsed;

  if (hasComma && hasDot) {
    if (localeHint === "en-US") {
      parsed = Number(raw.replace(/,/g, ""));
    } else if (localeHint === "pt-BR" || localeHint === "es-PY") {
      parsed = Number(raw.replace(/\./g, "").replace(",", "."));
    } else {
      const decimalSeparator = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? "," : ".";
      parsed = decimalSeparator === ","
        ? Number(raw.replace(/\./g, "").replace(",", "."))
        : Number(raw.replace(/,/g, ""));
    }
  } else if (hasComma) {
    const parts = raw.split(",");
    parsed = parts.length === 2 && parts[1].length === 2
      ? Number(raw.replace(",", "."))
      : Number(raw.replace(/,/g, ""));
  } else if (hasDot) {
    const parts = raw.split(".");
    if ((localeHint === "pt-BR" || localeHint === "es-PY") && parts.length === 2 && parts[1].length === 3) {
      parsed = Number(raw.replace(/\./g, ""));
    } else {
      parsed = parts.length === 2 && parts[1].length === 2
        ? Number(raw)
        : Number(raw.replace(/\./g, ""));
    }
  } else {
    parsed = Number(raw);
  }

  if (!Number.isFinite(parsed)) return 0;
  return allowNegative && isNegative ? -Math.abs(parsed) : Math.abs(parsed);
}

export function parseTransactionAmount(input, options = {}) {
  return parseLooseNumber(input, { ...options, allowNegative: false });
}

export function parseSignedAmount(input, options = {}) {
  return parseLooseNumber(input, { ...options, allowNegative: true });
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

/**
 * Evita CSV Formula Injection em Excel/LibreOffice sem alterar o dado salvo.
 * Prefixa valores potencialmente interpretados como fórmula apenas na exportação.
 */
export function csvEscape(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
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
