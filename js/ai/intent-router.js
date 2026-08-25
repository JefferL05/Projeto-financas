import { extractPeriodFromText, resolvePeriod } from "../finance/period-utils.js";
import { todayLocalISO, yesterdayLocalISO } from "../finance/date-utils.js";
import { normalizeText } from "./validators.js";
import { parseLooseNumber } from "../utils.js";

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

export function routeIntent(question, {
  categories = [],
  accounts = [],
  schedules = [],
  memory = null,
  now = new Date()
} = {}) {
  const original = String(question || "").trim();
  const q = normalizeText(original).toLowerCase();
  let period = extractPeriodFromText(q, now);
  let currency = detectCurrency(q);
  let category = detectCategory(q, categories);
  const type = /receita|entrada|recebi|salario/.test(q)
    ? "income"
    : /gasto|despesa|saida|paguei|compra/.test(q)
      ? "expense"
      : null;
  const tags = [...q.matchAll(/#([a-z0-9_-]+)/g)].map((match) => match[1]);

  if (!category && /e no mes passado|e no mês passado|e ontem|e hoje/.test(q)) {
    category = memory?.lastFilters?.category || null;
  }
  if (!currency && /^e\b/.test(q)) currency = memory?.lastFilters?.currency || null;

  let intent = "unknown";
  let confidence = 0.45;

  if (/\btransfira|\btransferir|\btransfere/.test(q)) {
    intent = "create_transfer";
    confidence = 0.93;
  } else if (/marque.+(?:paga|pago)|marcar.+(?:paga|pago)/.test(q)) {
    intent = "mark_schedule_paid";
    confidence = 0.9;
  } else if (/crie.+regra|criar.+regra|regra.+categor/.test(q)) {
    intent = "create_rule";
    confidence = 0.88;
  } else if (/quanto tenho disponivel|quanto tenho disponível|dinheiro disponivel|dinheiro disponível/.test(q)) {
    intent = "available_funds";
    confidence = 0.94;
  } else if (/patrimonio|patrimônio|quanto tenho no total/.test(q)) {
    intent = "net_worth";
    confidence = 0.93;
  } else if (/quanto devo|divida|dívida|cartao|cartão/.test(q)) {
    intent = "liabilities";
    confidence = 0.87;
  } else if (/contas? vence|vence esta|vencem|compromiss|proximas contas|próximas contas/.test(q)) {
    intent = "upcoming_commitments";
    confidence = 0.9;
  } else if (/conciliad|conciliacao|conciliação/.test(q)) {
    intent = "reconciliation_status";
    confidence = 0.9;
  } else if (/seguro para gastar|valor seguro|posso gastar sem comprometer/.test(q)) {
    intent = "safe_to_spend";
    confidence = 0.9;
  } else if (/registre|registrar|adicione|adicionar|lance|lancar|lançar/.test(q)) {
    intent = "create_transaction";
    confidence = 0.93;
  } else if (/altere|alterar|mude|corrija/.test(q)) {
    intent = "update_transaction";
    confidence = 0.9;
  } else if (/exclua|excluir|apague|remova/.test(q)) {
    intent = "delete_transaction";
    confidence = 0.91;
  } else if (/compare|comparacao|comparação|mes passado|mês passado/.test(q)) {
    intent = "compare_periods";
    confidence = 0.9;
  } else if (/recorr|assinatura/.test(q)) {
    intent = "recurring";
    confidence = 0.94;
  } else if (/anormal|fora do normal|fora do padrao|fora do padrão/.test(q)) {
    intent = "anomalies";
    confidence = 0.94;
  } else if (/orcamento|orçamento|limite/.test(q)) {
    intent = "budgets";
    confidence = 0.88;
  } else if (/meta|objetivo|guardar por mes|guardar por mês|alcancarei|alcançarei/.test(q)) {
    intent = "goals";
    confidence = 0.88;
  } else if (/poup|economizando|economizar/.test(q)) {
    intent = "savings";
    confidence = 0.87;
  } else if (/projec|fim do mes|fim do mês|quanto posso gastar/.test(q)) {
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
  }

  if (intent === "compare_periods" && /este mes|este mês|mes atual|mês atual/.test(q)) {
    period = resolvePeriod("this_month", now);
  }

  const money = extractAmountAndCurrency(original, q);
  if (!currency) currency = money.currency;
  const filters = { period, currency, category, type, tags };
  const result = { intent, confidence, filters, entities: {}, raw: original };

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
      last: /ultima|última/.test(q)
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
