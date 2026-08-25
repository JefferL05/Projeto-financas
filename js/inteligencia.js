import { openDB, getAll, put, remove, runAtomic } from "./db.js";
import { formatMoney, parseLooseNumber, uid } from "./utils.js";
import { localISO } from "./finance/date-utils.js";
import { askFinancialAssistant, clearConversationMemory } from "./ai/assistant.js";
import {
  appendUserMessage,
  appendAssistantResponse,
  appendStatusMessage
} from "./ai/response-renderer.js";
import {
  getPrivacySettings,
  savePrivacySettings,
  PRIVACY_LEVELS
} from "./ai/privacy.js";
import { analyzeFinancialData } from "./finance/analytics-engine.js";
import { resolvePeriod } from "./finance/period-utils.js";
import { goalProjection } from "./finance/projections.js";
import { createTransfer, deleteTransfer } from "./accounts/transfers.js";
import { markSchedulePaid } from "./transactions/schedules.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  transactions: [],
  goals: [],
  budgets: [],
  categories: [],
  accounts: [],
  schedules: [],
  rates: [],
  rules: [],
  settings: { brlToPyg: 1300, baseCurrency: "PYG" }
};

let pendingMutation = null;
let undoMutation = null;
let activeController = null;
let toastTimer;
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  mapElements();
  await openDB();
  await reload();
  bindTabs();
  bindAI();
  bindPlanning();
  bindBudgets();
  bindPrivacy();
  routeFromHash();
  renderInsights();
  renderGoals();
  renderBudgets();
  renderPrivacyState();
  renderQuickPrompts();
  welcome();
  updateModeBadge();
  window.addEventListener("online", updateModeBadge);
  window.addEventListener("offline", updateModeBadge);
}

function mapElements() {
  Object.assign(els, {
    chatLog: $("#chatLog"),
    aiQuestion: $("#aiQuestion"),
    askAiBtn: $("#askAiBtn"),
    stopAiBtn: $("#stopAiBtn"),
    clearConversationBtn: $("#clearConversationBtn"),
    confirmMutationBtn: $("#confirmMutationBtn"),
    cancelMutationBtn: $("#cancelMutationBtn"),
    undoMutationBtn: $("#undoMutationBtn"),
    mutationActions: $("#mutationActions"),
    aiModeBadge: $("#aiModeBadge"),
    privacyLevel: $("#privacyLevel"),
    onlineAiToggle: $("#onlineAiToggle"),
    onlineEndpoint: $("#onlineEndpoint"),
    privacySummary: $("#privacySummary"),
    budgetCategory: $("#budgetCategory"),
    budgetCurrency: $("#budgetCurrency"),
    budgetLimit: $("#budgetLimit"),
    budgetList: $("#budgetList")
  });
}

async function reload() {
  const [transactions, goals, budgets, categories, accounts, schedules, rates, rules, storedSettings] = await Promise.all([
    getAll("transactions"),
    getAll("goals"),
    getAll("budgets"),
    getAll("categories"),
    getAll("accounts"),
    getAll("schedules"),
    getAll("exchangeRates"),
    getAll("rules"),
    getAll("settings")
  ]);

  state.transactions = transactions;
  state.goals = goals;
  state.budgets = budgets;
  state.categories = categories.map((item) => item.name).sort((a, b) => a.localeCompare(b, "pt-BR"));
  state.accounts = accounts;
  state.schedules = schedules;
  state.rates = rates;
  state.rules = rules;

  const map = Object.fromEntries(storedSettings.map((item) => [item.key, item.value]));
  state.settings.brlToPyg = Number(map.brlToPyg) || 1300;
  state.settings.baseCurrency = map.baseCurrency || "PYG";
  fillCategorySelects();
}

function fillCategorySelects() {
  if (!els.budgetCategory) return;
  const previous = els.budgetCategory.value;
  els.budgetCategory.replaceChildren();
  state.categories.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    els.budgetCategory.appendChild(option);
  });
  if (state.categories.includes(previous)) els.budgetCategory.value = previous;
}

function bindTabs() {
  $$("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
  });
  window.addEventListener("hashchange", routeFromHash);
}

function routeFromHash() {
  const hash = location.hash.replace("#", "");
  selectTab(["ia", "planejamento", "orcamentos", "privacidade"].includes(hash) ? hash : "ia", false);
}

