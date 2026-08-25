import { comparablePreviousPeriod, inPeriod, previousPeriod } from "./period-utils.js";
import { monthlyProjection, goalProjection } from "./projections.js";
import { detectRecurring } from "./recurring-detector.js";
import { detectAnomalies } from "./anomaly-detector.js";
import { evaluateBudgets, projectedBudgetStatus } from "./budget-engine.js";
import { convertTransaction } from "./exchange.js";

const VALID_CURRENCIES = new Set(["BRL", "PYG"]);
const VALID_TYPES = new Set(["income", "expense", "transfer"]);

export function validateTransactions(transactions = []) {
  return transactions.filter((transaction) =>
    transaction
    && transaction.id
    && VALID_CURRENCIES.has(transaction.currency)
    && VALID_TYPES.has(transaction.type)
    && Number.isFinite(Number(transaction.amount))
    && Number(transaction.amount) >= 0
    && /^\d{4}-\d{2}-\d{2}$/.test(transaction.date || "")
  );
}

export function filterTransactions(transactions, filters = {}) {
  return validateTransactions(transactions).filter((transaction) => {
    if (filters.period && !inPeriod(transaction.date, filters.period)) return false;
    if (filters.currency && transaction.currency !== filters.currency) return false;
    if (filters.type && transaction.type !== filters.type) return false;
    if (filters.category && String(transaction.category).toLowerCase() !== String(filters.category).toLowerCase()) return false;
    if (filters.accountId && transaction.accountId !== filters.accountId) return false;
    if (filters.status && transaction.status !== filters.status) return false;
    if (filters.tags?.length && !filters.tags.every((tag) => (transaction.tags || []).map((item) => item.toLowerCase()).includes(tag.toLowerCase()))) return false;
    return true;
  });
}

function aggregate(transactions, { rate, rates }) {
  let incomePYG = 0;
  let expensePYG = 0;
  let incomeBRL = 0;
  let expenseBRL = 0;
  let approximate = false;

  const originalByCurrency = {
    BRL: { income: 0, expense: 0 },
    PYG: { income: 0, expense: 0 }
  };
  const categories = new Map();
  const days = new Map();

  for (const transaction of transactions) {
    if (transaction.type === "transfer") continue;

    const amount = Number(transaction.amount);
    originalByCurrency[transaction.currency][transaction.type] += amount;

    const toPYG = convertTransaction(transaction, "PYG", rates, rate);
    const toBRL = convertTransaction(transaction, "BRL", rates, rate);
    approximate ||= toPYG.approximate || toBRL.approximate;

    if (transaction.type === "income") {
      incomePYG += toPYG.amount;
      incomeBRL += toBRL.amount;
    } else {
      expensePYG += toPYG.amount;
      expenseBRL += toBRL.amount;
      const key = transaction.category || "Outros";
      categories.set(key, (categories.get(key) || 0) + toPYG.amount);
      days.set(transaction.date, (days.get(transaction.date) || 0) + toPYG.amount);
    }
  }

  const balancePYG = incomePYG - expensePYG;
  const balanceBRL = incomeBRL - expenseBRL;
  const savingsRate = incomePYG > 0 ? balancePYG / incomePYG * 100 : null;

  return {
    incomePYG,
    expensePYG,
    balancePYG,
    incomeBRL,
    expenseBRL,
    balanceBRL,
    savingsRate,
    originalByCurrency,
    categories: [...categories.entries()]
      .map(([category, valuePYG]) => ({ category, valuePYG }))
      .sort((a, b) => b.valuePYG - a.valuePYG),
    spendingDays: [...days.entries()]
      .map(([date, valuePYG]) => ({ date, valuePYG }))
      .sort((a, b) => b.valuePYG - a.valuePYG),
    approximate
  };
}

function comparisonObject(currentTotals, previousTotals) {
  const variationPercent = previousTotals.expensePYG > 0
    ? (currentTotals.expensePYG - previousTotals.expensePYG) / previousTotals.expensePYG * 100
    : null;

  return {
    expenseDifferencePYG: currentTotals.expensePYG - previousTotals.expensePYG,
    expenseDifferenceBRL: currentTotals.expenseBRL - previousTotals.expenseBRL,
    variationPercent,
    direction: variationPercent === null
      ? "unknown"
      : variationPercent > 0
        ? "up"
        : variationPercent < 0
          ? "down"
          : "stable"
  };
}

export function analyzeFinancialData({
  transactions = [],
  goals = [],
  budgets = [],
  rate = 1300,
  rates = [],
  period,
  filters = {},
  now = new Date()
}) {
  const safeRate = Number(rate) > 0 ? Number(rate) : 1300;
  const allSafe = validateTransactions(transactions);
  const scoped = filterTransactions(allSafe, { ...filters, period });
  const totals = aggregate(scoped, { rate: safeRate, rates });

  const previous = previousPeriod(period);
  const previousTransactions = filterTransactions(allSafe, { ...filters, period: previous });
  const previousTotals = aggregate(previousTransactions, { rate: safeRate, rates });

  const sameDaysPeriod = comparablePreviousPeriod(period, now);
  const sameDaysTransactions = sameDaysPeriod
    ? filterTransactions(allSafe, { ...filters, period: sameDaysPeriod })
    : [];
  const sameDaysTotals = sameDaysPeriod
    ? aggregate(sameDaysTransactions, { rate: safeRate, rates })
    : null;

  const projection = monthlyProjection(totals.expensePYG, period, now);
  const largestTransactions = [...scoped]
    .filter((transaction) => transaction.type === "expense")
    .map((transaction) => {
      const converted = convertTransaction(transaction, "PYG", rates, safeRate);
      return {
        ...transaction,
        convertedPYG: converted.amount,
        conversionApproximate: converted.approximate,
        conversionRate: converted.rate
      };
    })
    .sort((a, b) => b.convertedPYG - a.convertedPYG)
    .slice(0, 10);

  const recurring = detectRecurring(allSafe.filter((transaction) => transaction.type === "expense"));
  const anomalies = detectAnomalies(allSafe.filter((transaction) => transaction.type === "expense"));
  const goalMetrics = goals.map((goal) => ({ goal, projection: goalProjection(goal, now) }));
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const budgetMetrics = evaluateBudgets({ budgets, transactions: allSafe, rate: safeRate, rates, month: monthKey }).map((budget) => ({
    ...budget,
    projection: projectedBudgetStatus(
      budget,
      Math.max(1, now.getDate()),
      new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    )
  }));

  return {
    period,
    filters,
    transactionCount: scoped.filter((transaction) => transaction.type !== "transfer").length,
    transferCount: scoped.filter((transaction) => transaction.type === "transfer").length,
    ...totals,
    previous: { period: previous, ...previousTotals },
    comparison: comparisonObject(totals, previousTotals),
    fairComparison: sameDaysTotals
      ? {
          period: sameDaysPeriod,
          ...sameDaysTotals,
          comparison: comparisonObject(totals, sameDaysTotals)
        }
      : null,
    projection,
    largestTransactions,
    recurring,
    anomalies,
    goals: goalMetrics,
    budgets: budgetMetrics,
    commitmentRate: totals.incomePYG > 0 ? totals.expensePYG / totals.incomePYG * 100 : null,
    approximate: totals.approximate,
    rate: safeRate
  };
}
