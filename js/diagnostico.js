import { getAll, openDB } from "./db.js";
import { formatMoney } from "./utils.js";
import { detectAnomalies } from "./finance/anomaly-detector.js";
import { detectRecurring } from "./finance/recurring-detector.js";
import { evaluateBudgets } from "./finance/budget-engine.js";
import { $, } from "./dom.js";

const currencies = ["BRL", "PYG"];
const currencyLabels = { BRL: "R$", PYG: "Gs." };
const els = {};
const money = (amount, currency) => formatMoney(Number(amount) || 0, currency);
const today = () => {
  const date = new Date();
  return { year: date.getFullYear(), month: String(date.getMonth() + 1).padStart(2, "0"), day: date.getDate() };
};
const monthKey = (year, month) => `${year}-${month}`;
const previousMonthKey = (year, month) => {
  const date = new Date(year, Number(month) - 2, 1);
  return monthKey(date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"));
};
const safeText = (value) => String(value ?? "Sem descrição");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  Object.assign(els, {
    monthExpenses: $("#monthExpenses"),
    expenseCount: $("#expenseCount"),
    monthIncome: $("#monthIncome"),
    monthBalance: $("#monthBalance"),
    diagnosticList: $("#diagnosticList"),
    analysisStatus: $("#analysisStatus"),
    decisionSummary: $("#decisionSummary")
  });
  $("#refreshAnalysis").addEventListener("click", analyze);
  await analyze();
}

async function analyze() {
  els.analysisStatus.textContent = "Calculando com dados locais…";
  try {
    await openDB();
    const [transactions, budgets, settings, rates] = await Promise.all([
      getAll("transactions"), getAll("budgets"), getAll("settings"), getAll("exchangeRates")
    ]);
    const settingMap = Object.fromEntries(settings.map((item) => [item.key, item.value]));
    const rate = Number(settingMap.brlToPyg) > 0 ? Number(settingMap.brlToPyg) : 1300;
    const now = today();
    const currentMonth = monthKey(now.year, now.month);
    const previousMonth = previousMonthKey(now.year, now.month);
    const valid = transactions.filter((tx) =>
      tx && tx.date && currencies.includes(tx.currency) &&
      ["income", "expense", "transfer"].includes(tx.type) &&
      Number.isFinite(Number(tx.amount)) && Number(tx.amount) > 0
    );
    const current = valid.filter((tx) => tx.date.startsWith(currentMonth) && tx.type !== "transfer");
    const previous = valid.filter((tx) => tx.date.startsWith(previousMonth) && tx.type !== "transfer");
    const totals = Object.fromEntries(currencies.map((currency) => {
      const income = current.filter((tx) => tx.currency === currency && tx.type === "income").reduce((sum, tx) => sum + Number(tx.amount), 0);
      const expense = current.filter((tx) => tx.currency === currency && tx.type === "expense").reduce((sum, tx) => sum + Number(tx.amount), 0);
      return [currency, { income, expense, balance: income - expense }];
    }));
    els.monthExpenses.textContent = currencies.map((currency) => money(totals[currency].expense, currency)).join(" · ");
    els.monthIncome.textContent = currencies.map((currency) => money(totals[currency].income, currency)).join(" · ");
    els.monthBalance.textContent = currencies.map((currency) => money(totals[currency].balance, currency)).join(" · ");
    els.expenseCount.textContent = `${current.filter((tx) => tx.type === "expense").length} despesas registradas neste mês`;

    const signals = buildSignals({ valid, current, previous, budgets, rates, rate, currentMonth, now });
    renderSignals(signals);
    renderDecisionSummary(signals, current, totals);
    els.analysisStatus.textContent = `Análise concluída · ${valid.length} movimentações históricas avaliadas`;
  } catch (error) {
    els.analysisStatus.textContent = "Não foi possível concluir a análise";
    els.diagnosticList.replaceChildren();
    addEmpty(els.diagnosticList, "O banco local não pôde ser lido. Recarregue a página e tente novamente. Seus registros não foram alterados.");
  }
}

