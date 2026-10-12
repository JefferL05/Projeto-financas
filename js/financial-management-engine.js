import { detectAnomalies } from "./finance/anomaly-detector.js";
import { detectRecurring } from "./finance/recurring-detector.js";
import { evaluateBudgets } from "./finance/budget-engine.js";
import { convertTransaction } from "./finance/exchange.js";

const CURRENCIES = ["BRL", "PYG"];
const TYPES = new Set(["income", "expense", "transfer"]);
const DAY = 86400000;

export function normalizeTransactions(transactions = []) {
  return transactions.filter((tx) =>
    tx && tx.id && TYPES.has(tx.type) && CURRENCIES.includes(tx.currency) &&
    Number.isFinite(Number(tx.amount)) && Number(tx.amount) > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(tx.date || "")
  );
}

export function periodForMonth(month) {
  const parts = String(month || "").split("-").map(Number);
  if (parts.length !== 2 || !parts[0] || parts[1] < 1 || parts[1] > 12) {
    throw new TypeError("Período mensal inválido.");
  }
  const year = parts[0];
  const monthIndex = parts[1] - 1;
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  return { start: isoDate(start), end: isoDate(end), month: year + "-" + String(parts[1]).padStart(2, "0") };
}

function isoDate(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function shiftMonth(month, offset) {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(year, m - 1 + offset, 1);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

function inRange(tx, period) {
  return tx.date >= period.start && tx.date <= period.end;
}

function sameCurrencyTotals(transactions) {
  return Object.fromEntries(CURRENCIES.map((currency) => {
    const items = transactions.filter((tx) => tx.currency === currency && tx.type !== "transfer");
    const income = items.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + Number(tx.amount), 0);
    const expense = items.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + Number(tx.amount), 0);
    return [currency, { income, expense, net: income - expense, count: items.length }];
  }));
}

function categoryTotals(transactions) {
  const map = new Map();
  for (const tx of transactions) {
    if (tx.type !== "expense") continue;
    const key = tx.currency + "|" + (tx.category || "Outros");
    map.set(key, (map.get(key) || 0) + Number(tx.amount));
  }
  return [...map.entries()].map(([key, amount]) => {
    const parts = key.split("|");
    return { currency: parts[0], category: parts.slice(1).join("|"), amount };
  }).sort((a, b) => b.amount - a.amount);
}

function normalizedDescription(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\d+/g, "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function detectPossibleDuplicates(transactions = []) {
  const expenses = normalizeTransactions(transactions).filter((tx) => tx.type === "expense");
  const groups = new Map();
  for (const tx of expenses) {
    const key = [tx.date, tx.currency, Number(tx.amount).toFixed(2), tx.category || "", normalizedDescription(tx.description)].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }
  return [...groups.values()].filter((items) => items.length > 1).map((items) => ({
    id: "duplicate-" + items.map((tx) => tx.id).sort().join("-"),
    type: "possible-duplicate",
    currency: items[0].currency,
    amount: Number(items[0].amount),
    date: items[0].date,
    description: items[0].description || items[0].category || "Despesa",
    category: items[0].category || "Outros",
    transactionIds: items.map((tx) => tx.id),
    evidence: items.length + " despesas com mesma data, moeda, valor e descrição/categoria.",
    confidence: "suspeita",
    action: "Confira os lançamentos originais. Nenhum registro será removido automaticamente."
  }));
}