function selectTab(name, updateHash = true) {
  $$(".tab-btn").forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $$(".intel-view").forEach((view) => view.classList.toggle("active", view.id === `tab-${name}`));
  if (updateHash) history.replaceState(null, "", `#${name}`);
}

function bindAI() {
  els.askAiBtn.addEventListener("click", askAI);
  els.aiQuestion.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      askAI();
    }
  });
  els.stopAiBtn.addEventListener("click", stopAI);
  els.clearConversationBtn.addEventListener("click", clearConversation);
  els.confirmMutationBtn.addEventListener("click", confirmPendingMutation);
  els.cancelMutationBtn.addEventListener("click", cancelPendingMutation);
  els.undoMutationBtn.addEventListener("click", undoLastMutation);
}

function welcome() {
  appendAssistantResponse(els.chatLog, {
    title: "Assistente financeiro",
    summary: "Posso analisar períodos, moedas, contas, patrimônio, compromissos, recorrências, metas e orçamentos. Os números são calculados localmente; a IA online é opcional.",
    observations: ["Exemplos: “Quanto tenho disponível?”, “Compare este mês com o mês passado” ou “Transfira 500 reais da Carteira BRL para a Poupança”."],
    metrics: []
  }, { mode: navigator.onLine ? "Análise local" : "Modo offline" });
}

function renderQuickPrompts() {
  const prompts = [
    "Quanto gastei hoje?",
    "Compare este mês com o mês passado.",
    "Quanto tenho disponível?",
    "Qual é meu patrimônio?",
    "Quais contas vencem esta semana?",
    "Quais gastos parecem recorrentes?",
    "Tenho alguma despesa fora do normal?",
    "Quanto é seguro gastar até o fim do mês?"
  ];
  const container = $("#quickPrompts");
  container.replaceChildren();
  prompts.forEach((prompt) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-secondary";
    button.textContent = prompt;
    button.addEventListener("click", () => {
      els.aiQuestion.value = prompt;
      askAI();
    });
    container.appendChild(button);
  });
}

async function askAI() {
  const question = els.aiQuestion.value.trim();
  if (!question || activeController) return;

  appendUserMessage(els.chatLog, question);
  els.aiQuestion.value = "";
  setAnalyzing(true);
  const status = appendStatusMessage(
    els.chatLog,
    navigator.onLine ? "Analisando seus dados…" : "Analisando localmente em modo offline…"
  );
  activeController = new AbortController();

  try {
    const result = await askFinancialAssistant({
      question,
      transactions: state.transactions,
      goals: state.goals,
      budgets: state.budgets,
      categories: state.categories,
      accounts: state.accounts,
      schedules: state.schedules,
      rates: state.rates,
      rate: state.settings.brlToPyg,
      baseCurrency: state.settings.baseCurrency,
      onlineEndpoint: els.onlineEndpoint.value.trim() || "/api/financial-assistant",
      signal: activeController.signal
    });

    status.remove();
    appendAssistantResponse(els.chatLog, result.response, { mode: result.mode });
    pendingMutation = result.response.requiresConfirmation ? result.response.proposedMutation : null;
    renderMutationActions();
    updateModeBadge(result.mode);
  } catch (error) {
    status.remove();
    if (error?.name === "AbortError") {
      appendAssistantResponse(els.chatLog, {
        title: "Análise interrompida",
        summary: "A solicitação foi interrompida. Nenhum dado foi alterado.",
        metrics: [],
        observations: []
      }, { mode: "Análise local" });
    } else {
      appendAssistantResponse(els.chatLog, {
        title: "Não consegui concluir",
        summary: "Ocorreu um erro ao analisar os dados. Tente novamente; seus lançamentos não foram alterados.",
        metrics: [],
        observations: []
      }, { mode: "Análise local" });
    }
  } finally {
    activeController = null;
    setAnalyzing(false);
  }
}

function setAnalyzing(active) {
  els.askAiBtn.disabled = active;
  els.aiQuestion.disabled = active;
  els.stopAiBtn.classList.toggle("hidden", !active);
  if (!active) els.aiQuestion.focus();
}

function stopAI() {
  activeController?.abort();
}

