import { extractPeriodFromText } from "../finance/period-utils.js";
import { normalizeText } from "./validators.js";
import { parseLooseNumber } from "../utils.js";

const INTENTS = [
  "spending_summary", "income_summary", "balance_summary", "category_spending", "compare_periods",
  "savings", "projection", "recurring", "anomalies", "budgets", "goals", "create_transaction",
  "update_transaction", "delete_transaction", "unknown"
];

function detectCurrency(q) {
  if (/\b(brl|reais?|r\$)\b/.test(q)) return "BRL";
  if (/\b(pyg|guaranis?|gs\.?)\b/.test(q)) return "PYG";
  return null;
}

function detectCategory(q, categories = []) {
  const normalized = categories.map((c) => ({ original: c, normalized: normalizeText(c).toLowerCase() }));
  const found = normalized.find((c) => q.includes(c.normalized));
  if (found) return found.original;
  const aliases = {
    mercado: "Mercado", supermercado: "Mercado", gasolina: "Combustível", combustivel: "Combustível",
    almoco: "Alimentação", jantar: "Alimentação", comida: "Alimentação", transporte: "Transporte",
    uber: "Transporte", farmacia: "Saúde", aluguel: "Moradia", salario: "Salário"
  };
  const alias = Object.entries(aliases).find(([key]) => q.includes(key));
  return alias?.[1] || null;
}

function extractAmountAndCurrency(original, normalized) {
  const money = original.match(/(?:r\$|gs\.?|₲)?\s*-?\d[\d.,]*/i)?.[0];
  if (!money) return { amount: null, currency: detectCurrency(normalized) };
  return { amount: Math.abs(parseLooseNumber(money)), currency: detectCurrency(normalized) };
}

function relativeDate(q, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (/ontem/.test(q)) date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function routeIntent(question, { categories = [], memory = null, now = new Date() } = {}) {
  const original = String(question || "").trim();
  const q = normalizeText(original).toLowerCase();
  const period = extractPeriodFromText(q, now);
  let currency = detectCurrency(q);
  let category = detectCategory(q, categories);
  const type = /receita|entrada|recebi|salario/.test(q) ? "income" : /gasto|despesa|saida|paguei|compra/.test(q) ? "expense" : null;
  const tags = [...q.matchAll(/#([a-z0-9_-]+)/g)].map((m) => m[1]);

  if (!category && /e no mes passado|e no mês passado|e ontem|e hoje/.test(q)) category = memory?.lastFilters?.category || null;
  if (!currency && /^e\b/.test(q)) currency = memory?.lastFilters?.currency || null;

  let intent = "unknown";
  let confidence = 0.45;
  if (/registre|registrar|adicione|adicionar|lance|lancar|lançar/.test(q)) { intent = "create_transaction"; confidence = 0.93; }
  else if (/altere|alterar|mude|corrija/.test(q)) { intent = "update_transaction"; confidence = 0.9; }
  else if (/exclua|excluir|apague|remova/.test(q)) { intent = "delete_transaction"; confidence = 0.91; }
  else if (/compare|comparacao|comparação|mes passado|mês passado/.test(q)) { intent = "compare_periods"; confidence = 0.9; }
  else if (/recorr|assinatura/.test(q)) { intent = "recurring"; confidence = 0.94; }
  else if (/anormal|fora do normal|fora do padrao|fora do padrão/.test(q)) { intent = "anomalies"; confidence = 0.94; }
  else if (/orcamento|orçamento|limite/.test(q)) { intent = "budgets"; confidence = 0.88; }
  else if (/meta|objetivo|guardar por mes|guardar por mês|alcancarei|alcançarei/.test(q)) { intent = "goals"; confidence = 0.88; }
  else if (/poup|economizando|economizar/.test(q)) { intent = "savings"; confidence = 0.87; }
  else if (/projec|fim do mes|fim do mês|quanto posso gastar/.test(q)) { intent = "projection"; confidence = 0.87; }
  else if (/receita|entrada|recebi/.test(q)) { intent = "income_summary"; confidence = 0.82; }
  else if (/saldo|sobrou|restou/.test(q)) { intent = "balance_summary"; confidence = 0.82; }
  else if (category && /gastei|gasto|despesa|quanto/.test(q)) { intent = "category_spending"; confidence = 0.9; }
  else if (/gastei|gastos|despesa|onde estou gastando|onde gasto/.test(q)) { intent = "spending_summary"; confidence = 0.82; }

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
      date: relativeDate(q, now),
      description: category || (type === "income" ? "Receita" : "Despesa")
    };
    if (!money.amount || !result.entities.currency) confidence -= 0.28;
  }

  if (intent === "update_transaction" || intent === "delete_transaction") {
    result.entities = { amount: money.amount, currency, category, date: relativeDate(q, now), last: /ultima|última/.test(q) };
  }

  if (!INTENTS.includes(result.intent)) result.intent = "unknown";
  return result;
}