export function calculateManagementSnapshot({
  transactions = [], accounts = [], schedules = [], goals = [], budgets = [],
  settings = [], rates = [], month, now = new Date(), currency = null,
  category = null, type = null
} = {}) {
  const currentMonth = month || (now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0"));
  const currentPeriod = periodForMonth(currentMonth);
  const previousPeriod = periodForMonth(shiftMonth(currentMonth, -1));
  const settingMap = Object.fromEntries(settings.map((item) => [item.key, item.value]));
  const rate = Number(settingMap.brlToPyg) > 0 ? Number(settingMap.brlToPyg) : 1300;
  const valid = normalizeTransactions(transactions);
  const visible = valid.filter((tx) =>
    (!currency || tx.currency === currency) &&
    (!category || tx.category === category) &&
    (!type || tx.type === type)
  );
  const currentItems = visible.filter((tx) => inRange(tx, currentPeriod) && tx.type !== "transfer");
  const previousItems = visible.filter((tx) => inRange(tx, previousPeriod) && tx.type !== "transfer");
  const currentTotals = sameCurrencyTotals(currentItems);
  const previousTotals = sameCurrencyTotals(previousItems);
  const comparisonMonths = [currentMonth, shiftMonth(currentMonth, -1), shiftMonth(currentMonth, -2)];
  const averageTotals = Object.fromEntries(CURRENCIES.map((code) => {
    const monthsWithRecords = comparisonMonths.map((monthKeyValue) => {
      const monthItems = valid.filter((tx) => tx.currency === code && tx.date.startsWith(monthKeyValue) && tx.type !== "transfer");
      return { month: monthKeyValue, totals: sameCurrencyTotals(monthItems)[code], hasRecords: monthItems.length > 0 };
    }).filter((entry) => entry.hasRecords);
    const sampleMonths = monthsWithRecords.length;
    return [code, {
      income: sampleMonths ? monthsWithRecords.reduce((sum, entry) => sum + entry.totals.income, 0) / sampleMonths : 0,
      expense: sampleMonths ? monthsWithRecords.reduce((sum, entry) => sum + entry.totals.expense, 0) / sampleMonths : 0,
      sampleMonths
    }];
  }));
  const categories = categoryTotals(currentItems);
  const previousCategories = categoryTotals(previousItems);
  const suggestedBudgets = CURRENCIES.flatMap((code) => {
    const categoryNames = [...new Set(valid.filter((tx) => tx.type === "expense" && tx.currency === code && comparisonMonths.includes(tx.date.slice(0, 7))).map((tx) => tx.category || "Outros"))];
    return categoryNames.map((name) => {
      const months = comparisonMonths.map((monthKeyValue) => ({
        month: monthKeyValue,
        amount: valid.filter((tx) => tx.type === "expense" && tx.currency === code && tx.date.startsWith(monthKeyValue) && (tx.category || "Outros") === name).reduce((sum, tx) => sum + Number(tx.amount), 0)
      }));
      const activeMonths = months.filter((entry) => entry.amount > 0);
      if (activeMonths.length < 2) return null;
      const averageMonthly = activeMonths.reduce((sum, entry) => sum + entry.amount, 0) / activeMonths.length;
      return { category: name, currency: code, averageMonthly, suggestedLimit: averageMonthly * 1.05, sampleMonths: activeMonths.length, methodology: "Média dos meses com gasto registrado + margem de 5%; revise se os meses forem atípicos." };
    }).filter(Boolean);
  }).filter((item) => (!currency || item.currency === currency) && (!category || item.category === category)).sort((a, b) => b.averageMonthly - a.averageMonthly);
  const categoryChanges = categories.map((item) => {
    const previous = previousCategories.find((other) => other.currency === item.currency && other.category === item.category);
    const priorAmount = previous ? previous.amount : 0;
    return {
      ...item,
      previousAmount: priorAmount,
      difference: item.amount - priorAmount,
      changePercent: priorAmount > 0 ? ((item.amount - priorAmount) / priorAmount) * 100 : null,
      isNew: priorAmount === 0
    };
  }).sort((a, b) => b.difference - a.difference);
  const monthBudgets = budgets.filter((budget) => budget.period === currentMonth && (!currency || budget.currency === currency) && (!category || budget.category === category));
  const budgetStatus = evaluateBudgets({ budgets: monthBudgets, transactions: valid, rate, rates, month: currentMonth });
  const expenseAnalysisEnabled = !type || type === "expense";
  const anomalies = expenseAnalysisEnabled ? detectAnomalies(valid).filter((item) => (!currency || item.currency === currency) && (!category || item.category === category)) : [];
  const recurring = expenseAnalysisEnabled ? detectRecurring(valid).filter((item) => (!currency || item.currency === currency) && (!category || item.category === category)) : [];
  const duplicates = expenseAnalysisEnabled ? detectPossibleDuplicates(valid).filter((item) => (!currency || item.currency === currency) && (!category || item.category === category)) : [];
  const daysInMonth = new Date(Number(currentMonth.slice(0, 4)), Number(currentMonth.slice(5, 7)), 0).getDate();
  const elapsedDays = currentMonth === (now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0"))
    ? Math.max(1, now.getDate())
    : daysInMonth;
  const projectedExpense = Object.fromEntries(CURRENCIES.map((code) => {
    const expense = currentTotals[code].expense;
    return [code, { actual: expense, projected: expense / elapsedDays * daysInMonth, elapsedDays, daysInMonth, estimate: currentMonth === (now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0")) }];
  }));
  const incomeCommitment = Object.fromEntries(CURRENCIES.map((code) => [code, {
    income: currentTotals[code].income,
    expense: currentTotals[code].expense,
    percent: currentTotals[code].income > 0 ? currentTotals[code].expense / currentTotals[code].income * 100 : null,
    status: currentTotals[code].income <= 0 ? "dados-insuficientes" : currentTotals[code].expense / currentTotals[code].income >= 0.9 ? "alto" : currentTotals[code].expense / currentTotals[code].income >= 0.7 ? "atencao" : "moderado"
  }]));
  const dueSoon = schedules.filter((item) => item.active !== false && item.nextDueDate >= isoDate(now) &&
    item.nextDueDate <= isoDate(new Date(now.getTime() + 30 * DAY)) && (!currency || item.currency === currency))
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
  const goalProgress = goals.filter((goal) => !currency || goal.currency === currency).map((goal) => ({
    ...goal, remaining: Math.max(0, Number(goal.target || 0) - Number(goal.current || 0)),
    progressPercent: Number(goal.target) > 0 ? Math.min(100, Number(goal.current || 0) / Number(goal.target) * 100) : 0
  }));
  const alerts = [];
  categoryChanges.filter((item) => item.previousAmount > 0 && item.changePercent >= 25 && item.difference > 0).forEach((item) => {
    alerts.push({
      id: "category-growth-" + item.currency + "-" + item.category,
      category: item.category,
      severity: item.changePercent >= 50 ? "high" : "medium",
      title: "Aumento de gastos: " + item.category,
      currency: item.currency,
      impact: item.difference,
      evidence: "Subiu " + item.changePercent.toFixed(0) + "% em relação ao mês anterior (" + item.previousAmount.toFixed(2) + " → " + item.amount.toFixed(2) + ").",
      action: "Revise os lançamentos desta categoria e defina um limite para o próximo mês."
    });
  });
  anomalies.forEach((item) => alerts.push({
    id: "anomaly-" + item.transactionId, category: item.category, severity: "medium", title: "Despesa fora do histórico: " + (item.description || item.category),
    currency: item.currency, impact: Math.max(0, item.amount - item.categoryMedian),
    evidence: item.criterion, action: "Confirme se foi uma despesa excepcional antes de ajustar seu orçamento."
  }));
  duplicates.forEach((item) => alerts.push({
    id: item.id, category: item.description, severity: "medium", title: "Possível lançamento duplicado",
    currency: item.currency, impact: item.amount, potentialSaving: 0, evidence: item.evidence, action: item.action
  }));
  CURRENCIES.forEach((code) => {
    const totals = currentTotals[code];
    if (totals.income > 0) {
      categories.filter((item) => item.currency === code && item.amount / totals.income >= 0.25).forEach((item) => {
        alerts.push({
          id: "income-share-" + code + "-" + item.category.replace(/[^A-Za-z0-9_-]/g, "-"),
          category: item.category, severity: item.amount / totals.income >= 0.4 ? "high" : "medium",
          title: "Categoria consome parcela elevada da renda: " + item.category,
          currency: code, impact: Math.max(0, item.amount - totals.income * 0.25),
          evidence: item.category + " representa " + (item.amount / totals.income * 100).toFixed(1) + "% das receitas registradas em " + code + " no período.",
          action: "Revise se os lançamentos são essenciais e compare alternativas; não reduza despesas essenciais sem avaliar consequências."
        });
      });
    }
    const commitment = incomeCommitment[code];
    if (commitment.percent !== null && commitment.percent >= 90) {
      alerts.push({
        id: "cashflow-risk-" + code, category: "risco-fluxo-" + code, severity: "high",
        title: "Risco de desequilíbrio financeiro em " + code, currency: code,
        impact: Math.max(0, totals.expense - totals.income),
        evidence: "Despesas equivalem a " + commitment.percent.toFixed(1) + "% da renda registrada neste mês.",
        action: "Revise despesas variáveis, compromissos próximos e margem para imprevistos. O indicador não substitui a análise da sua situação completa."
      });
    }
  });
  budgetStatus.filter((item) => item.status !== "saudavel").forEach((item) => alerts.push({
    id: "budget-" + item.id, severity: item.status === "excedido" ? "high" : "medium",
    title: "Orçamento " + item.status + ": " + item.category, currency: item.currency,
    impact: Math.max(0, item.spent - item.limit),
    evidence: item.spent.toFixed(2) + " gastos de um limite de " + item.limit.toFixed(2) + " (" + item.usedPercent.toFixed(0) + "%).",
    action: "Revise as despesas pendentes e ajuste o limite somente se fizer sentido para sua renda."
  }));
  return {
    month: currentMonth, currentPeriod, previousPeriod, currency: currency || "all", category: category || "all", type: type || "all",
    exchangeRate: rate, validTransactionCount: valid.length, filteredTransactionCount: visible.length,
    currentTotals, previousTotals, averageTotals, categories, categoryChanges, suggestedBudgets, budgetStatus, anomalies, recurring, duplicates,
    projectedExpense, incomeCommitment, dueSoon, goalProgress, alerts,
    hasEnoughHistory: previousItems.length > 0,
    methodology: "BRL e PYG são calculados separadamente; transferências são excluídas de receitas/despesas. A projeção replica a média diária observada no mês e não prevê eventos futuros."
  };
}

export function simulateDecision({ cost = 0, monthlyPayment = 0, months = 1, currency = "PYG", snapshot, transactions = [], schedules = [], goals = [] } = {}) {
  const totalCost = Number(cost);
  const payment = Number(monthlyPayment);
  const duration = Math.max(1, Math.min(600, Math.floor(Number(months) || 1)));
  if (!CURRENCIES.includes(currency) || !Number.isFinite(totalCost) || totalCost < 0 || !Number.isFinite(payment) || payment < 0) {
    throw new TypeError("Informe valores válidos para simular a decisão.");
  }
  const totals = snapshot?.currentTotals?.[currency];
  const average = snapshot?.averageTotals?.[currency];
  const useAverage = Number(average?.sampleMonths || 0) >= 2;
  const monthlyIncome = useAverage ? average.income : (totals?.income || 0);
  const monthlyExpense = useAverage ? average.expense : (totals?.expense || 0);
  const baseline = monthlyIncome - monthlyExpense;
  const recurringCommitments = schedules.filter((item) => item.active !== false && item.currency === currency)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const monthlyImpact = payment || (duration > 1 ? totalCost / duration : totalCost);
  const postDecisionFlow = baseline - monthlyImpact;
  const relevantTransactions = transactions.filter((tx) => tx.currency === currency && tx.type !== "transfer");
  const enoughData = relevantTransactions.length >= 3 && (useAverage || relevantTransactions.length >= 6);
  const currentBalanceKnown = snapshot?.balances && Number.isFinite(snapshot.balances[currency]);
  const reserveBalance = Number(snapshot?.reserveBalances?.[currency] || 0);
  const immediateCost = payment > 0 ? payment : totalCost;
  let recommendation = "Não há informações suficientes para uma recomendação confiável.";
  if (enoughData && monthlyIncome > 0) {
    recommendation = postDecisionFlow < 0 ? "A decisão pode gerar déficit mensal com base na média histórica disponível." :
      currentBalanceKnown && immediateCost > Number(snapshot.balances[currency]) && reserveBalance <= 0 ? "A compra imediata supera o saldo líquido disponível registrado; confirme a forma de pagamento e a reserva antes de decidir." :
      monthlyImpact > monthlyIncome * 0.2 ? "O impacto é relevante em relação à renda; compare alternativas e preserve uma reserva." :
      "O fluxo estimado permanece positivo, mas confira compromissos, reserva e despesas essenciais antes de decidir.";
  }
  const scenarios = [
    { name: "Conservador", income: monthlyIncome * 0.9, expense: monthlyExpense * 1.1 },
    { name: "Intermediário", income: monthlyIncome, expense: monthlyExpense },
    { name: "Otimista", income: monthlyIncome * 1.05, expense: monthlyExpense * 0.95 }
  ].map((scenario) => ({ ...scenario, postDecisionFlow: scenario.income - scenario.expense - monthlyImpact }));
  return {
    currency, totalCost, monthlyImpact, duration, baselineMonthlyFlow: baseline, postDecisionFlow,
    immediateImpact: currentBalanceKnown ? Number(snapshot.balances[currency]) - immediateCost : null,
    currentBalanceKnown, reserveBalance, averageMonthsUsed: useAverage ? average.sampleMonths : 0,
    monthlyIncome, monthlyExpense, recurringCommitments,
    goalCount: goals.filter((goal) => goal.currency === currency).length,
    enoughData, recommendation, scenarios,
    alternatives: [
      { label: "Alternativa 10% mais barata", totalCost: totalCost * 0.9 },
      { label: "Alternativa 20% mais barata", totalCost: totalCost * 0.8 },
      { label: "Adiar e poupar por mês", monthlySaving: monthlyImpact, monthsToSave: monthlyImpact > 0 ? Math.ceil(totalCost / monthlyImpact) : null }
    ],
    caveats: [
      ...(currentBalanceKnown ? ["Saldo imediato usa saldo líquido das contas líquidas no orçamento."] : ["Saldo atual confiável não foi disponibilizado para esta simulação."]),
      "Despesas essenciais não são classificadas automaticamente; revise-as manualmente.",
      "Compromissos agendados podem ter frequências diferentes e não são subtraídos da média mensal sem normalização."
    ],
    methodology: "Cenários são sensibilidades ilustrativas, não previsões. Parcelas são tratadas como valor mensal informado; juros, impostos e custos não informados não são inferidos."
  };
}

export function buildActionPlan(snapshot) {
  const actions = [];
  const seenSavings = new Set();
  snapshot.alerts.forEach((alert) => {
    const key = alert.currency + "|" + (alert.category || alert.title.replace(/^Aumento de gastos: /, "").replace(/^Despesa fora do histórico: /, ""));
    if (seenSavings.has(key)) return;
    seenSavings.add(key);
    actions.push({
      id: "action-" + alert.id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 150), title: alert.title, rationale: alert.evidence, priority: alert.severity === "high" ? "alta" : "media",
      phase: alert.severity === "high" ? "imediata" : "30-dias", currency: alert.currency,
      potentialSaving: alert.potentialSaving === 0 ? 0 : Math.max(0, Number(alert.impact || 0) * 0.2),
      status: "pendente", followUp: alert.action
    });
  });
  snapshot.goalProgress.filter((goal) => goal.remaining > 0).forEach((goal) => {
    const phase = goal.targetDate && goal.targetDate <= new Date(Date.now() + 180 * DAY).toISOString().slice(0, 10) ? "3-6-meses" : "longo-prazo";
    actions.push({
      id: "action-goal-" + String(goal.id).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 120),
      title: "Acompanhar meta: " + goal.name,
      rationale: "Meta com " + goal.progressPercent.toFixed(0) + "% concluídos e " + goal.remaining.toFixed(2) + " ainda necessários.",
      priority: goal.overdue ? "alta" : "baixa", phase,
      currency: goal.currency, potentialSaving: 0, status: "pendente",
      followUp: goal.monthly > 0 ? "Compare o aporte mensal planejado com o valor necessário até a data-alvo." : "Defina um aporte mensal viável para acompanhar a meta."
    });
  });
  snapshot.budgetStatus.filter((item) => item.status === "saudavel").forEach((budget) => {
    actions.push({
      id: "action-budget-" + budget.id, title: "Manter o limite: " + budget.category,
      rationale: "O gasto está dentro do orçamento cadastrado.", priority: "baixa", phase: "30-dias",
      currency: budget.currency, potentialSaving: 0, status: "pendente", followUp: "Acompanhe semanalmente o planejado versus realizado."
    });
  });
  return actions;
}

export function validateActionStatus(status) {
  return ["pendente", "em-andamento", "concluida", "descartada"].includes(status) ? status : "pendente";
}