function clearConversation() {
  clearConversationMemory();
  pendingMutation = null;
  els.chatLog.replaceChildren();
  renderMutationActions();
  welcome();
  toast("Conversa local apagada.");
}

function renderMutationActions() {
  els.mutationActions.classList.toggle("hidden", !pendingMutation);
  els.undoMutationBtn.classList.toggle("hidden", !undoMutation);
}

async function confirmPendingMutation() {
  if (!pendingMutation) return;
  const mutation = pendingMutation;
  pendingMutation = null;

  try {
    if (mutation.operation === "create_transaction") {
      await put("transactions", mutation.payload);
      undoMutation = { operation: "delete_transaction", payload: { id: mutation.payload.id } };
    } else if (mutation.operation === "update_transaction") {
      await put("transactions", mutation.payload);
      undoMutation = { operation: "restore_transaction", payload: mutation.undoSnapshot };
    } else if (mutation.operation === "delete_transaction") {
      await remove("transactions", mutation.payload.id);
      undoMutation = { operation: "restore_transaction", payload: mutation.undoSnapshot };
    } else if (mutation.operation === "create_transfer") {
      const source = state.accounts.find((account) => account.id === mutation.payload.sourceAccountId);
      const destination = state.accounts.find((account) => account.id === mutation.payload.destinationAccountId);
      if (!source || !destination) throw new Error("Uma das contas da transferência não existe mais.");
      const created = await createTransfer({
        sourceAccount: source,
        destinationAccount: destination,
        sourceAmount: mutation.payload.sourceAmount,
        destinationAmount: mutation.payload.destinationAmount,
        exchangeRate: mutation.payload.exchangeRate,
        date: mutation.payload.date,
        description: mutation.payload.description
      });
      undoMutation = { operation: "delete_transfer", payload: { transferId: created.transferId } };
    } else if (mutation.operation === "mark_schedule_paid") {
      const schedule = state.schedules.find((item) => item.id === mutation.payload.scheduleId);
      if (!schedule) throw new Error("O compromisso não existe mais.");
      const scheduleBefore = structuredClone(schedule);
      const result = await markSchedulePaid(schedule, { date: mutation.payload.date });
      undoMutation = {
        operation: "undo_schedule_paid",
        payload: { transactionId: result.transaction.id, schedule: scheduleBefore }
      };
    } else if (mutation.operation === "create_rule") {
      await put("rules", mutation.payload);
      undoMutation = { operation: "delete_rule", payload: { id: mutation.payload.id } };
    }

    await reload();
    renderInsights();
    renderBudgets();
    renderMutationActions();
    appendAssistantResponse(els.chatLog, {
      title: "Ação concluída",
      summary: "A alteração foi confirmada e salva no banco local.",
      metrics: [],
      observations: ["Você pode desfazer a última ação enquanto esta página permanecer aberta."]
    }, { mode: "Análise local" });
  } catch (error) {
    undoMutation = null;
    renderMutationActions();
    appendAssistantResponse(els.chatLog, {
      title: "Ação não executada",
      summary: error.message || "Não foi possível concluir a alteração.",
      metrics: [],
      observations: ["Nenhuma ação parcialmente interpretada é executada sem confirmação."]
    }, { mode: "Análise local" });
  }
}

function cancelPendingMutation() {
  pendingMutation = null;
  renderMutationActions();
  appendAssistantResponse(els.chatLog, {
    title: "Ação cancelada",
    summary: "Nenhum dado financeiro foi modificado.",
    metrics: [],
    observations: []
  }, { mode: "Análise local" });
}

async function undoLastMutation() {
  if (!undoMutation) return;
  const action = undoMutation;
  undoMutation = null;

  if (action.operation === "delete_transaction") {
    await remove("transactions", action.payload.id);
  } else if (action.operation === "restore_transaction") {
    await put("transactions", action.payload);
  } else if (action.operation === "delete_transfer") {
    await deleteTransfer(action.payload.transferId);
  } else if (action.operation === "delete_rule") {
    await remove("rules", action.payload.id);
  } else if (action.operation === "undo_schedule_paid") {
    await runAtomic(["transactions", "schedules"], "readwrite", (stores) => {
      stores.transactions.delete(action.payload.transactionId);
      stores.schedules.put(action.payload.schedule);
    });
  }

  await reload();
  renderInsights();
  renderBudgets();
  renderMutationActions();
  toast("Última alteração desfeita.");
}