function buildSignals({ valid, current, previous, budgets, rates, rate, currentMonth, now }) {
  const signals = [];
  const expenses = valid.filter((tx) => tx.type === "expense");
  const currentExpenses = current.filter((tx) => tx.type === "expense");
  const previousExpenses = previous.filter((tx) => tx.type === "expense");

  const byGroup = (items) => {
    const map = new Map();
    items.forEach((tx) => {
      const key = `${tx.currency}||${tx.category || "Sem categoria"}`;
      map.set(key, (map.get(key) || 0) + Number(tx.amount));
    });
    return map;
  };
  const currentGroups = byGroup(currentExpenses);
  const previousGroups = byGroup(previousExpenses);
  for (const [key, amount] of currentGroups) {
    const [currency, category] = key.split("||");
    const oldAmount = previousGroups.get(key) || 0;
    if (oldAmount > 0 && amount > oldAmount * 1.2 && amount - oldAmount >= (currency === "BRL" ? 50 : 50000)) {
      const delta = amount - oldAmount;
      signals.push({
        level: "attention", title: `Aumento em ${category}`, amount, currency,
        evidence: `Este mês: ${money(amount, currency)}. Mês anterior: ${money(oldAmount, currency)}. Aumento de ${((delta / oldAmount) * 100).toFixed(0)}% (${money(delta, currency)}).`,
        why: "O aumento supera 20% e também um valor mínimo de relevância para a moeda. A comparação usa o mesmo mês-calendário anterior.",
        action: `Revise os lançamentos desta categoria e identifique o que é pontual. Se for possível reduzir 10% do gasto atual, o cenário de economia seria ${money(amount * 0.1, currency)} neste mês.`,
        sortValue: delta
      });
    }
  }

  const budgetMetrics = evaluateBudgets({ budgets, transactions: valid, rate, rates, month: currentMonth });
  for (const budget of budgetMetrics) {
    if (budget.status === "excedido" || budget.status === "atencao") {
      const over = Math.max(0, budget.spent - Number(budget.limit || 0));
      signals.push({
        level: budget.status === "excedido" ? "attention" : "info",
        title: `Orçamento: ${budget.category}`, amount: budget.spent, currency: budget.currency,
        evidence: `${money(budget.spent, budget.currency)} de ${money(budget.limit, budget.currency)} utilizados (${budget.usedPercent.toFixed(0)}%).${budget.approximate ? " Conversão entre moedas aproximada." : ""}`,
        why: budget.status === "excedido" ? `O limite foi ultrapassado em ${money(over, budget.currency)}.` : "O consumo já chegou a pelo menos 80% do limite mensal.",
        action: budget.status === "excedido" ? "Pause compras não essenciais desta categoria e revise o limite para o próximo mês com base no histórico." : "Calcule o saldo do orçamento pelos dias restantes e adie compras não essenciais para evitar ultrapassar o limite.",
        sortValue: budget.usedPercent
      });
    }
  }

  const anomalyResults = detectAnomalies(expenses).filter((item) => item.amount > 0 && item.transactionId);
  for (const anomaly of anomalyResults.slice(-20)) {
    const tx = currentExpenses.find((item) => item.id === anomaly.transactionId);
    if (!tx) continue;
    signals.push({
      level: "attention", title: `Despesa fora do padrão: ${safeText(anomaly.category)}`,
      amount: anomaly.amount, currency: anomaly.currency,
      evidence: `${safeText(anomaly.description)}: ${money(anomaly.amount, anomaly.currency)}. Mediana recente da categoria: ${money(anomaly.categoryMedian, anomaly.currency)}. ${anomaly.ratioToMedian.toFixed(1)}× a mediana.`,
      why: anomaly.criterion,
      action: "Confirme se o valor está correto e se foi uma despesa excepcional. Não é automaticamente um erro; compare com comprovante e necessidade.",
      sortValue: anomaly.ratioToMedian * 10
    });
  }

  const recurring = detectRecurring(expenses).slice(0, 8);
  for (const item of recurring) {
    const inCurrentMonth = currentExpenses.some((tx) => item.transactionIds.includes(tx.id));
    if (!inCurrentMonth) continue;
    signals.push({
      level: "opportunity", title: `Despesa possivelmente recorrente: ${safeText(item.description || item.category)}`,
      amount: item.averageAmount, currency: item.currency,
      evidence: `${item.occurrences} ocorrências, periodicidade ${item.cadence}, média de ${money(item.averageAmount, item.currency)}. Confiança heurística: ${Math.round(item.confidence * 100)}%.`,
      why: "Padrões de descrição, valores próximos e intervalos regulares sugerem recorrência; isso não confirma que seja assinatura ou cobrança duplicada.",
      action: "Confira se o serviço ainda é útil, se há plano mais barato e se a cobrança já é esperada. Não cancele sem verificar o contrato.",
      sortValue: item.averageAmount
    });
  }

  if (!signals.length) {
    const count = currentExpenses.length;
    signals.push({
      level: "info", title: "Nenhum alerta forte encontrado",
      evidence: `${count} despesas no mês foram avaliadas com as regras atuais.`,
      why: "Os alertas exigem evidências mínimas para evitar conclusões baseadas apenas em impressão.",
      action: "Cadastre orçamentos para categorias importantes e mantenha descrições consistentes. Mais histórico melhora a comparação entre períodos.",
      sortValue: 0
    });
  }
  return signals.sort((a, b) => b.sortValue - a.sortValue).slice(0, 12);
}

