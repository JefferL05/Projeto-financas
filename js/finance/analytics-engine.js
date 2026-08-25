import { normalizeToPYG } from "../utils.js";
import { inPeriod, previousPeriod } from "./period-utils.js";
import { monthlyProjection, goalProjection } from "./projections.js";
import { detectRecurring } from "./recurring-detector.js";
import { detectAnomalies } from "./anomaly-detector.js";
import { evaluateBudgets, projectedBudgetStatus } from "./budget-engine.js";

const VALID_CURRENCIES = new Set(["BRL", "PYG"]);
const VALID_TYPES = new Set(["income", "expense"]);

export function validateTransactions(transactions = []) {
  return transactions.filter((t) => t && t.id && VALID_CURRENCIES.has(t.currency) && VALID_TYPES.has(t.type)
    && Number.isFinite(Number(t.amount)) && Number(t.amount) >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date || ""));
}

export function filterTransactions(transactions, filters = {}) {
  return validateTransactions(transactions).filter((t) => {
    if (filters.period && !inPeriod(t.date, filters.period)) return false;
    if (filters.currency && t.currency !== filters.currency) return false;
    if (filters.type && t.type !== filters.type) return false;
    if (filters.category && String(t.category).toLowerCase() !== String(filters.category).toLowerCase()) return false;
    if (filters.tags?.length && !filters.tags.every((tag) => (t.tags || []).map((x) => x.toLowerCase()).includes(tag.toLowerCase()))) return false;
    return true;
  });
}

function aggregate(txs, rate) {
  let incomePYG = 0;
  let expensePYG = 0;
  const originalByCurrency = { BRL: { income: 0, expense: 0 }, PYG: { income: 0, expense: 0 } };
  const categories = new Map();
  const days = new Map();

  for (const t of txs) {
    const amount = Number(t.amount);
    originalByCurrency[t.currency][t.type] += amount;
    const pyg = normalizeToPYG(amount, t.currency, rate);
    if (t.type === "income") incomePYG += pyg;
    else {
      expensePYG += pyg;
      categories.set(t.category || "Outros", (categories.get(t.category || "Outros") || 0) + pyg);
      days.set(t.date, (days.get(t.date) || 0) + pyg);
    }
  }

  const balancePYG = incomePYG - expensePYG;
  const savingsRate = incomePYG > 0 ? balancePYG / incomePYG * 100 : null;
  return {
    incomePYG,
    expensePYG,
    balancePYG,
    savingsRate,
    originalByCurrency,
    categories: [...categories.entries()].map(([category, valuePYG]) => ({ category, valuePYG })).sort((a, b) => b.valuePYG - a.valuePYG),
    spendingDays: [...days.entries()].map(([date, valuePYG]) => ({ date, valuePYG })).sort((a, b) => b.valuePYG - a.valuePYG)
  };
}

export function analyzeFinancialData({ transactions = [], goals = [], budgets = [], rate = 1300, period, filters = {}, now = new Date() }) {
  const safeRate = Number(rate) > 0 ? Number(rate) : 1300;
  const scoped = filterTransactions(transactions, { ...filters, period });
  const totals = aggregate(scoped, safeRate);
  const previous = previousPeriod(period);
  const previousTx = filterTransactions(transactions, { ...filters, period: previous });
  const previousTotals = aggregate(previousTx, safeRate);
  const variationPercent = previousTotals.expensePYG > 0
    ? (totals.expensePYG - previousTotals.expensePYG) / previousTotals.expensePYG * 100
    : null;
  const projection = monthlyProjection(totals.expensePYG, period, now);

  const largestTransactions = [...scoped]
    .filter((t) => t.type === "expense")
    .sort((a, b) => normalizeToPYG(b.amount, b.currency, safeRate) - normalizeToPYG(a.amount, a.currency, safeRate))
    .slice(0, 10)
    .map((t) => ({ ...t, convertedPYG: normalizeToPYG(t.amount, t.currency, safeRate) }));

  const allSafe = validateTransactions(transactions);
  const recurring = detectRecurring(allSafe);
  const anomalies = detectAnomalies(allSafe);
  const goalMetrics = goals.map((goal) => ({ goal, projection: goalProjection(goal, now) }));
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const budgetMetrics = evaluateBudgets({ budgets, transactions: allSafe, rate: safeRate, month: monthKey }).map((b) => ({
    ...b,
    projection: projectedBudgetStatus(b, Math.max(1, now.getDate()), new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())
  }));

  return {
    period,
    filters,
    transactionCount: scoped.length,
    ...totals,
    previous: { period: previous, ...previousTotals },
    comparison: {
      expenseDifferencePYG: totals.expensePYG - previousTotals.expensePYG,
      variationPercent,
      direction: variationPercent === null ? "unknown" : variationPercent > 0 ? "up" : variationPercent < 0 ? "down" : "stable"
    },
    projection,
    largestTransactions,
    recurring,
    anomalies,
    goals: goalMetrics,
    budgets: budgetMetrics,
    commitmentRate: totals.incomePYG > 0 ? totals.expensePYG / totals.incomePYG * 100 : null,
    approximate: scoped.some((t) => t.currency === "BRL"),
    rate: safeRate
  };
}
