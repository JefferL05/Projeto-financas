import { getAll, get, put } from "./db.js";
import { uid, formatMoney } from "./utils.js";
import { accountBalance, isLiquidAccount } from "./accounts/account-balance.js";
import { calculateManagementSnapshot, simulateDecision, buildActionPlan, validateActionStatus } from "./financial-management-engine.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const currencyLabel = (currency) => currency === "BRL" ? "R$" : "Gs.";
const money = (value, currency) => formatMoney(Number(value) || 0, currency);
const todayISO = () => {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
};
const currentMonth = () => todayISO().slice(0, 7);
const safeText = (value) => String(value ?? "");
let state = { transactions: [], accounts: [], schedules: [], goals: [], budgets: [], categories: [], settings: [], rates: [], plan: { actions: [], scenario: {} }, snapshot: null };

document.addEventListener("DOMContentLoaded", init);

async function init() {
  $("#fmMonth").value = currentMonth();
  $("#fmGoalDate").value = todayISO().slice(0, 4) + "-12-31";
  bindTabs();
  bindEvents();
  await reloadData();
  await analyze();
}

function bindTabs() {
  $$(".fm-tab").forEach((button) => button.addEventListener("click", () => {
    const tab = button.dataset.fmTab;
    $$(".fm-tab").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    $$(".fm-panel").forEach((panel) => panel.classList.toggle("active", panel.id === "fm-panel-" + tab));
  }));
}

function bindEvents() {
  $("#refreshManagement").addEventListener("click", async () => { await reloadData(); await analyze(); });
  ["#fmMonth", "#fmCurrency", "#fmCategory", "#fmType"].forEach((selector) => $(selector).addEventListener("change", analyze));
  $("#fmDecisionForm").addEventListener("submit", runDecision);
  $("#fmGoalForm").addEventListener("submit", saveGoal);
  $("#fmBudgetForm").addEventListener("submit", saveBudget);
  $("#fmScenarioForm").addEventListener("submit", saveScenario);
  $("#fmGenerateActions").addEventListener("click", regenerateActions);
}

async function reloadData() {
  $("#fmStatus").textContent = "Lendo transações, contas, metas e orçamentos do IndexedDB…";
  try {
    const [transactions, accounts, schedules, goals, budgets, categories, settings, rates] = await Promise.all([
      getAll("transactions"), getAll("accounts"), getAll("schedules"), getAll("goals"),
      getAll("budgets"), getAll("categories"), getAll("settings"), getAll("exchangeRates")
    ]);
    state = { ...state, transactions, accounts, schedules, goals, budgets, categories, settings, rates };
    const planSetting = settings.find((item) => item.key === "financialManagementPlan");
    state.plan = normalizePlan(planSetting?.value);
    populateCategories();
    restoreScenario();
    $("#fmStatus").textContent = "Dados locais carregados · " + transactions.length + " transações · nenhuma informação enviada a terceiros.";
  } catch (error) {
    $("#fmStatus").textContent = "Não foi possível ler o banco local. Seus dados não foram alterados.";
    throw error;
  }
}

function normalizePlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { actions: [], scenario: {}, futureExpenses: [] };
  return {
    actions: Array.isArray(value.actions) ? value.actions.filter((item) => item && typeof item.id === "string").slice(0, 200).map((item) => ({ ...item, status: validateActionStatus(item.status) })) : [],
    scenario: value.scenario && typeof value.scenario === "object" ? value.scenario : {},
    futureExpenses: Array.isArray(value.futureExpenses) ? value.futureExpenses.slice(0, 100) : []
  };
}

async function savePlan() {
  state.plan = normalizePlan(state.plan);
  await put("settings", { key: "financialManagementPlan", value: state.plan });
}

function populateCategories() {
  const names = [...new Set(state.categories.map((item) => typeof item === "string" ? item : item.name).filter(Boolean))];
  state.transactions.forEach((tx) => { if (tx.category) names.push(tx.category); });
  state.budgets.forEach((budget) => { if (budget.category) names.push(budget.category); });
  const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b, "pt-BR"));
  ["#fmCategory", "#fmBudgetCategory"].forEach((selector) => {
    const select = $(selector);
    const old = select.value;
    select.replaceChildren();
    if (selector === "#fmCategory") {
      const all = document.createElement("option"); all.value = ""; all.textContent = "Todas as categorias"; select.appendChild(all);
    }
    unique.forEach((name) => { const option = document.createElement("option"); option.value = name; option.textContent = name; select.appendChild(option); });
    if (unique.includes(old)) select.value = old;
  });
}

