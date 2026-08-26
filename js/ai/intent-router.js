import { extractPeriodFromText, resolvePeriod } from "../finance/period-utils.js";
import { todayLocalISO, yesterdayLocalISO } from "../finance/date-utils.js";
import { normalizeText } from "./validators.js";
import { parseLooseNumber } from "../utils.js";
import { extractFinancialEntities, normalizeFinancialQuestion } from "./entity-extractor.js";

const INTENTS = new Set([
  "spending_summary",
  "income_summary",
  "balance_summary",
  "category_spending",
  "compare_periods",
  "savings",
  "projection",
  "recurring",
  "anomalies",
  "budgets",
  "goals",
  "available_funds",
  "net_worth",
  "liabilities",
  "account_balance",
  "account_zero_balance",
  "account_target",
  "upcoming_commitments",
  "reconciliation_status",
  "safe_to_spend",
  "create_transaction",
  "update_transaction",
  "delete_transaction",
  "create_transfer",
  "mark_schedule_paid",
  "create_rule",
  "unknown"
]);

const CONTINUABLE_INTENTS = new Set([
  "spending_summary",
  "category_spending",
  "income_summary",
  "balance_summary",
  "account_balance",
  "account_zero_balance",
  "account_target",
  "liabilities",
  "upcoming_commitments",
  "budgets",
  "goals"
]);

function detectCurrency(q) {
  if (/(?:\bbrl\b|\breais?\b|r\$)/.test(q)) return "BRL";
  if (/(?:\bpyg\b|\bguaranis?\b|gs\.?|₲)/.test(q)) return "PYG";
  return null;
}

function detectCategory(q, categories = []) {
  const normalized = categories.map((category) => ({
    original: category,
    normalized: normalizeText(category).toLowerCase()
  }));
  const found = normalized.find((category) => q.includes(category.normalized));
  if (found) return found.original;

  const aliases = {
    mercado: "Mercado",
    supermercado: "Mercado",
    gasolina: "Combustível",
    combustivel: "Combustível",
    almoco: "Alimentação",
    jantar: "Alimentação",
    comida: "Alimentação",
    transporte: "Transporte",
    uber: "Transporte",
    farmacia: "Saúde",
    aluguel: "Moradia",
    salario: "Salário"
  };
  const alias = Object.entries(aliases).find(([key]) => q.includes(key));
  return alias?.[1] || null;
}

function extractAmountAndCurrency(original, normalized) {
  const money = original.match(/(?:r\$|gs\.?|₲)?\s*-?\d[\d.,]*/i)?.[0];
  if (!money) return { amount: null, currency: detectCurrency(normalized) };
  return {
    amount: Math.abs(parseLooseNumber(money)),
    currency: detectCurrency(normalized)
  };
}

function explicitRelativeDate(q, now = new Date()) {
  if (/\bontem\b/.test(q)) return yesterdayLocalISO(now);
  if (/\bhoje\b/.test(q)) return todayLocalISO(now);
  return null;
}

function normalizedEntityName(value) {
  return normalizeText(value || "").toLowerCase();
}

function findNamedEntity(q, entities = []) {
  const sorted = [...entities].sort((a, b) => String(b.name || "").length - String(a.name || "").length);
  return sorted.find((entity) => {
    const name = normalizedEntityName(entity.name);
    return name && q.includes(name);
  }) || null;
}

function findTransferAccounts(q, accounts = []) {
  const active = accounts.filter((account) => !account.archived);
  const normalizedAccounts = active.map((account) => ({
    account,
    name: normalizedEntityName(account.name)
  }));

  const paraIndex = q.indexOf(" para ");
  if (paraIndex < 0) {
    const mentioned = normalizedAccounts.filter(({ name }) => name && q.includes(name)).map(({ account }) => account);
    return { sourceAccount: mentioned[0] || null, destinationAccount: mentioned[1] || null };
  }

  const before = q.slice(0, paraIndex);
  const after = q.slice(paraIndex + 6);
  const source = normalizedAccounts.find(({ name }) => name && before.includes(name))?.account || null;
  const destination = normalizedAccounts.find(({ name }) => name && after.includes(name))?.account || null;
  return { sourceAccount: source, destinationAccount: destination };
}