function currentAnalysis() {
  return analyzeFinancialData({
    transactions: state.transactions,
    goals: state.goals,
    budgets: state.budgets,
    rate: state.settings.brlToPyg,
    rates: state.rates,
    period: resolvePeriod("this_month")
  });
}

function renderInsights() {
  const analysis = currentAnalysis();
  const container = $("#aiInsights");
  container.replaceChildren();
  const items = [];

  if (!analysis.transactionCount) {
    items.push({ level: "warning", title: "Sem dados no mês", text: "Cadastre transações para gerar insights." });
  } else {
    if (analysis.savingsRate !== null) {
      items.push({
        level: analysis.savingsRate >= 20 ? "good" : analysis.savingsRate >= 0 ? "warning" : "danger",
        title: "Taxa de poupança",
        text: `${analysis.savingsRate.toFixed(1)}% no mês atual.`
      });
    }
    if (analysis.categories[0]) {
      items.push({
        level: "",
        title: `Maior categoria: ${analysis.categories[0].category}`,
        text: formatMoney(analysis.categories[0].valuePYG, "PYG")
      });
    }
    if (analysis.recurring[0]) {
      items.push({
        level: "",
        title: "Possível recorrência",
        text: `${analysis.recurring[0].description}: padrão ${analysis.recurring[0].cadence}.`
      });
    }
    if (analysis.anomalies[0]) {
      items.push({
        level: "warning",
        title: "Fora do padrão recente",
        text: `${analysis.anomalies[0].description}: ${analysis.anomalies[0].criterion}`
      });
    }
  }

  items.slice(0, 3).forEach((item) => {
    const article = document.createElement("div");
    article.className = `insight ${item.level}`;
    const title = document.createElement("strong");
    title.textContent = item.title;
    const text = document.createElement("p");
    text.className = "muted insight-text";
    text.textContent = item.text;
    article.append(title, text);
    container.appendChild(article);
  });
}

function bindPlanning() {
  $("#addGoalBtn").addEventListener("click", addGoal);
  $("#simulateBtn").addEventListener("click", simulate);
  const future = new Date();
  future.setFullYear(future.getFullYear() + 2);
  $("#goalDate").value = localISO(future);
  simulate();
}

async function addGoal() {
  const name = $("#goalName").value.trim().replace(/[<>]/g, "").slice(0, 80);
  const currency = $("#goalCurrency").value;
  const target = parseLooseNumber($("#goalTarget").value, { localeHint: currency === "BRL" ? "pt-BR" : null });
  const current = parseLooseNumber($("#goalCurrent").value, { localeHint: currency === "BRL" ? "pt-BR" : null }) || 0;
  const monthly = parseLooseNumber($("#goalMonthly").value, { localeHint: currency === "BRL" ? "pt-BR" : null }) || 0;
  const targetDate = $("#goalDate").value;
  const priority = $("#goalPriority").value;

  if (!name || target <= 0 || !targetDate || !["BRL", "PYG"].includes(currency)) {
    toast("Revise nome, valor, moeda e data da meta.");
    return;
  }
  if (current < 0 || monthly < 0 || current > 1e12 || target > 1e12) {
    toast("Valores da meta estão fora do intervalo permitido.");
    return;
  }

  await put("goals", {
    id: uid("goal"),
    name,
    currency,
    target,
    current,
    monthly,
    targetDate,
    priority,
    createdAt: new Date().toISOString()
  });
  $("#goalName").value = "";
  $("#goalTarget").value = "";
  $("#goalCurrent").value = "";
  $("#goalMonthly").value = "";
  await reload();
  renderGoals();
  toast("Meta adicionada.");
}

