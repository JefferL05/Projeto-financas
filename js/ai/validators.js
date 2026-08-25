import { parseLocalISO } from "../finance/date-utils.js";

export const ALLOWED_CURRENCIES = ["BRL", "PYG"];
export const ALLOWED_TYPES = ["income", "expense"];
export const ALLOWED_MUTATIONS = [
  "create_transaction",
  "update_transaction",
  "delete_transaction",
  "create_goal",
  "add_goal_contribution",
  "create_budget",
  "update_category",
  "create_transfer",
  "mark_schedule_paid",
  "create_rule"
];

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function safeText(value, max = 160) {
  return String(value ?? "")
    .replace(/[<>\u0000-\u001f]/g, "")
    .trim()
    .slice(0, max);
}

export function validAmount(value, currency) {
  const amount = Number(value);
  const max = currency === "PYG" ? 1_000_000_000_000 : 100_000_000;
  return Number.isFinite(amount) && amount > 0 && amount <= max;
}

export function validDate(value) {
  return Boolean(parseLocalISO(value));
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function validateMutation(mutation) {
  if (!mutation || !ALLOWED_MUTATIONS.includes(mutation.operation)) {
    return { ok: false, reason: "Operação não permitida." };
  }

  const payload = mutation.payload || {};

  if (["create_transaction", "update_transaction"].includes(mutation.operation)) {
    if (!ALLOWED_CURRENCIES.includes(payload.currency) || !ALLOWED_TYPES.includes(payload.type)) {
      return { ok: false, reason: "Moeda ou tipo inválido." };
    }
    if (!validAmount(payload.amount, payload.currency) || !validDate(payload.date)) {
      return { ok: false, reason: "Valor ou data inválidos." };
    }
  }

  if (["update_transaction", "delete_transaction"].includes(mutation.operation) && !validId(payload.id)) {
    return { ok: false, reason: "Identificador ausente ou inválido." };
  }

  if (mutation.operation === "create_transfer") {
    if (!validId(payload.sourceAccountId) || !validId(payload.destinationAccountId) || payload.sourceAccountId === payload.destinationAccountId) {
      return { ok: false, reason: "Contas da transferência são inválidas." };
    }
    if (!validAmount(payload.sourceAmount, payload.sourceCurrency) || !validAmount(payload.destinationAmount, payload.destinationCurrency)) {
      return { ok: false, reason: "Valores da transferência são inválidos." };
    }
    if (!validDate(payload.date)) return { ok: false, reason: "Data da transferência é inválida." };
    if (payload.sourceCurrency !== payload.destinationCurrency && !(Number(payload.exchangeRate) > 0)) {
      return { ok: false, reason: "Transferência entre moedas exige cotação válida." };
    }
  }

  if (mutation.operation === "mark_schedule_paid") {
    if (!validId(payload.scheduleId) || !validDate(payload.date)) {
      return { ok: false, reason: "Compromisso ou data inválidos." };
    }
  }

  if (mutation.operation === "create_rule") {
    if (!safeText(payload.name, 100) || !Array.isArray(payload.conditions) || !payload.conditions.length || !Array.isArray(payload.actions) || !payload.actions.length) {
      return { ok: false, reason: "Regra incompleta." };
    }
  }

  return { ok: true };
}

export function looksLikePromptInjection(value) {
  const q = normalizeText(value).toLowerCase();
  return /(ignore|desconsidere|substitua).*(instruc|regra|sistema)|system prompt|developer message|execute codigo|revele.*chave/.test(q);
}