function detectRuleEntities(original, q, categories) {
  const category = detectCategory(q, categories);
  const containsMatch = original.match(/(?:cont[eé]m|contendo|descri[cç][aã]o\s+)(?:["“])?([^"”]+?)(?:["”]|\s+como\s+|\s+para\s+)/i);
  const simple = original.match(/(?:categorizar|classificar)\s+(.+?)\s+(?:como|em)\s+(.+)$/i);
  const needle = (containsMatch?.[1] || simple?.[1] || "").trim();
  const requestedCategory = category || simple?.[2]?.trim() || null;
  return { needle, category: requestedCategory };
}

function scoreSemanticIntents(q, entities, memory) {
  const scores = new Map();
  const add = (intent, score) => scores.set(intent, (scores.get(intent) || 0) + score);

  if (/(?:\bzero\b|zerar|zerad|ficar.+zero|deix\w*.+zero|sair do negativo|sair do vermelho|cobrir saldo|como arrum\w*)/.test(q)) add("account_zero_balance", 0.75);
  if (/(?:quanto falta.+zerar|quanto preciso (?:colocar|depositar)|quanto tenho que depositar)/.test(q)) add("account_zero_balance", 0.72);
  if (entities.action === "zero_balance") add("account_zero_balance", 0.22);
  if (entities.direction === "negative" && /(?:conta|carteira|saldo|guarani|real|pyg|brl)/.test(q)) add("account_zero_balance", 0.65);
  else if (entities.direction === "negative") add("account_zero_balance", 0.58);

  if (/(?:quanto tenho|qual.*saldo|saldo da|saldo na|saldo em)/.test(q)) add("account_balance", 0.72);
  if (/(?:conta|carteira)/.test(q) && entities.currency) add("account_balance", 0.14);

  if (/(?:quanto falta.+(?:chegar|atingir)|chegar em|atingir)/.test(q) && entities.amount !== null) add("account_target", 0.78);
  if (/^e quanto falta/.test(q) && memory?.lastIntent === "account_balance") add("account_target", 0.16);

  if (/(?:quanto devo|estou devendo|divida|dívida|cartao|cartão)/.test(q)) add("liabilities", 0.82);
  if (/(?:quanto tenho disponivel|quanto tenho disponível|dinheiro disponivel|dinheiro disponível|tenho dinheiro para gastar)/.test(q)) add("available_funds", 0.9);
  if (/(?:patrimonio|patrimônio|quanto tenho no total|somando tudo)/.test(q)) add("net_worth", 0.9);
  if (/(?:para onde esta indo meu dinheiro|onde esta indo meu dinheiro)/.test(q)) add("spending_summary", 0.88);

  return [...scores.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
}

function applyConversationContinuation({ intent, confidence, q, period, currency, category, memory }) {
  if (intent !== "unknown" || !memory?.lastIntent || !CONTINUABLE_INTENTS.has(memory.lastIntent)) {
    return { intent, confidence, period, currency, category };
  }

  const looksLikeFollowUp = Boolean(
    period || currency || category ||
    /^(?:e\b|esse\b|este\b|essa\b|com\b|a de\b|da de\b|em\b|quanto preciso\b)/.test(q)
  );
  if (!looksLikeFollowUp) return { intent, confidence, period, currency, category };

  const inheritedPeriod = period || memory.lastFilters?.period || null;
  const inheritedCurrency = currency || memory.lastFilters?.currency || null;
  const inheritedCategory = category || memory.lastFilters?.category || null;
  let inheritedIntent = memory.lastIntent;

  if (["spending_summary", "category_spending"].includes(memory.lastIntent) && inheritedCategory) {
    inheritedIntent = "category_spending";
  }

  return {
    intent: inheritedIntent,
    confidence: 0.84,
    period: inheritedPeriod,
    currency: inheritedCurrency,
    category: inheritedCategory
  };
}

export function routeIntent(question, {
  categories = [],
  accounts = [],
  schedules = [],
  memory = null,
  now = new Date()
} = {}) {
  const original = String(question || "").trim();
  const q = normalizeFinancialQuestion(original);
  const extracted = extractFinancialEntities(original, { accounts });
  let period = extractPeriodFromText(q, now);
  let currency = extracted.currency || detectCurrency(q);
  let category = detectCategory(q, categories);
  const type = /receita|entrada|recebi|salario/.test(q)
    ? "income"
    : /gasto|despesa|saida|paguei|compra/.test(q)
      ? "expense"
      : null;
  const tags = [...q.matchAll(/#([a-z0-9_-]+)/g)].map((match) => match[1]);

  if (!category && /e no mes passado|e ontem|e hoje/.test(q)) {
    category = memory?.lastFilters?.category || null;
  }
  if (!currency && (/^e\b/.test(q) || /^(?:a|da|de)\s+(?:guarani|real)/.test(q))) {
    currency = memory?.lastFilters?.currency || null;
  }

  let intent = "unknown";
  let confidence = 0.45;
  const [semanticIntent, semanticScore] = scoreSemanticIntents(q, extracted, memory);

  if (semanticIntent && semanticScore >= 0.8) {
    intent = semanticIntent;
    confidence = Math.min(0.98, semanticScore);
  } else if (/\btransfira|\btransferir|\btransfere/.test(q)) {
    intent = "create_transfer";
    confidence = 0.93;
  } else if (/marque.+(?:paga|pago)|marcar.+(?:paga|pago)/.test(q)) {
    intent = "mark_schedule_paid";
    confidence = 0.9;
  } else if (/crie.+regra|criar.+regra|regra.+categor/.test(q)) {
    intent = "create_rule";
    confidence = 0.88;
  } else if (/quanto tenho disponivel|dinheiro disponivel/.test(q)) {
    intent = "available_funds";
    confidence = 0.94;
  } else if (/patrimonio|quanto tenho no total/.test(q)) {
    intent = "net_worth";
    confidence = 0.93;
  } else if (/quanto devo|divida|cartao/.test(q)) {
    intent = "liabilities";
    confidence = 0.87;
  } else if (/contas? vence|vence esta|vencem|compromiss|proximas contas/.test(q)) {
    intent = "upcoming_commitments";
    confidence = 0.9;
  } else if (/conciliad|conciliacao/.test(q)) {
    intent = "reconciliation_status";
    confidence = 0.9;
  } else if (/seguro para gastar|valor seguro|posso gastar sem comprometer/.test(q)) {
    intent = "safe_to_spend";
    confidence = 0.9;
  } else if (/registre|registrar|adicione|adicionar|lance|lancar/.test(q)) {
    intent = "create_transaction";
    confidence = 0.93;
  } else if (/altere|alterar|mude|corrija/.test(q)) {
    intent = "update_transaction";
    confidence = 0.9;
  } else if (/exclua|excluir|apague|remova/.test(q)) {
    intent = "delete_transaction";
    confidence = 0.91;
  } else if (/compare|comparacao|mes passado/.test(q)) {
    intent = "compare_periods";
    confidence = 0.9;
  } else if (/recorr|assinatura/.test(q)) {
    intent = "recurring";
    confidence = 0.94;
  } else if (/anormal|fora do normal|fora do padrao/.test(q)) {
    intent = "anomalies";
    confidence = 0.94;
  } else if (/orcamento|limite/.test(q)) {
    intent = "budgets";
    confidence = 0.88;
  } else if (/meta|objetivo|guardar por mes|alcancarei/.test(q)) {
    intent = "goals";
    confidence = 0.88;
  } else if (/poup|economizando|economizar/.test(q)) {
    intent = "savings";
    confidence = 0.87;
  } else if (/projec|fim do mes|quanto posso gastar/.test(q)) {
    intent = "projection";
    confidence = 0.87;
  } else if (/receita|entrada|recebi/.test(q)) {
    intent = "income_summary";
    confidence = 0.82;
  } else if (/saldo|sobrou|restou/.test(q)) {
    intent = "balance_summary";
    confidence = 0.82;
  } else if (category && /gastei|gasto|despesa|quanto/.test(q)) {
    intent = "category_spending";
    confidence = 0.9;
  } else if (/gastei|gastos|despesa|onde estou gastando|onde gasto/.test(q)) {
    intent = "spending_summary";
    confidence = 0.82;
  } else if (semanticIntent && semanticScore >= 0.55) {
    intent = semanticIntent;
    confidence = semanticScore;
  }

  const continuation = applyConversationContinuation({ intent, confidence, q, period, currency, category, memory });
  intent = continuation.intent;
  confidence = continuation.confidence;
  period = continuation.period;
  currency = continuation.currency;
  category = continuation.category;

  if (intent === "compare_periods" && /este mes|mes atual/.test(q)) {
    period = resolvePeriod("this_month", now);
  }

  const money = extractAmountAndCurrency(original, q);
  if (!currency) currency = money.currency;
  const filters = { period, currency, category, type, tags };
  const result = {
    intent,
    confidence,
    filters,
    entities: {
      amount: extracted.amount,
      currency,
      accountId: extracted.accountId,
      accountName: extracted.accountName,
      accountAmbiguous: extracted.accountAmbiguous,
      accountCandidates: extracted.accountCandidates,
      action: extracted.action,
      direction: extracted.direction
    },
    raw: original
  };

  if (["account_balance", "account_zero_balance", "account_target"].includes(intent)) {
    result.entities.targetAmount = intent === "account_target" && extracted.amount !== null
      ? Math.abs(extracted.amount)
      : null;
    if (extracted.accountAmbiguous) result.confidence = Math.min(result.confidence, 0.76);
    if (!extracted.accountId && !currency && !memory?.lastFilters?.currency) {
      result.confidence = Math.min(result.confidence, 0.72);
    }
  }

  if (intent === "create_transaction") {
    result.entities = {
      amount: money.amount,
      currency: currency || null,
      type: /recebi|entrada|receita/.test(q) ? "income" : "expense",
      category,
      date: explicitRelativeDate(q, now) || todayLocalISO(now),
      description: category || (type === "income" ? "Receita" : "Despesa")
    };
    if (!money.amount || !result.entities.currency) result.confidence -= 0.28;
  }

  if (intent === "update_transaction" || intent === "delete_transaction") {
    result.entities = {
      amount: money.amount,
      currency,
      category,
      date: explicitRelativeDate(q, now),
      last: /ultima/.test(q)
    };
  }

  if (intent === "create_transfer") {
    const { sourceAccount, destinationAccount } = findTransferAccounts(q, accounts);
    result.entities = {
      amount: money.amount,
      currency,
      sourceAccountId: sourceAccount?.id || null,
      destinationAccountId: destinationAccount?.id || null,
      date: explicitRelativeDate(q, now) || todayLocalISO(now)
    };
    if (!money.amount || !sourceAccount || !destinationAccount) result.confidence -= 0.3;
  }

  if (intent === "mark_schedule_paid") {
    const schedule = findNamedEntity(q, schedules);
    result.entities = {
      scheduleId: schedule?.id || null,
      date: explicitRelativeDate(q, now) || todayLocalISO(now)
    };
    if (!schedule) result.confidence -= 0.3;
  }

  if (intent === "reconciliation_status") {
    const account = findNamedEntity(q, accounts);
    result.entities = { accountId: account?.id || null };
  }

  if (intent === "liabilities") {
    const account = findNamedEntity(q, accounts);
    result.entities = { accountId: account?.id || null };
  }

  if (intent === "create_rule") {
    result.entities = detectRuleEntities(original, q, categories);
    if (!result.entities.needle || !result.entities.category) result.confidence -= 0.32;
  }

  if (!INTENTS.has(result.intent)) result.intent = "unknown";
  return result;
}