function renderGoals() {
  const container = $("#goalList");
  container.replaceChildren();
  const list = [...state.goals].sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  if (!list.length) {
    container.appendChild(emptyNode("Nenhuma meta criada ainda."));
    return;
  }

  list.forEach((goal) => {
    const projection = goalProjection(goal);
    const card = document.createElement("div");
    card.className = "goal-card";

    const head = document.createElement("div");
    head.className = "goal-head";
    const left = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = goal.name;
    const priority = document.createElement("div");
    priority.className = "muted goal-priority";
    priority.textContent = `Prioridade ${goal.priority}`;
    left.append(name, priority);
    const percent = document.createElement("strong");
    percent.textContent = `${projection.progressPercent.toFixed(0)}%`;
    head.append(left, percent);

    const progress = document.createElement("div");
    progress.className = "progress";
    const bar = document.createElement("span");
    bar.style.width = `${Math.min(100, projection.progressPercent)}%`;
    progress.appendChild(bar);

    const meta = document.createElement("div");
    meta.className = "goal-meta";
    [
      `${formatMoney(goal.current, goal.currency)} de ${formatMoney(goal.target, goal.currency)}`,
      `Aporte necessário: ${formatMoney(projection.requiredMonthly, goal.currency)}/mês`,
      projection.completed ? "Meta concluída" : projection.overdue ? "Prazo vencido" : `Prazo: ${formatDateBR(goal.targetDate)}`
    ].forEach((text) => {
      const span = document.createElement("span");
      span.textContent = text;
      meta.appendChild(span);
    });

    const actions = document.createElement("div");
    actions.className = "goal-actions";
    const contribution = document.createElement("button");
    contribution.className = "btn btn-secondary";
    contribution.type = "button";
    contribution.textContent = "+ Aporte";
    contribution.addEventListener("click", () => addGoalContribution(goal.id));
    const del = document.createElement("button");
    del.className = "btn btn-danger";
    del.type = "button";
    del.textContent = "Excluir";
    del.addEventListener("click", () => deleteGoal(goal.id));
    actions.append(contribution, del);
    card.append(head, progress, meta, actions);
    container.appendChild(card);
  });
}

function formatDateBR(date) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

async function addGoalContribution(id) {
  const goal = state.goals.find((item) => item.id === id);
  if (!goal) return;
  const raw = prompt(`Quanto deseja adicionar à meta “${goal.name}”?`);
  if (raw === null) return;
  const amount = parseLooseNumber(raw, { localeHint: goal.currency === "BRL" ? "pt-BR" : null });
  if (!amount || amount <= 0) return toast("Valor inválido.");
  await put("goals", {
    ...goal,
    current: Math.min(Number(goal.target), Number(goal.current || 0) + amount),
    updatedAt: new Date().toISOString()
  });
  await reload();
  renderGoals();
  toast("Aporte registrado.");
}

async function deleteGoal(id) {
  const goal = state.goals.find((item) => item.id === id);
  if (!goal || !confirm(`Excluir a meta “${goal.name}”?`)) return;
  await remove("goals", id);
  await reload();
  renderGoals();
  toast("Meta excluída.");
}

function simulate() {
  const monthly = Math.max(0, Number($("#simMonthly").value) || 0);
  const years = Math.min(50, Math.max(1, Number($("#simYears").value) || 1));
  const annual = Math.min(100, Math.max(0, Number($("#simRate").value) || 0));
  const months = years * 12;
  const rate = Math.pow(1 + annual / 100, 1 / 12) - 1;
  const future = rate > 0 ? monthly * ((Math.pow(1 + rate, months) - 1) / rate) : monthly * months;
  const contributed = monthly * months;
  $("#simulationResult").textContent = formatMoney(future, "BRL");
  $("#simulationDetail").textContent = `Aportes: ${formatMoney(contributed, "BRL")} · crescimento matemático estimado: ${formatMoney(Math.max(0, future - contributed), "BRL")}.`;
}

function bindBudgets() {
  $("#addBudgetBtn").addEventListener("click", addBudget);
}

