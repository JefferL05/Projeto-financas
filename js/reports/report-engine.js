import { accountSummary, availableFunds, netWorth } from "../accounts/account-balance.js";
import { analyzeFinancialData, filterTransactions } from "../finance/analytics-engine.js";
import { convertTransaction } from "../finance/exchange.js";

export function buildReport({
  transactions = [],
  accounts = [],
  goals = [],
  budgets = [],
  schedules = [],
  rates = [],
  rate = 1300,
  baseCurrency = "PYG",
  period,
  filters = {}
}) {
  const analysis = analyzeFinancialData({
    transactions,
    goals,
    budgets,
    rate,
    rates,
    period,
    filters
  });

  const accountSummaries = accounts
    .filter((account) => !account.archived)
    .map((account) => accountSummary(account, transactions, { baseCurrency, rate }));

  const filteredTransactions = filterTransactions(transactions, { ...filters, period });
  const futureCommitments = schedules
    .filter((schedule) => schedule.active !== false && schedule.nextDueDate >= period.start)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));

  return {
    period,
    filters,
    analysis,
    accountSummaries,
    netWorth: netWorth(accounts, transactions, { baseCurrency, rate }),
    available: availableFunds(accounts, transactions, { baseCurrency, rate }),
    futureCommitments,
    filteredTransactions,
    baseCurrency
  };
}

export function safeToSpend({
  accounts = [],
  transactions = [],
  schedules = [],
  goals = [],
  budgets = [],
  rate = 1300,
  baseCurrency = "PYG",
  untilDate
}) {
  if (!accounts.length || !untilDate) {
    return { available: false, reason: "Ainda não há dados suficientes para calcular um valor seguro para gastar." };
  }

  const liquid = availableFunds(accounts, transactions, { baseCurrency, rate });
  const commitments = schedules
    .filter((schedule) => schedule.active !== false && schedule.nextDueDate <= untilDate && schedule.kind !== "income")
    .reduce((sum, schedule) => sum + convertTransaction({
      amount: schedule.amount,
      currency: schedule.currency,
      date: schedule.nextDueDate,
      exchangeRateSnapshot: schedule.exchangeRateSnapshot || null
    }, baseCurrency, [], rate).amount, 0);

  const goalReservations = goals.reduce((sum, goal) => {
    if (!goal.monthly) return sum;
    return sum + (goal.currency === baseCurrency ? Number(goal.monthly) : baseCurrency === "PYG" ? Number(goal.monthly) * rate : Number(goal.monthly) / rate);
  }, 0);

  const budgetCommitted = budgets.reduce((sum, budget) => {
    if (!budget.limit) return sum;
    return sum + (budget.currency === baseCurrency ? Number(budget.limit) : baseCurrency === "PYG" ? Number(budget.limit) * rate : Number(budget.limit) / rate);
  }, 0);

  const potential = liquid - commitments - goalReservations - budgetCommitted;
  return {
    available: true,
    value: Math.max(0, potential),
    baseCurrency,
    components: {
      availableFunds: liquid,
      commitments,
      goalReservations,
      budgetCommitted
    },
    note: "Estimativa potencial, não garantia de disponibilidade futura."
  };
}