function renderSignals(signals) {
  els.diagnosticList.replaceChildren();
  if (!signals.length) return addEmpty(els.diagnosticList, "Ainda não há dados suficientes para gerar recomendações.");
  for (const signal of signals) {
    const card = document.createElement("article");
    card.className = "diagnostic-item";
    const label = document.createElement("span");
    label.className = `signal-label ${signal.level}`;
    label.textContent = signal.level === "attention" ? "Atenção" : signal.level === "opportunity" ? "Oportunidade" : "Informativo";
    const title = document.createElement("h3");
    title.textContent = signal.title;
    const evidence = document.createElement("p");
    evidence.className = "evidence";
    evidence.textContent = signal.evidence;
    const why = document.createElement("p");
    why.textContent = signal.why;
    const action = document.createElement("p");
    action.className = "action";
    action.textContent = `Ação sugerida: ${signal.action}`;
    card.append(label, title, evidence, why, action);
    els.diagnosticList.appendChild(card);
  }
}

function renderDecisionSummary(signals, current, totals) {
  els.decisionSummary.replaceChildren();
  const sorted = [...signals].filter((signal) => signal.currency && signal.amount > 0).sort((a, b) => b.sortValue - a.sortValue);
  const points = [
    sorted[0] ? `Prioridade para revisar: ${sorted[0].title}. Evidência: ${sorted[0].evidence}` : "Continue acompanhando as categorias e registre os gastos para formar uma linha de base.",
    ...currencies.map((currency) => {
      const data = totals[currency];
      if (data.balance < 0) return `Em ${currency}, as despesas superam as receitas em ${money(Math.abs(data.balance), currency)} neste mês. Priorize despesas essenciais e compromissos antes de assumir novos gastos.`;
      if (data.income > 0) return `Em ${currency}, a diferença entre receitas e despesas é ${money(data.balance, currency)}. Confirme compromissos pendentes antes de tratar esse valor como disponível.`;
      return `Ainda não há receita registrada em ${currency} neste mês; não é possível inferir capacidade de gasto apenas com os lançamentos atuais.`;
    })
  ];
  points.forEach((text) => {
    const item = document.createElement("div");
    item.className = "decision-point";
    item.textContent = text;
    els.decisionSummary.appendChild(item);
  });
}

function addEmpty(container, text) {
  const empty = document.createElement("p");
  empty.className = "empty-diagnostic";
  empty.textContent = text;
  container.appendChild(empty);
}