function addText(parent, tag, text, className = "") {
  const node = document.createElement(tag);
  node.textContent = safeText(text);
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

function empty(parent, message) {
  parent.replaceChildren();
  addText(parent, "div", message, "fm-empty");
}

async function analyze() {
  $("#fmStatus").textContent = "Calculando indicadores com os registros existentes…";
  try {
    const month = $("#fmMonth").value || currentMonth();
    const currency = $("#fmCurrency").value || null;
    const category = $("#fmCategory").value || null;
    const type = $("#fmType").value || null;
    const snapshot = calculateManagementSnapshot({
      ...state, month, currency, category, type, now: new Date()
    });
    const balances = { BRL: 0, PYG: 0 };
    state.accounts.filter((account) => !account.archived && isLiquidAccount(account) && account.onBudget !== false).forEach((account) => {
      balances[account.currency] += accountBalance(account, state.transactions);
    });
    snapshot.balances = balances;
    state.snapshot = snapshot;
    renderOverview(snapshot);
    renderAnalyst(snapshot);
    renderPlanning(snapshot);
    renderActions(snapshot);
    $("#fmStatus").textContent = "Análise concluída · " + snapshot.filteredTransactionCount + " registros considerados nos filtros. Valores e estimativas identificados separadamente.";
  } catch (error) {
    $("#fmStatus").textContent = "Falha na análise. Recarregue a página; os lançamentos não foram alterados.";
    console.error("Falha ao calcular gestão financeira.", error?.message || "erro");
  }
}

function renderMoneyByCurrency(totals, field) {
  return ["BRL", "PYG"].filter((currency) => !state.snapshot?.currency || state.snapshot.currency === "all" || state.snapshot.currency === currency)
    .map((currency) => money(totals[currency][field], currency)).join(" · ") || "—";
}

function renderOverview(snapshot) {
  $("#fmIncome").textContent = renderMoneyByCurrency(snapshot.currentTotals, "income");
  $("#fmExpenses").textContent = renderMoneyByCurrency(snapshot.currentTotals, "expense");
  $("#fmNet").textContent = renderMoneyByCurrency(snapshot.currentTotals, "net");
  const commitments = ["BRL", "PYG"].filter((code) => !snapshot.currency || snapshot.currency === "all" || snapshot.currency === code)
    .map((code) => snapshot.incomeCommitment[code].percent === null ? currencyLabel(code) + ": sem renda registrada" : currencyLabel(code) + " " + snapshot.incomeCommitment[code].percent.toFixed(1) + "%");
  $("#fmCommitment").textContent = commitments.join(" · ") || "—";
  $("#fmIncomeNote").textContent = snapshot.hasEnoughHistory ? "Comparação disponível com o mês anterior." : "Histórico comparativo insuficiente.";
  $("#fmExpenseNote").textContent = snapshot.validTransactionCount + " transações válidas no histórico.";
  renderCategoryChart(snapshot);
  renderMonthChart(snapshot);
  renderBudgetList(snapshot);
  renderGoalList(snapshot);
  renderDueSoon(snapshot);
  renderProjection(snapshot);
  $("#fmMethodology").textContent = snapshot.methodology;
}

function renderCategoryChart(snapshot) {
  const parent = $("#fmCategoryChart");
  parent.replaceChildren();
  const items = snapshot.categoryChanges.slice(0, 7);
  $("#fmCategoryEmpty").classList.toggle("hidden", items.length > 0);
  if (!items.length) return;
  const max = Math.max(1, ...items.map((item) => Math.max(item.amount, item.previousAmount)));
  items.forEach((item) => {
    const row = document.createElement("div"); row.className = "fm-bar-item";
    const heading = document.createElement("div"); heading.className = "fm-bar-heading";
    addText(heading, "span", item.category + " · " + item.currency);
    addText(heading, "strong", money(item.amount, item.currency));
    const track = document.createElement("div"); track.className = "fm-bar-track";
    const previous = document.createElement("span"); previous.className = "fm-bar-previous"; previous.style.width = Math.min(100, item.previousAmount / max * 100) + "%"; previous.setAttribute("aria-label", "Mês anterior");
    const current = document.createElement("span"); current.className = "fm-bar-current"; current.style.width = Math.min(100, item.amount / max * 100) + "%"; current.setAttribute("aria-label", "Mês atual");
    track.append(previous, current); row.append(heading, track); parent.appendChild(row);
  });
  const legend = document.createElement("div"); legend.className = "fm-legend";
  addText(legend, "span", "Mês atual"); addText(legend, "span", "Mês anterior"); parent.appendChild(legend);
}

function renderMonthChart(snapshot) {
  const parent = $("#fmMonthChart"); parent.replaceChildren();
  const currencies = snapshot.currency === "all" ? ["BRL", "PYG"] : [snapshot.currency];
  const values = currencies.flatMap((code) => [
    { label: code + " · receita atual", value: snapshot.currentTotals[code].income, currency: code, expense: false },
    { label: code + " · despesa atual", value: snapshot.currentTotals[code].expense, currency: code, expense: true },
    { label: code + " · receita anterior", value: snapshot.previousTotals[code].income, currency: code, expense: false, previous: true },
    { label: code + " · despesa anterior", value: snapshot.previousTotals[code].expense, currency: code, expense: true, previous: true }
  ]);
  const max = Math.max(1, ...values.map((item) => item.value));
  $("#fmMonthEmpty").classList.toggle("hidden", values.some((item) => item.value > 0));
  values.forEach((item) => {
    const row = document.createElement("div"); row.className = "fm-month-row";
    addText(row, "span", item.label);
    const track = document.createElement("div"); track.className = "fm-month-track";
    const fill = document.createElement("div"); fill.className = "fm-month-fill" + (item.expense ? " expense" : "");
    fill.style.width = Math.min(100, item.value / max * 100) + "%"; track.appendChild(fill);
    addText(row, "strong", money(item.value, item.currency)); row.appendChild(track);
    parent.appendChild(row);
  });
}

function renderBudgetList(snapshot) {
  const parent = $("#fmBudgets"); parent.replaceChildren();
  if (!snapshot.budgetStatus.length) { empty(parent, "Nenhum orçamento cadastrado para " + snapshot.month + ". Você pode criar um na aba Planejamento."); return; }
  snapshot.budgetStatus.forEach((budget) => {
    const item = document.createElement("div"); item.className = "fm-list-item";
    addText(item, "strong", budget.category + " · " + money(budget.spent, budget.currency));
    addText(item, "p", "Limite: " + money(budget.limit, budget.currency) + " · " + budget.usedPercent.toFixed(0) + "% utilizado");
    const progress = document.createElement("div"); progress.className = "fm-progress"; const fill = document.createElement("span");
    fill.style.width = Math.min(100, budget.usedPercent) + "%"; progress.appendChild(fill); item.appendChild(progress);
    addText(item, "small", budget.status + (budget.approximate ? " · conversão aproximada" : "")); parent.appendChild(item);
  });
}

function renderGoalList(snapshot) {
  const parent = $("#fmGoals"); parent.replaceChildren();
  if (!snapshot.goalProgress.length) { empty(parent, "Nenhuma meta cadastrada. Crie uma meta na aba Planejamento."); return; }
  snapshot.goalProgress.forEach((goal) => {
    const item = document.createElement("div"); item.className = "fm-list-item";
    addText(item, "strong", goal.name);
    addText(item, "p", money(goal.current, goal.currency) + " de " + money(goal.target, goal.currency) + " · " + goal.progressPercent.toFixed(0) + "%");
    const progress = document.createElement("div"); progress.className = "fm-progress"; const fill = document.createElement("span");
    fill.style.width = goal.progressPercent + "%"; progress.appendChild(fill); item.appendChild(progress);
    addText(item, "small", "Restante: " + money(goal.remaining, goal.currency) + " · prazo " + goal.targetDate); parent.appendChild(item);
  });
}

function renderDueSoon(snapshot) {
  const parent = $("#fmDueSoon"); parent.replaceChildren();
  if (!snapshot.dueSoon.length) { empty(parent, "Nenhum compromisso ativo com vencimento nos próximos 30 dias."); return; }
  snapshot.dueSoon.forEach((due) => {
    const item = document.createElement("div"); item.className = "fm-list-item";
    addText(item, "strong", due.name || due.category || "Compromisso");
    addText(item, "p", due.nextDueDate + " · " + money(due.amount, due.currency));
    addText(item, "small", (due.kind || "compromisso") + (due.active === false ? " · inativo" : "")); parent.appendChild(item);
  });
}

function renderProjection(snapshot) {
  const parent = $("#fmProjection"); parent.replaceChildren();
  const currencies = snapshot.currency === "all" ? ["BRL", "PYG"] : [snapshot.currency];
  currencies.forEach((code) => {
    const projection = snapshot.projectedExpense[code];
    const item = document.createElement("div"); item.className = "fm-list-item";
    addText(item, "strong", code + " · estimativa " + money(projection.projected, code));
    addText(item, "p", "Realizado até agora: " + money(projection.actual, code));
    addText(item, "small", projection.estimate ? "Projeção por média diária; " + projection.elapsedDays + " de " + projection.daysInMonth + " dias decorridos." : "Mês fechado/fora do mês atual: valor observado, sem extrapolação adicional.");
    parent.appendChild(item);
  });
}

function renderAnalyst(snapshot) {
  $("#fmAlertCount").textContent = snapshot.alerts.length + " alertas";
  $("#fmRecurringCount").textContent = snapshot.recurring.length + " padrões recorrentes";
  $("#fmDuplicateCount").textContent = snapshot.duplicates.length + " suspeitas de duplicidade";
  const parent = $("#fmAlerts"); parent.replaceChildren();
  if (!snapshot.alerts.length) empty(parent, "Nenhum alerta sustentado pelos filtros e pelo histórico disponível. Isso não garante ausência de risco.");
  snapshot.alerts.forEach((alert) => {
    const card = document.createElement("article"); card.className = "fm-alert " + alert.severity;
    addText(card, "span", alert.severity === "high" ? "Prioridade alta" : "Revisar", "fm-tag");
    addText(card, "h3", alert.title);
    addText(card, "p", "Impacto observado/estimado: " + money(alert.impact, alert.currency));
    addText(card, "p", alert.evidence, "fm-evidence");
    addText(card, "p", alert.action, "fm-action");
    parent.appendChild(card);
  });
  const recurring = $("#fmRecurring"); recurring.replaceChildren();
  if (!snapshot.recurring.length) empty(recurring, "Ainda não há evidência suficiente de recorrência. O detector exige datas, descrições e valores consistentes.");
  snapshot.recurring.forEach((pattern) => {
    const item = document.createElement("div"); item.className = "fm-list-item";
    addText(item, "strong", pattern.description || pattern.category);
    addText(item, "p", money(pattern.averageAmount, pattern.currency) + " · " + pattern.cadence + " · " + pattern.occurrences + " ocorrências");
    addText(item, "small", "Confiança heurística " + Math.round(pattern.confidence * 100) + "%. Revise antes de classificar como assinatura."); recurring.appendChild(item);
  });
  const opportunities = $("#fmOpportunities"); opportunities.replaceChildren();
  const sorted = snapshot.categoryChanges.filter((item) => item.difference > 0).sort((a, b) => b.difference - a.difference).slice(0, 6);
  if (!sorted.length) empty(opportunities, "Sem aumento de categoria detectado no comparativo selecionado.");
  sorted.forEach((entry) => {
    const item = document.createElement("div"); item.className = "fm-list-item";
    addText(item, "strong", entry.category + " · aumento de " + money(entry.difference, entry.currency));
    addText(item, "p", entry.previousAmount > 0 ? (entry.changePercent || 0).toFixed(0) + "% sobre o mês anterior." : "Categoria sem gastos no mês anterior comparável.");
    addText(item, "small", "Cenário ilustrativo de redução de 20% do aumento: " + money(entry.difference * 0.2, entry.currency) + "/mês e " + money(entry.difference * 2.4, entry.currency) + "/ano. Não é economia garantida."); opportunities.appendChild(item);
  });
}

function renderPlanning(snapshot) {
  const parent = $("#fmPlannedActual"); parent.replaceChildren();
  const budgets = snapshot.budgetStatus;
  if (!budgets.length) { empty(parent, "Cadastre limites para comparar planejado e realizado."); return; }
  budgets.forEach((budget) => {
    const item = document.createElement("div"); item.className = "fm-list-item";
    addText(item, "strong", budget.category + " · " + budget.currency);
    addText(item, "p", "Planejado " + money(budget.limit, budget.currency) + " · realizado " + money(budget.spent, budget.currency));
    addText(item, "small", "Diferença: " + money(budget.limit - budget.spent, budget.currency)); parent.appendChild(item);
  });
}

function runDecision(event) {
  event.preventDefault();
  if (!state.snapshot) return;
  const name = $("#fmDecisionName").value.trim();
  const currency = $("#fmDecisionCurrency").value;
  const cost = Number($("#fmDecisionCost").value);
  const monthlyPayment = Number($("#fmDecisionPayment").value || 0);
  const months = Number($("#fmDecisionMonths").value || 1);
  try {
    const result = simulateDecision({ cost, monthlyPayment, months, currency, snapshot: state.snapshot, transactions: state.transactions, schedules: state.schedules, goals: state.goals });
    const parent = $("#fmDecisionResult"); parent.replaceChildren();
    const card = document.createElement("article"); card.className = "fm-decision-card";
    addText(card, "h3", "Análise: " + name);
    addText(card, "p", "Custo total informado: " + money(result.totalCost, currency) + " · impacto mensal estimado: " + money(result.monthlyImpact, currency));
    addText(card, "p", "Fluxo mensal de referência: " + money(result.baselineMonthlyFlow, currency) + " · após decisão: " + money(result.postDecisionFlow, currency));
    addText(card, "p", result.recommendation, "fm-tag");
    result.caveats.forEach((item) => addText(card, "p", item, "fm-method"));
    addText(card, "p", result.methodology, "fm-method");
    parent.appendChild(card);
    const scenarios = document.createElement("div"); scenarios.className = "fm-scenarios";
    result.scenarios.forEach((scenario) => {
      const node = document.createElement("div"); node.className = "fm-scenario";
      addText(node, "strong", scenario.name);
      addText(node, "span", "Renda: " + money(scenario.income, currency));
      addText(node, "span", "Despesas: " + money(scenario.expense, currency));
      addText(node, "span", "Fluxo após decisão: " + money(scenario.postDecisionFlow, currency)); scenarios.appendChild(node);
    });
    parent.appendChild(scenarios);
    if (result.immediateImpact !== null) addText(parent, "p", "Saldo líquido disponível estimado após compra à vista: " + money(result.immediateImpact, currency), "fm-method");
  } catch (error) {
    const parent = $("#fmDecisionResult"); parent.replaceChildren(); addText(parent, "div", error.message || "Revise os valores informados.", "fm-empty");
  }
}

async function saveGoal(event) {
  event.preventDefault();
  try {
    const currency = $("#fmGoalCurrency").value;
    const target = Number($("#fmGoalTarget").value);
    const current = Number($("#fmGoalCurrent").value || 0);
    const monthly = Number($("#fmGoalMonthly").value || 0);
    const targetDate = $("#fmGoalDate").value;
    if (!(target > 0) || current < 0 || monthly < 0 || !targetDate) throw new TypeError("Confira o valor, aporte e data-alvo.");
    await put("goals", { id: uid("goal"), name: $("#fmGoalName").value.trim(), currency, target, current, monthly, targetDate, priority: "medium", createdAt: new Date().toISOString() });
    event.target.reset(); $("#fmGoalDate").value = todayISO().slice(0, 4) + "-12-31";
    await reloadData(); await analyze();
    $("#fmStatus").textContent = "Meta salva no IndexedDB.";
  } catch (error) { $("#fmStatus").textContent = error.message || "Não foi possível salvar a meta."; }
}

async function saveBudget(event) {
  event.preventDefault();
  try {
    const category = $("#fmBudgetCategory").value;
    const currency = $("#fmBudgetCurrency").value;
    const limit = Number($("#fmBudgetLimit").value);
    const period = $("#fmMonth").value || currentMonth();
    if (!category || !(limit > 0)) throw new TypeError("Escolha uma categoria e um limite positivo.");
    const existing = state.budgets.find((item) => item.category === category && item.currency === currency && item.period === period);
    await put("budgets", { ...(existing || {}), id: existing?.id || uid("budget"), category, currency, limit, period, rollover: Boolean(existing?.rollover), updatedAt: new Date().toISOString() });
    event.target.reset(); await reloadData(); await analyze();
    $("#fmStatus").textContent = "Limite do orçamento salvo no IndexedDB para " + period + ".";
  } catch (error) { $("#fmStatus").textContent = error.message || "Não foi possível salvar o limite."; }
}

async function saveScenario(event) {
  event.preventDefault();
  state.plan.scenario = {
    month: $("#fmMonth").value || currentMonth(),
    incomeChangePercent: Number($("#fmIncomeChange").value || 0),
    expenseReductionPercent: Number($("#fmExpenseReduction").value || 0),
    monthlySaving: Number($("#fmMonthlySaving").value || 0),
    targetSaving: Number($("#fmTargetSaving").value || 0)
  };
  await savePlan();
  renderScenarioResult();
  $("#fmStatus").textContent = "Premissas da simulação salvas localmente; nenhuma transação foi alterada.";
}

function restoreScenario() {
  const scenario = state.plan.scenario || {};
  if (scenario.incomeChangePercent !== undefined) $("#fmIncomeChange").value = scenario.incomeChangePercent;
  if (scenario.expenseReductionPercent !== undefined) $("#fmExpenseReduction").value = scenario.expenseReductionPercent;
  if (scenario.monthlySaving !== undefined) $("#fmMonthlySaving").value = scenario.monthlySaving;
  if (scenario.targetSaving !== undefined) $("#fmTargetSaving").value = scenario.targetSaving;
}

function renderScenarioResult() {
  const parent = $("#fmScenarioResult"); parent.replaceChildren();
  if (!state.snapshot) return;
  const scenario = state.plan.scenario || {};
  const currency = state.snapshot.currency === "BRL" || state.snapshot.currency === "PYG" ? state.snapshot.currency : $("#fmDecisionCurrency").value;
  const baseline = state.snapshot.currentTotals[currency];
  const adjustedIncome = baseline.income * (1 + Number(scenario.incomeChangePercent || 0) / 100);
  const adjustedExpenses = baseline.expense * (1 - Number(scenario.expenseReductionPercent || 0) / 100);
  const net = adjustedIncome - adjustedExpenses - Number(scenario.monthlySaving || 0);
  addText(parent, "p", "Cenário " + currency + ": renda ajustada " + money(adjustedIncome, currency) + ", despesas ajustadas " + money(adjustedExpenses, currency) + " e fluxo após aporte " + money(net, currency) + ".");
  const target = Number(scenario.targetSaving || 0);
  const monthly = Number(scenario.monthlySaving || 0);
  addText(parent, "p", target <= 0 ? "Informe uma meta para estimar o prazo." : monthly <= 0 ? "Informe um aporte mensal positivo para calcular o prazo." : "Prazo simples para juntar " + money(target, currency) + ": " + Math.ceil(target / monthly) + " meses, sem considerar rendimentos ou inflação.");
  addText(parent, "p", "Cenário matemático com base nos lançamentos do mês selecionado. Não prevê eventos futuros nem altera o orçamento real.", "fm-method");
}

async function regenerateActions() {
  if (!state.snapshot) return;
  const suggested = buildActionPlan(state.snapshot);
  const existing = new Map(state.plan.actions.map((action) => [action.id, action]));
  state.plan.actions = suggested.map((action) => ({ ...action, ...(existing.get(action.id) || {}), status: validateActionStatus(existing.get(action.id)?.status || action.status) }));
  await savePlan(); renderActions(state.snapshot);
  $("#fmStatus").textContent = "Plano de ação atualizado; estados anteriores foram preservados quando a ação permaneceu na lista.";
}

function renderActions(snapshot) {
  const parent = $("#fmActions"); parent.replaceChildren();
  if (!state.plan.actions.length) {
    const intro = document.createElement("div"); intro.className = "fm-empty"; intro.textContent = "Ainda não há ações salvas. Gere sugestões a partir dos alertas do período."; parent.appendChild(intro); return;
  }
  state.plan.actions.forEach((action) => {
    const card = document.createElement("article"); card.className = "fm-action-item";
    const main = document.createElement("div");
    addText(main, "span", (action.priority || "media").toUpperCase() + " · " + (action.phase || "30-dias"), "fm-tag");
    addText(main, "h3", action.title);
    addText(main, "p", action.rationale);
    addText(main, "p", action.followUp);
    addText(main, "p", "Economia potencial ilustrativa: " + money(action.potentialSaving || 0, action.currency || "PYG") + " por mês", "fm-action-meta");
    const controls = document.createElement("div"); controls.className = "fm-action-controls";
    const label = addText(controls, "label", "Estado da ação"); const select = document.createElement("select"); select.className = "input";
    select.setAttribute("aria-label", "Estado da ação " + action.title);
    [["pendente","Pendente"],["em-andamento","Em andamento"],["concluida","Concluída"],["descartada","Descartada"]].forEach(([value,text]) => {
      const option = document.createElement("option"); option.value = value; option.textContent = text; select.appendChild(option);
    });
    select.value = validateActionStatus(action.status);
    select.addEventListener("change", async () => {
      state.plan.actions = state.plan.actions.map((item) => item.id === action.id ? { ...item, status: validateActionStatus(select.value), updatedAt: new Date().toISOString() } : item);
      await savePlan();
      $("#fmStatus").textContent = "Estado da ação salvo no IndexedDB.";
    });
    controls.append(label, select); card.append(main, controls); parent.appendChild(card);
  });
}
