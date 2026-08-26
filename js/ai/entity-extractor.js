import { parseSignedAmount } from "../utils.js";
import { normalizeText } from "./validators.js";

const CURRENCY_PATTERNS = [
  { currency: "BRL", pattern: /(?:\bbrl\b|\breais?\b|r\$)/i },
  { currency: "PYG", pattern: /(?:\bpyg\b|\bguaranis?\b|\bgs\.?\b|₲)/i }
];

const COLLOQUIAL_REPLACEMENTS = [
  [/\bpra\b/g, "para"],
  [/\bpro\b/g, "para o"],
  [/\bta\b/g, "esta"],
  [/\bto\b/g, "estou"],
  [/\bqto\b/g, "quanto"],
  [/\bgrana\b/g, "dinheiro"]
];

export function normalizeFinancialQuestion(value) {
  let normalized = normalizeText(String(value ?? "")).toLowerCase();
  for (const [pattern, replacement] of COLLOQUIAL_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/\s+/g, " ").trim();
}

export function detectCurrencyEntity(text) {
  for (const item of CURRENCY_PATTERNS) {
    if (item.pattern.test(text)) return item.currency;
  }
  return null;
}

export function extractSignedAmount(text) {
  const match = String(text ?? "").match(/(?:r\$|gs\.?|₲)?\s*-?\s*\d[\d.,]*/i)?.[0];
  if (!match) return null;
  const amount = parseSignedAmount(match);
  return Number.isFinite(amount) ? amount : null;
}

function normalizedAccountName(account) {
  return normalizeFinancialQuestion(account?.name || "");
}

export function resolveAccountEntity(question, accounts = [], currency = null) {
  const q = normalizeFinancialQuestion(question);
  const active = accounts.filter((account) => !account.archived);

  const explicit = [...active]
    .sort((a, b) => String(b.name || "").length - String(a.name || "").length)
    .find((account) => {
      const name = normalizedAccountName(account);
      return name && q.includes(name);
    });

  if (explicit) {
    return { account: explicit, ambiguous: false, candidates: [explicit] };
  }

  const currencyCandidates = currency
    ? active.filter((account) => account.currency === currency)
    : [];

  if (currencyCandidates.length === 1) {
    return { account: currencyCandidates[0], ambiguous: false, candidates: currencyCandidates };
  }

  if (currencyCandidates.length > 1) {
    return { account: null, ambiguous: true, candidates: currencyCandidates };
  }

  return { account: null, ambiguous: false, candidates: [] };
}

export function extractFinancialEntities(question, { accounts = [] } = {}) {
  const original = String(question ?? "").trim();
  const normalized = normalizeFinancialQuestion(original);
  const currency = detectCurrencyEntity(original) || detectCurrencyEntity(normalized);
  const amount = extractSignedAmount(original);
  const accountResolution = resolveAccountEntity(original, accounts, currency);

  const action = /(?:zerar|zero|sair do negativo|sair do vermelho|cobrir saldo|deixar.+zero|quanto preciso (?:colocar|depositar)|quanto falta.+zerar)/.test(normalized)
    ? "zero_balance"
    : /(?:depositar|colocar|adicionar)/.test(normalized)
      ? "deposit"
      : /(?:retirar|sacar)/.test(normalized)
        ? "withdraw"
        : null;

  const direction = amount !== null
    ? amount < 0 ? "negative" : amount > 0 ? "positive" : "zero"
    : /(?:negativ|vermelho|devendo)/.test(normalized)
      ? "negative"
      : null;

  return {
    original,
    normalized,
    currency,
    amount,
    accountId: accountResolution.account?.id || null,
    accountName: accountResolution.account?.name || null,
    accountAmbiguous: accountResolution.ambiguous,
    accountCandidates: accountResolution.candidates.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency
    })),
    action,
    direction
  };
}
