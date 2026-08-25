import { openDB, getAll, get, put, remove } from "./db.js";
import { formatMoney, parseLooseNumber, uid, todayISO, escapeHtml } from "./utils.js";
import { askFinancialAssistant, clearConversationMemory } from "./ai/assistant.js";
import { appendUserMessage, appendAssistantResponse, appendStatusMessage } from "./ai/response-renderer.js";
import { getPrivacySettings, savePrivacySettings, PRIVACY_LEVELS } from "./ai/privacy.js";
import { analyzeFinancialData } from "./finance/analytics-engine.js";
import { resolvePeriod } from "./finance/period-utils.js";
import { goalProjection } from "./finance/projections.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let transactions = [];
let goals = [];
let budgets = [];
let categories = [];
let settings = { brlToPyg: 1300, baseCurrency: "PYG" };
let pendingMutation = null;
let undoMutation = null;
let activeController = null;

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
  transactions = await getAll("transactions");
  goals = await getAll("goals");
  budgets = await getAll("budgets");
  categories = (await getAll("categories")).map((x) => x.name).sort((a, b) => a.localeCompare(b));
  const storedSettings = await getAll("settings");
  const map = Object.fromEntries(storedSettings.map((x) => [x.key, x.value]));
  settings.brlToPyg = Number(map.brlToPyg) || 1300;
  settings.baseCurrency = map.baseCurrency || "PYG";
  fillCategorySelects();
}

function fillCategorySelects() {
  for (const select of [els.budgetCategory]) {
    if (!select) continue;
    select.replaceChildren();
    categories.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
  }
}

function bindTabs() {
  $$('[data-tab]').forEach((button) => button.addEventListener("click", () => selectTab(button.dataset.tab)));
  window.addEventListener("hashchange", routeFromHash);
}

function routeFromHash() {
  const hash = location.hash.replace("#", "");
  selectTab(["ia", "planejamento", "orcamentos", "privacidade"].includes(hash) ? hash : "ia", false);
}

function selectTab(name, updateHash = true) {
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".intel-view").forEach((v) => v.classList.toggle("active", v.id === `tab-${name}`));
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
  const response = {
    title: "Assistente financeiro",
    summary: "Posso analisar períodos, categorias, moedas, recorrências, gastos fora do padrão, metas e orçamentos. Os cálculos são feitos localmente. A IA online é opcional e fica desativada por padrão.",
    observations: ["Experimente: “Quanto gastei com mercado em agosto?” ou “Compare este mês com o mês passado.”"],
    metrics: []
  };
  appendAssistantResponse(els.chatLog, response, { mode: navigator.onLine ? "Análise local" : "Modo offline" });
}