async function addBudget() {
  const category = els.budgetCategory.value;
  const currency = els.budgetCurrency.value;
  const limit = parseLooseNumber(els.budgetLimit.value, { localeHint: currency === "BRL" ? "pt-BR" : null });
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (!category || !["BRL", "PYG"].includes(currency) || !(limit > 0)) {
    toast("Informe categoria, moeda e limite válido.");
    return;
  }

  const existing = state.budgets.find((budget) => budget.period === period && budget.category === category && budget.currency === currency);
  await put("budgets", {
    id: existing?.id || uid("budget"),
    category,
    currency,
    limit,
    period,
    rollover: existing?.rollover || false,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  els.budgetLimit.value = "";
  await reload();
  renderBudgets();
  toast(existing ? "Orçamento atualizado." : "Orçamento criado.");
}

function renderBudgets() {
  const analysis = currentAnalysis();
  els.budgetList.replaceChildren();
  if (!analysis.budgets.length) {
    els.budgetList.appendChild(emptyNode("Nenhum orçamento definido para este mês."));
    return;
  }

  analysis.budgets.forEach((budget) => {
    const card = document.createElement("div");
    card.className = "budget-card";
    const head = document.createElement("div");
    head.className = "goal-head";
    const title = document.createElement("strong");
    title.textContent = budget.category;
    const status = document.createElement("span");
    status.className = `budget-status ${budget.status}`;
    status.textContent = budget.status === "saudavel" ? "Saudável" : budget.status === "atencao" ? "Atenção" : "Excedido";
    head.append(title, status);

    const summary = document.createElement("p");
    summary.className = "muted";
    summary.textContent = `${formatMoney(budget.spent, budget.currency)} de ${formatMoney(budget.limit, budget.currency)} (${budget.usedPercent.toFixed(0)}%)${budget.approximate ? " · aprox." : ""}.`;
    const original = document.createElement("p");
    original.className = "muted";
    original.textContent = `Original: ${formatMoney(budget.originalByCurrency.BRL, "BRL")} + ${formatMoney(budget.originalByCurrency.PYG, "PYG")}.`;
    const projection = document.createElement("p");
    projection.className = "muted";
    projection.textContent = budget.projection.willExceed
      ? `Mantido o ritmo atual, pode ultrapassar o limite em ${formatMoney(budget.projection.projectedOverrun, budget.currency)}.`
      : `Restante: ${formatMoney(budget.remaining, budget.currency)}.`;

    const del = document.createElement("button");
    del.className = "btn btn-danger";
    del.type = "button";
    del.textContent = "Excluir orçamento";
    del.addEventListener("click", async () => {
      if (!confirm(`Excluir orçamento de ${budget.category}?`)) return;
      await remove("budgets", budget.id);
      await reload();
      renderBudgets();
    });
    card.append(head, summary, original, projection, del);
    els.budgetList.appendChild(card);
  });
}

function bindPrivacy() {
  $("#savePrivacyBtn").addEventListener("click", savePrivacy);
}

function renderPrivacyState() {
  const privacy = getPrivacySettings();
  els.privacyLevel.value = privacy.level;
  els.onlineAiToggle.checked = privacy.onlineEnabled;
  els.privacySummary.textContent = privacy.onlineEnabled
    ? `IA online habilitada com nível “${privacy.level}”. Dados são enviados somente quando você faz uma pergunta e o endpoint configurado está disponível.`
    : "Somente análise local. Nenhum dado financeiro é enviado a um modelo externo.";
}

function savePrivacy() {
  const level = els.privacyLevel.value;
  const onlineEnabled = els.onlineAiToggle.checked;
  if (onlineEnabled && level === PRIVACY_LEVELS.LOCAL) {
    toast("Escolha um nível online antes de habilitar a IA externa.");
    els.onlineAiToggle.checked = false;
    return;
  }
  if (onlineEnabled && !confirm("Ao habilitar a IA online, resumos financeiros mínimos poderão ser enviados ao endpoint configurado quando você fizer perguntas. Deseja continuar?")) {
    els.onlineAiToggle.checked = false;
    return;
  }
  savePrivacySettings({ level, onlineEnabled });
  renderPrivacyState();
  updateModeBadge();
  toast("Preferências de privacidade salvas.");
}

function updateModeBadge(forcedMode) {
  const privacy = getPrivacySettings();
  let label = forcedMode;
  if (!label) {
    label = !navigator.onLine
      ? "Modo offline"
      : privacy.onlineEnabled && privacy.level !== "local"
        ? "IA online opcional"
        : "Análise local";
  }
  els.aiModeBadge.textContent = label;
  els.aiModeBadge.dataset.mode = label.toLowerCase().replaceAll(" ", "-");
}

function emptyNode(text) {
  const node = document.createElement("div");
  node.className = "empty";
  node.textContent = text;
  return node;
}

function toast(message) {
  clearTimeout(toastTimer);
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  toastTimer = setTimeout(() => node.classList.remove("show"), 2200);
}
