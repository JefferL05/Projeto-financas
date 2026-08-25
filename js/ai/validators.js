export const ALLOWED_CURRENCIES = ["BRL", "PYG"];
export const ALLOWED_TYPES = ["income", "expense"];
export const ALLOWED_MUTATIONS = ["create_transaction", "update_transaction", "delete_transaction", "create_goal", "add_goal_contribution", "create_budget", "update_category"];

export function normalizeText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

export function safeText(value, max = 160) {
  return String(value ?? "").replace(/[<>]/g, "").trim().slice(0, max);
}

export function validAmount(value, currency) {
  const n = Number(value);
  const max = currency === "PYG" ? 1_000_000_000_000 : 100_000_000;
  return Number.isFinite(n) && n > 0 && n <= max;
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateMutation(mutation) {
  if (!mutation || !ALLOWED_MUTATIONS.includes(mutation.operation)) return { ok: false, reason: "Operação não permitida." };
  const p = mutation.payload || {};
  if (mutation.operation === "create_transaction" || mutation.operation === "update_transaction") {
    if (!ALLOWED_CURRENCIES.includes(p.currency) || !ALLOWED_TYPES.includes(p.type)) return { ok: false, reason: "Moeda ou tipo inválido." };
    if (!validAmount(p.amount, p.currency) || !validDate(p.date)) return { ok: false, reason: "Valor ou data inválidos." };
  }
  if ((mutation.operation === "update_transaction" || mutation.operation === "delete_transaction") && !p.id) return { ok: false, reason: "Identificador ausente." };
  return { ok: true };
}

export function looksLikePromptInjection(value) {
  const q = normalizeText(value).toLowerCase();
  return /(ignore|desconsidere|substitua).*(instruc|regra|sistema)|system prompt|developer message|execute codigo|revele.*chave/.test(q);
}