function renderQuickPrompts() {
  const prompts = [
    "Quanto gastei hoje?",
    "Compare este mês com o mês passado.",
    "Onde estou gastando mais?",
    "Quais gastos parecem recorrentes?",
    "Tenho alguma despesa fora do normal?",
    "Estou conseguindo economizar?",
    "Quanto posso gastar até o fim do mês?"
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
  const status = appendStatusMessage(els.chatLog, navigator.onLine ? "Analisando seus dados…" : "Analisando localmente em modo offline…");
  activeController = new AbortController();

  try {
    const result = await askFinancialAssistant({
      question,
      transactions,
      goals,
      budgets,
      categories,
      rate: settings.brlToPyg,
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
      appendAssistantResponse(els.chatLog, { title: "Análise interrompida", summary: "A solicitação foi interrompida. Nenhum dado foi alterado.", metrics: [], observations: [] }, { mode: "Análise local" });
    } else {
      console.error("Falha no assistente:", error);
      appendAssistantResponse(els.chatLog, { title: "Não consegui concluir", summary: "Ocorreu um erro ao analisar os dados. Tente novamente; seus lançamentos não foram alterados.", metrics: [], observations: [] }, { mode: "Análise local" });
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

  if (mutation.operation === "create_transaction") {
    await put("transactions", mutation.payload);
    undoMutation = { operation: "delete_transaction", payload: { id: mutation.payload.id } };
  } else if (mutation.operation === "update_transaction") {
    await put("transactions", mutation.payload);
    undoMutation = { operation: "restore_transaction", payload: mutation.undoSnapshot };
  } else if (mutation.operation === "delete_transaction") {
    await remove("transactions", mutation.payload.id);
    undoMutation = { operation: "restore_transaction", payload: mutation.undoSnapshot };
  }

  await reload();
  renderInsights();
  renderMutationActions();
  appendAssistantResponse(els.chatLog, { title: "Ação concluída", summary: "A alteração foi confirmada e salva no banco local.", metrics: [], observations: ["Você pode desfazer a última ação enquanto esta página permanecer aberta."] }, { mode: "Análise local" });
}

function cancelPendingMutation() {
  pendingMutation = null;
  renderMutationActions();
  appendAssistantResponse(els.chatLog, { title: "Ação cancelada", summary: "Nenhum dado financeiro foi modificado.", metrics: [], observations: [] }, { mode: "Análise local" });
}

async function undoLastMutation() {
  if (!undoMutation) return;
  if (undoMutation.operation === "delete_transaction") await remove("transactions", undoMutation.payload.id);
  if (undoMutation.operation === "restore_transaction") await put("transactions", undoMutation.payload);
  undoMutation = null;
  await reload();
  renderInsights();
  renderMutationActions();
  toast("Última alteração desfeita.");
}

function renderInsights() {
  const analysis = analyzeFinancialData({
    transactions,
    goals,
    budgets,
    rate: settings.brlToPyg,
    period: resolvePeriod("this_month")
  });
  const container = $("#aiInsights");
  container.replaceChildren();
  const items = [];

  if (!analysis.transactionCount) {
    items.push({ level: "warning", title: "Sem dados no mês", text: "Cadastre transações para gerar insights." });
  } else {
    if (analysis.savingsRate !== null) {
      items.push({ level: analysis.savingsRate >= 20 ? "good" : analysis.savingsRate >= 0 ? "warning" : "danger", title: "Taxa de poupança", text: `${analysis.savingsRate.toFixed(1)}% no mês atual.` });
    }
    if (analysis.categories[0]) items.push({ level: "", title: `Maior categoria: ${analysis.categories[0].category}`, text: formatMoney(analysis.categories[0].valuePYG, "PYG") });
    if (analysis.recurring[0]) items.push({ level: "", title: "Possível recorrência", text: `${analysis.recurring[0].description}: padrão ${analysis.recurring[0].cadence}.` });
    if (analysis.anomalies[0]) items.push({ level: "warning", title: "Fora do padrão recente", text: `${analysis.anomalies[0].description}: ${analysis.anomalies[0].criterion}` });
  }

  items.forEach((item) => {
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
  $("#goalDate").value = future.toISOString().slice(0, 10);
  simulate();
}

async function addGoal() {
  const name = $("#goalName").value.trim().replace(/[<>]/g, "").slice(0, 80);
  const currency = $("#goalCurrency").value;
  const target = parseLooseNumber($("#goalTarget").value);
  const current = parseLooseNumber($("#goalCurrent").value) || 0;
  const monthly = parseLooseNumber($("#goalMonthly").value) || 0;
  const targetDate = $("#goalDate").value;
  const priority = $("#goalPriority").value;
  if (!name || target <= 0 || !targetDate || !["BRL", "PYG"].includes(currency)) return toast("Revise nome, valor, moeda e data da meta.");
  if (current < 0 || monthly < 0 || current > 1e12 || target > 1e12) return toast("Valores da meta estão fora do intervalo permitido.");

  await put("goals", { id: uid(), name, currency, target, current, monthly, targetDate, priority, createdAt: new Date().toISOString() });
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
  const list = [...goals].sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Nenhuma meta criada ainda.";
    container.appendChild(empty);
    return;
  }

  list.forEach((goal) => {
    const p = goalProjection(goal);
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
    percent.textContent = `${p.progressPercent.toFixed(0)}%`;
    head.append(left, percent);

    const progress = document.createElement("div");
    progress.className = "progress";
    const bar = document.createElement("span");
    bar.style.width = `${p.progressPercent}%`;
    progress.appendChild(bar);

    const meta = document.createElement("div");
    meta.className = "goal-meta";
    const entries = [
      `${formatMoney(goal.current, goal.currency)} de ${formatMoney(goal.target, goal.currency)}`,
      `Aporte necessário: ${formatMoney(p.requiredMonthly, goal.currency)}/mês`,
      p.completed ? "Meta concluída" : p.overdue ? "Prazo vencido" : `Prazo: ${formatDateBR(goal.targetDate)}`
    ];
    entries.forEach((text) => { const span = document.createElement("span"); span.textContent = text; meta.appendChild(span); });

    const actions = document.createElement("div");
    actions.className = "goal-actions";
    const contribution = document.createElement("button");
    contribution.className = "btn btn-secondary";
    contribution.textContent = "+ Aporte";
    contribution.addEventListener("click", () => addGoalContribution(goal.id));
    const del = document.createElement("button");
    del.className = "btn btn-danger";
    del.textContent = "Excluir";
    del.addEventListener("click", () => deleteGoal(goal.id));
    actions.append(contribution, del);

    card.append(head, progress, meta, actions);
    container.appendChild(card);
  });
}

function formatDateBR(date) {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

async function addGoalContribution(id) {
  const goal = goals.find((g) => g.id === id);
  if (!goal) return;
  const raw = prompt(`Quanto deseja adicionar à meta “${goal.name}”?`);
  if (raw === null) return;
  const amount = parseLooseNumber(raw);
  if (!amount || amount <= 0) return toast("Valor inválido.");
  goal.current = Math.min(Number(goal.target), Number(goal.current || 0) + amount);
  goal.updatedAt = new Date().toISOString();
  await put("goals", goal);
  await reload();
  renderGoals();
  toast("Aporte registrado.");
}

async function deleteGoal(id) {
  const goal = goals.find((g) => g.id === id);
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
  const r = Math.pow(1 + annual / 100, 1 / 12) - 1;
  const future = r > 0 ? monthly * ((Math.pow(1 + r, months) - 1) / r) : monthly * months;
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
  const limit = parseLooseNumber(els.budgetLimit.value);
  const period = todayISO().slice(0, 7);
  if (!category || !["BRL", "PYG"].includes(currency) || !limit || limit <= 0) return toast("Informe categoria, moeda e limite válido.");

  const existing = budgets.find((b) => b.period === period && b.category === category && b.currency === currency);
  await put("budgets", {
    id: existing?.id || uid(),
    category,
    currency,
    limit,
    period,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  els.budgetLimit.value = "";
  await reload();
  renderBudgets();
  toast(existing ? "Orçamento atualizado." : "Orçamento criado.");
}

function renderBudgets() {
  const analysis = analyzeFinancialData({ transactions, goals, budgets, rate: settings.brlToPyg, period: resolvePeriod("this_month") });
  els.budgetList.replaceChildren();
  if (!analysis.budgets.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Nenhum orçamento definido para este mês.";
    els.budgetList.appendChild(empty);
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
    summary.textContent = `${formatMoney(budget.spent, budget.currency)} de ${formatMoney(budget.limit, budget.currency)} (${budget.usedPercent.toFixed(0)}%).`;
    const projection = document.createElement("p");
    projection.className = "muted";
    projection.textContent = budget.projection.willExceed
      ? `Mantido o ritmo atual, pode ultrapassar o limite em ${formatMoney(budget.projection.projectedOverrun, budget.currency)}.`
      : `Restante: ${formatMoney(budget.remaining, budget.currency)}.`;
    const del = document.createElement("button");
    del.className = "btn btn-danger";
    del.textContent = "Excluir orçamento";
    del.addEventListener("click", async () => {
      if (!confirm(`Excluir orçamento de ${budget.category}?`)) return;
      await remove("budgets", budget.id);
      await reload();
      renderBudgets();
    });
    card.append(head, summary, projection, del);
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
    ? `IA online habilitada com nível “${privacy.level}”. Dados enviados somente quando você faz uma pergunta e o endpoint configurado está disponível.`
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
  if (!label) label = !navigator.onLine ? "Modo offline" : privacy.onlineEnabled && privacy.level !== "local" ? "IA online opcional" : "Análise local";
  els.aiModeBadge.textContent = label;
  els.aiModeBadge.dataset.mode = label.toLowerCase().replaceAll(" ", "-");
}

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  const t = $("#toast");
  t.textContent = message;
  t.classList.add("show");
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}
