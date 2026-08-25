import {
  bulkPut,
  clearDatabaseData,
  count,
  get,
  getAll,
  put,
  remove
} from "./db.js";
import {
  DEFAULT_CATEGORIES,
  csvEscape,
  downloadFile,
  formatDate,
  formatMoney,
  parseLooseNumber,
  startOfMonthISO,
  todayISO,
  uid
} from "./utils.js";
import { parseSmartInput } from "./parser.js";
import { renderBalanceChart, renderCashflowChart, renderCategoryChart } from "./charts.js";
import { analyzeFinancialData } from "./finance/analytics-engine.js";
import { resolvePeriod } from "./finance/period-utils.js";
import { accountSummary, availableFunds, netWorth } from "./accounts/account-balance.js";
import { deleteTransfer } from "./accounts/transfers.js";
import {
  createBackupJSON,
  parseBackupFile,
  previewRestore,
  restoreBackup
} from "./data/backup-service.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  transactions: [],
  categories: [],
  accounts: [],
  rates: [],
  goals: [],
  budgets: [],
  schedules: [],
  settings: { brlToPyg: 1300, baseCurrency: "PYG" },
  txType: "expense",
  smartSuggestions: []
};

const els = {};
let toastTimer;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  mapElements();
  bindEvents();
  await seedDefaults();
  await reloadData();
  els.filterMonth.value = startOfMonthISO();
  els.txDate.value = todayISO();
  renderAll();
  setupConnectivity();
  registerServiceWorker();
}

function mapElements() {
  Object.assign(els, {
    pageTitle: $("#pageTitle"),
    transactionDialog: $("#transactionDialog"),
    transactionForm: $("#transactionForm"),
    transactionId: $("#transactionId"),
    txAccount: $("#txAccount"),
    txCurrency: $("#txCurrency"),
    txAmount: $("#txAmount"),
    txCategory: $("#txCategory"),
    txDate: $("#txDate"),
    txStatus: $("#txStatus"),
    txDescription: $("#txDescription"),
    txTags: $("#txTags"),
    smartImportDialog: $("#smartImportDialog"),
    smartInput: $("#smartInput"),
    smartDefaultCurrency: $("#smartDefaultCurrency"),
    smartSuggestions: $("#smartSuggestions"),
    filterMonth: $("#filterMonth"),
    filterType: $("#filterType"),
    filterCurrency: $("#filterCurrency"),
    filterCategory: $("#filterCategory"),
    filterAccount: $("#filterAccount"),
    searchInput: $("#searchInput"),
    exchangeRate: $("#exchangeRate"),
    baseCurrency: $("#baseCurrency"),
    toast: $("#toast")
  });
}

function bindEvents() {
  $$(".nav-link[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $$("[data-view-jump]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.viewJump));
  });

  $("#newTransactionBtn").addEventListener("click", () => openTransactionDialog());
  $("#quickImportBtn").addEventListener("click", () => els.smartImportDialog.showModal());

  $$("[data-tx-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.txType = button.dataset.txType;
      updateTransactionTypeButtons();
    });
  });

  els.txAccount.addEventListener("change", syncCurrencyWithAccount);
  els.transactionForm.addEventListener("submit", saveTransaction);

  [els.filterMonth, els.filterType, els.filterCurrency, els.filterCategory, els.filterAccount]
    .forEach((element) => element.addEventListener("change", renderTransactions));
  els.searchInput.addEventListener("input", renderTransactions);

  els.smartInput.addEventListener("input", renderSmartSuggestions);
  els.smartDefaultCurrency.addEventListener("change", renderSmartSuggestions);
  $("#importSmartBtn").addEventListener("click", importSmartSuggestions);

  $("#exportJsonBtn").addEventListener("click", exportJSON);
  $("#importJsonInput").addEventListener("change", importJSON);
  $("#exportCsvBtn").addEventListener("click", exportCSV);
  $("#importCsvInput").addEventListener("change", importCSV);
  $("#clearDatabaseBtn").addEventListener("click", clearDatabase);

  $("#saveSettingsBtn").addEventListener("click", saveSettings);
  $("#fetchRateBtn").addEventListener("click", fetchRate);
  $("#addCategoryBtn").addEventListener("click", addCategory);
}

async function seedDefaults() {
  if (!(await getAll("categories")).length) {
    await bulkPut("categories", DEFAULT_CATEGORIES.map((name) => ({
      name,
      createdAt: new Date().toISOString()
    })));
  }
  if (!(await get("settings", "brlToPyg"))) await put("settings", { key: "brlToPyg", value: 1300 });
  if (!(await get("settings", "baseCurrency"))) await put("settings", { key: "baseCurrency", value: "PYG" });
}

async function reloadData() {
  const [transactions, categories, accounts, rates, goals, budgets, schedules] = await Promise.all([
    getAll("transactions"),
    getAll("categories"),
    getAll("accounts"),
    getAll("exchangeRates"),
    getAll("goals"),
    getAll("budgets"),
    getAll("schedules")
  ]);

  state.transactions = transactions;
  state.categories = categories.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  state.accounts = accounts.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  state.rates = rates;
  state.goals = goals;
  state.budgets = budgets;
  state.schedules = schedules;
  state.settings.brlToPyg = Number((await get("settings", "brlToPyg"))?.value) || 1300;
  state.settings.baseCurrency = (await get("settings", "baseCurrency"))?.value || "PYG";

  els.exchangeRate.value = state.settings.brlToPyg;
  els.baseCurrency.value = state.settings.baseCurrency;
  fillCategorySelects();
  fillAccountSelects();
}

function fillCategorySelects() {
  const currentTx = els.txCategory.value;
  const currentFilter = els.filterCategory.value;
  els.txCategory.replaceChildren();
  els.filterCategory.replaceChildren(new Option("Todas as categorias", ""));

  state.categories.forEach((category) => {
    els.txCategory.appendChild(new Option(category.name, category.name));
    els.filterCategory.appendChild(new Option(category.name, category.name));
  });

  if (state.categories.some((category) => category.name === currentTx)) els.txCategory.value = currentTx;
  if (state.categories.some((category) => category.name === currentFilter)) els.filterCategory.value = currentFilter;
  renderCategoryManager();
}

function fillAccountSelects() {
  const currentTx = els.txAccount.value;
  const currentFilter = els.filterAccount.value;
  els.txAccount.replaceChildren();
  els.filterAccount.replaceChildren(new Option("Todas as contas", ""));

  state.accounts.filter((account) => !account.archived).forEach((account) => {
    const label = `${account.name} · ${account.currency}`;
    els.txAccount.appendChild(new Option(label, account.id));
    els.filterAccount.appendChild(new Option(label, account.id));
  });

  if (state.accounts.some((account) => account.id === currentTx && !account.archived)) els.txAccount.value = currentTx;
  if (state.accounts.some((account) => account.id === currentFilter)) els.filterAccount.value = currentFilter;
}

function switchView(view) {
  $$(".view").forEach((section) => section.classList.remove("active"));
  $$(".nav-link[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  $(`#view-${view}`)?.classList.add("active");
  els.pageTitle.textContent = {
    dashboard: "Dashboard",
    transactions: "Transações",
    analytics: "Analytics",
    data: "Dados & Backup",
    settings: "Configurações"
  }[view] || "Projeto Finanças";

  if (view === "analytics") renderAnalytics();
  if (view === "data") renderDatabaseStats();
}

function openTransactionDialog(transaction = null) {
  if (transaction?.type === "transfer") {
    toast("Edite transferências pela área Contas & Planejamento.");
    return;
  }

  state.txType = transaction?.type || "expense";
  els.transactionId.value = transaction?.id || "";
  els.txAccount.value = transaction?.accountId || defaultAccountId(transaction?.currency || "PYG");
  els.txCurrency.value = transaction?.currency || selectedAccount()?.currency || "PYG";
  els.txAmount.value = transaction
    ? transaction.currency === "PYG"
      ? Math.round(transaction.amount).toLocaleString("pt-BR")
      : Number(transaction.amount).toFixed(2).replace(".", ",")
    : "";
  els.txCategory.value = transaction?.category || state.categories[0]?.name || "Outros";
  els.txDate.value = transaction?.date || todayISO();
  els.txStatus.value = transaction?.status || "cleared";
  els.txDescription.value = transaction?.description || "";
  els.txTags.value = (transaction?.tags || []).join(", ");
  $("#transactionDialogTitle").textContent = transaction ? "Editar transação" : "Nova transação";
  updateTransactionTypeButtons();
  els.transactionDialog.showModal();
}

function defaultAccountId(currency) {
  return state.accounts.find((account) => !account.archived && account.currency === currency)?.id || "";
}

function selectedAccount() {
  return state.accounts.find((account) => account.id === els.txAccount.value);
}

function syncCurrencyWithAccount() {
  const account = selectedAccount();
  if (account) els.txCurrency.value = account.currency;
}

function updateTransactionTypeButtons() {
  $$("[data-tx-type]").forEach((button) => {
    button.classList.toggle("active", button.dataset.txType === state.txType);
  });
}

async function saveTransaction(event) {
  event.preventDefault();
  const amount = parseLooseNumber(els.txAmount.value, { localeHint: els.txCurrency.value === "BRL" ? "pt-BR" : null });
  const account = selectedAccount();

  if (!amount || !account) {
    toast("Informe valor e conta válidos.");
    return;
  }
  if (account.currency !== els.txCurrency.value) {
    toast("A moeda da transação deve ser a mesma moeda principal da conta.");
    return;
  }

  const id = els.transactionId.value || uid("tx");
  const previous = state.transactions.find((transaction) => transaction.id === id);
  const timestamp = new Date().toISOString();

  await put("transactions", {
    id,
    type: state.txType,
    currency: els.txCurrency.value,
    amount: els.txCurrency.value === "PYG" ? Math.round(amount) : Number(amount.toFixed(2)),
    accountId: account.id,
    category: els.txCategory.value,
    description: els.txDescription.value.trim() || els.txCategory.value,
    date: els.txDate.value,
    tags: els.txTags.value.split(",").map((item) => item.trim()).filter(Boolean),
    status: els.txStatus.value,
    clearedAt: ["cleared", "reconciled"].includes(els.txStatus.value) ? previous?.clearedAt || timestamp : null,
    reconciledAt: els.txStatus.value === "reconciled" ? previous?.reconciledAt || timestamp : null,
    exchangeRateSnapshot: els.txCurrency.value === "BRL" ? Number(previous?.exchangeRateSnapshot || state.settings.brlToPyg) : null,
    createdAt: previous?.createdAt || timestamp,
    updatedAt: timestamp
  });

  els.transactionDialog.close();
  await reloadData();
  renderAll();
  toast(previous ? "Transação atualizada." : "Transação adicionada.");
}

async function editTransaction(id) {
  const transaction = state.transactions.find((item) => item.id === id);
  if (transaction) openTransactionDialog(transaction);
}

async function deleteTransaction(id) {
  const transaction = state.transactions.find((item) => item.id === id);
  if (!transaction) return;

  if (transaction.type === "transfer" && transaction.transferId) {
    if (!confirm("Excluir a transferência inteira, incluindo as duas movimentações?")) return;
    await deleteTransfer(transaction.transferId);
  } else {
    if (!confirm(`Excluir “${transaction.description}”?`)) return;
    await remove("transactions", id);
  }

  await reloadData();
  renderAll();
  toast("Movimentação excluída.");
}

function renderAll() {
  renderDashboard();
  renderTransactions();
  renderAnalytics();
  renderCategoryManager();
  renderDatabaseStats();
}

function currentAnalysis() {
  return analyzeFinancialData({
    transactions: state.transactions,
    goals: state.goals,
    budgets: state.budgets,
    rate: state.settings.brlToPyg,
    rates: state.rates,
    period: resolvePeriod("this_month", new Date()),
    filters: {}
  });
}

function renderDashboard() {
  const analysis = currentAnalysis();
  const base = state.settings.baseCurrency;
  const rate = state.settings.brlToPyg;

  const pyg = analysis.originalByCurrency.PYG;
  const brl = analysis.originalByCurrency.BRL;
  $("#pygIncome").textContent = `+ ${formatMoney(pyg.income, "PYG")}`;
  $("#pygExpense").textContent = `- ${formatMoney(pyg.expense, "PYG")}`;
  $("#pygBalance").textContent = formatMoney(pyg.income - pyg.expense, "PYG");
  $("#brlIncome").textContent = `+ ${formatMoney(brl.income, "BRL")}`;
  $("#brlExpense").textContent = `- ${formatMoney(brl.expense, "BRL")}`;
  $("#brlBalance").textContent = formatMoney(brl.income - brl.expense, "BRL");

  const flow = base === "PYG" ? analysis.balancePYG : analysis.balanceBRL;
  $("#consolidatedBalance").textContent = formatMoney(flow, base);
  $("#netWorthBalance").textContent = formatMoney(netWorth(state.accounts, state.transactions, { baseCurrency: base, rate }), base);
  $("#availableBalance").textContent = formatMoney(availableFunds(state.accounts, state.transactions, { baseCurrency: base, rate }), base);

  const daily = base === "PYG" ? analysis.projection.dailyAverage : analysis.projection.dailyAverage / rate;
  const projection = base === "PYG" ? analysis.projection.projectedExpense : analysis.projection.projectedExpense / rate;
  $("#dailyAverage").textContent = formatMoney(daily, base);
  $("#projectionText").textContent = `Projeção: ${formatMoney(projection, base)} no mês`;
  $("#rateStatus").textContent = analysis.approximate
    ? `Fluxo mensal · conversões podem usar 1 BRL ≈ ${Math.round(rate)} PYG`
    : "Receitas menos despesas do mês";

  renderRecentTransactions();
  renderCashflowChart($("#cashflowChart"), buildMonthlyCashflow(6));
  renderCategoryChart($("#categoryChart"), analysis.categories.map((item) => ({ label: item.category, value: item.valuePYG })));
}

function createTransactionRow(transaction) {
  const row = document.createElement("div");
  row.className = "transaction-row";

  const main = document.createElement("div");
  main.className = "transaction-main";
  const title = document.createElement("strong");
  title.textContent = transaction.description;
  const meta = document.createElement("div");
  meta.className = "transaction-meta";
  const account = state.accounts.find((item) => item.id === transaction.accountId);
  [transaction.category, formatDate(transaction.date), transaction.currency, account?.name, transaction.status]
    .filter(Boolean)
    .forEach((text) => {
      const span = document.createElement("span");
      span.textContent = text;
      meta.appendChild(span);
    });
  (transaction.tags || []).forEach((tag) => {
    const span = document.createElement("span");
    span.textContent = `#${tag}`;
    meta.appendChild(span);
  });
  main.append(title, meta);

  const side = document.createElement("div");
  side.className = "transaction-side";
  const value = document.createElement("div");
  const transfer = transaction.type === "transfer";
  value.className = `transaction-value ${transfer ? "" : transaction.type === "income" ? "income" : "expense"}`;
  const sign = transfer ? (transaction.transferRole === "destination" ? "+" : "−") : transaction.type === "income" ? "+" : "−";
  value.textContent = `${sign} ${formatMoney(transaction.amount, transaction.currency)}`;

  const actions = document.createElement("div");
  actions.className = "transaction-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Editar";
  edit.addEventListener("click", () => editTransaction(transaction.id));
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "expense";
  removeButton.textContent = "Excluir";
  removeButton.addEventListener("click", () => deleteTransaction(transaction.id));
  actions.append(edit, removeButton);
  side.append(value, actions);
  row.append(main, side);
  return row;
}

function renderRecentTransactions() {
  const container = $("#recentTransactions");
  container.replaceChildren();
  const recent = [...state.transactions]
    .sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date))
    .slice(0, 7);

  if (!recent.length) {
    container.appendChild(emptyNode("Nenhuma transação registrada."));
    return;
  }
  recent.forEach((transaction) => container.appendChild(createTransactionRow(transaction)));
}

function renderTransactions() {
  const month = els.filterMonth.value;
  const type = els.filterType.value;
  const currency = els.filterCurrency.value;
  const category = els.filterCategory.value;
  const accountId = els.filterAccount.value;
  const query = els.searchInput.value.trim().toLowerCase();

  const filtered = [...state.transactions]
    .filter((transaction) => {
      if (month && !transaction.date.startsWith(month)) return false;
      if (type && transaction.type !== type) return false;
      if (currency && transaction.currency !== currency) return false;
      if (category && transaction.category !== category) return false;
      if (accountId && transaction.accountId !== accountId) return false;
      if (query && !`${transaction.description} ${(transaction.tags || []).join(" ")}`.toLowerCase().includes(query)) return false;
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));

  $("#transactionCount").textContent = `${filtered.length} transaç${filtered.length === 1 ? "ão" : "ões"}`;
  const container = $("#transactionsList");
  container.replaceChildren();
  if (!filtered.length) container.appendChild(emptyNode("Nenhuma transação encontrada."));
  else filtered.forEach((transaction) => container.appendChild(createTransactionRow(transaction)));
}

function buildMonthlyCashflow(monthCount) {
  const result = [];
  const now = new Date();
  for (let index = monthCount - 1; index >= 0; index--) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const period = resolvePeriod("this_month", new Date(date.getFullYear(), date.getMonth(), new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
    const analysis = analyzeFinancialData({
      transactions: state.transactions,
      rate: state.settings.brlToPyg,
      rates: state.rates,
      period,
      filters: {}
    });
    result.push({
      label: new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", ""),
      income: analysis.incomePYG,
      expense: analysis.expensePYG
    });
  }
  return result;
}

function renderAnalytics() {
  const analysis = currentAnalysis();
  $("#topCategory").textContent = analysis.categories[0]?.category || "—";
  const largest = analysis.largestTransactions[0];
  $("#largestExpense").textContent = largest ? formatMoney(largest.amount, largest.currency) : "—";
  $("#savingsRate").textContent = analysis.savingsRate === null ? "—" : `${analysis.savingsRate.toFixed(1)}%`;
  $("#monthProjection").textContent = formatMoney(analysis.projection.projectedExpense, "PYG");

  const ranking = $("#categoryRanking");
  ranking.replaceChildren();
  const top = analysis.categories.slice(0, 8);
  const max = top[0]?.valuePYG || 1;
  if (!top.length) ranking.appendChild(emptyNode("Sem dados de gastos."));
  top.forEach((item) => {
    const wrapper = document.createElement("div");
    wrapper.className = "rank-item";
    const name = document.createElement("strong");
    name.textContent = item.category;
    const value = document.createElement("span");
    value.textContent = formatMoney(item.valuePYG, "PYG");
    const bar = document.createElement("div");
    bar.className = "rank-bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.max(4, item.valuePYG / max * 100)}%`;
    bar.appendChild(fill);
    wrapper.append(name, value, bar);
    ranking.appendChild(wrapper);
  });

  let balance = 0;
  const monthly = new Map();
  [...state.transactions]
    .filter((transaction) => transaction.type !== "transfer")
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((transaction) => {
      const converted = transaction.currency === "PYG" ? transaction.amount : transaction.amount * (transaction.exchangeRateSnapshot || state.settings.brlToPyg);
      balance += transaction.type === "income" ? converted : -converted;
      monthly.set(transaction.date.slice(0, 7), balance);
    });
  renderBalanceChart($("#balanceChart"), [...monthly.entries()].map(([label, value]) => ({ label, value })));
}

function renderSmartSuggestions() {
  state.smartSuggestions = parseSmartInput(els.smartInput.value, els.smartDefaultCurrency.value);
  const container = els.smartSuggestions;
  container.replaceChildren();

  if (!state.smartSuggestions.length) {
    container.appendChild(emptyNode("Cole anotações para gerar sugestões."));
    return;
  }

  state.smartSuggestions.forEach((suggestion) => {
    const row = document.createElement("div");
    row.className = "smart-item";
    const main = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = suggestion.description;
    const meta = document.createElement("small");
    meta.textContent = `${suggestion.category} · ${suggestion.type === "income" ? "Entrada" : "Saída"} · ${suggestion.currency}`;
    main.append(title, meta);
    const value = document.createElement("strong");
    value.className = suggestion.type === "income" ? "income" : "expense";
    value.textContent = formatMoney(suggestion.amount, suggestion.currency);
    row.append(main, value);
    container.appendChild(row);
  });
}

async function importSmartSuggestions() {
  if (!state.smartSuggestions.length) {
    toast("Nenhuma sugestão para importar.");
    return;
  }

  const timestamp = new Date().toISOString();
  const date = todayISO();
  const items = state.smartSuggestions.map((suggestion, index) => {
    const account = state.accounts.find((candidate) => !candidate.archived && candidate.currency === suggestion.currency);
    return {
      id: uid("tx"),
      ...suggestion,
      accountId: account?.id,
      date,
      status: "cleared",
      exchangeRateSnapshot: suggestion.currency === "BRL" ? state.settings.brlToPyg : null,
      createdAt: `${timestamp}-${index}`,
      updatedAt: timestamp
    };
  });

  await bulkPut("transactions", items);
  els.smartInput.value = "";
  state.smartSuggestions = [];
  els.smartImportDialog.close();
  await reloadData();
  renderAll();
  toast(`${items.length} lançamento(s) importado(s).`);
}

async function saveSettings() {
  state.settings.brlToPyg = Number(els.exchangeRate.value) || 1300;
  state.settings.baseCurrency = els.baseCurrency.value;
  await put("settings", { key: "brlToPyg", value: state.settings.brlToPyg });
  await put("settings", { key: "baseCurrency", value: state.settings.baseCurrency });
  renderAll();
  toast("Configurações salvas.");
}

async function fetchRate() {
  const button = $("#fetchRateBtn");
  button.disabled = true;
  button.textContent = "Buscando...";
  try {
    const response = await fetch("https://economia.awesomeapi.com.br/json/last/BRL-PYG", { cache: "no-store" });
    if (!response.ok) throw new Error("API indisponível");
    const data = await response.json();
    const value = Number(data.BRLPYG?.bid || data.BRLPYG?.ask || data.BRLPYG?.high);
    if (!(value > 0)) throw new Error("Cotação inválida");

    state.settings.brlToPyg = value;
    els.exchangeRate.value = Math.round(value);
    await put("settings", { key: "brlToPyg", value });
    await put("exchangeRates", {
      id: uid("rate"),
      pair: "BRL-PYG",
      rate: value,
      date: todayISO(),
      source: "AwesomeAPI",
      fetchedAt: new Date().toISOString()
    });
    await reloadData();
    renderAll();
    toast("Cotação atualizada.");
  } catch {
    toast("Não foi possível buscar a cotação. A taxa manual continua disponível.");
  } finally {
    button.disabled = false;
    button.textContent = "Buscar cotação online";
  }
}

function renderCategoryManager() {
  const container = $("#categoryManager");
  container.replaceChildren();
  state.categories.forEach((category) => {
    const chip = document.createElement("span");
    chip.className = "category-chip";
    const text = document.createElement("span");
    text.textContent = category.name;
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Excluir categoria ${category.name}`);
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => removeCategory(category.name));
    chip.append(text, removeButton);
    container.appendChild(chip);
  });
}

async function addCategory() {
  const input = $("#newCategoryInput");
  const name = input.value.trim();
  if (!name) return;
  if (state.categories.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
    toast("Essa categoria já existe.");
    return;
  }
  await put("categories", { name, createdAt: new Date().toISOString() });
  input.value = "";
  await reloadData();
  renderAll();
  toast("Categoria adicionada.");
}

async function removeCategory(name) {
  if (state.transactions.some((transaction) => transaction.category === name)) {
    toast("A categoria está sendo usada em transações.");
    return;
  }
  if (!confirm(`Excluir a categoria “${name}”?`)) return;
  await remove("categories", name);
  await reloadData();
  renderAll();
  toast("Categoria excluída.");
}

async function exportJSON() {
  const json = await createBackupJSON();
  downloadFile(`projeto-financas-backup-${todayISO()}.json`, json, "application/json");
  toast("Backup completo exportado.");
}

async function importJSON(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = await parseBackupFile(file);
    const preview = await previewRestore(parsed.stores);
    const summary = Object.entries(preview)
      .filter(([, item]) => item.incoming > 0)
      .map(([store, item]) => `${store}: ${item.create} novos, ${item.update} atualizados`)
      .join("\n");

    const mode = confirm(`Prévia da restauração:\n\n${summary || "Nenhum registro"}\n\nOK = MESCLAR com os dados atuais.\nCancelar = escolher substituir ou abortar.`)
      ? "merge"
      : confirm("Deseja SUBSTITUIR todos os dados locais pelos dados do backup?")
        ? "replace"
        : null;

    if (!mode) return;
    await restoreBackup(parsed.stores, { mode });
    await reloadData();
    renderAll();
    toast(`Backup restaurado em modo ${mode === "merge" ? "mesclar" : "substituir"}.`);
  } catch (error) {
    alert(error.message || "Não foi possível importar este JSON.");
  } finally {
    event.target.value = "";
  }
}

function exportCSV() {
  const rows = [
    ["id", "tipo", "moeda", "valor", "conta", "categoria", "descricao", "tags", "data", "status", "cotacao_snapshot", "criado_em"],
    ...state.transactions.map((transaction) => [
      transaction.id,
      transaction.type,
      transaction.currency,
      transaction.amount,
      transaction.accountId || "",
      transaction.category,
      transaction.description,
      (transaction.tags || []).join("|"),
      transaction.date,
      transaction.status || "cleared",
      transaction.exchangeRateSnapshot || "",
      transaction.createdAt || ""
    ])
  ];
  const csv = `\ufeff${rows.map((row) => row.map(csvEscape).join(";")).join("\n")}`;
  downloadFile(`transacoes-${todayISO()}.csv`, csv, "text/csv;charset=utf-8");
  toast("CSV exportado.");
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === ";" && !quoted) {
      result.push(current);
      current = "";
    } else current += char;
  }
  result.push(current);
  return result;
}

async function importCSV(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    alert("CSV excede o limite de 5 MB.");
    event.target.value = "";
    return;
  }

  try {
    const lines = (await file.text()).replace(/^\ufeff/, "").split(/\r?\n/).filter(Boolean);
    const header = parseCSVLine(lines[0]);
    const index = Object.fromEntries(header.map((name, position) => [name.trim().toLowerCase(), position]));
    const items = [];

    for (const line of lines.slice(1)) {
      const row = parseCSVLine(line);
      const currency = row[index.moeda] || "PYG";
      if (!["BRL", "PYG"].includes(currency)) throw new Error("CSV contém moeda inválida.");
      const amount = parseLooseNumber(row[index.valor], { localeHint: currency === "BRL" ? "pt-BR" : null });
      if (!(amount > 0)) throw new Error("CSV contém valor inválido.");
      const accountId = row[index.conta] || defaultAccountId(currency);
      if (!state.accounts.some((account) => account.id === accountId && account.currency === currency)) throw new Error("CSV referencia uma conta inexistente ou de moeda incompatível.");

      items.push({
        id: row[index.id] || uid("tx"),
        type: row[index.tipo] || "expense",
        currency,
        amount: currency === "PYG" ? Math.round(amount) : Number(amount.toFixed(2)),
        accountId,
        category: row[index.categoria] || "Outros",
        description: row[index.descricao] || "Importado",
        tags: String(row[index.tags] || "").split("|").filter(Boolean),
        date: row[index.data] || todayISO(),
        status: row[index.status] || "cleared",
        exchangeRateSnapshot: Number(row[index.cotacao_snapshot]) || (currency === "BRL" ? state.settings.brlToPyg : null),
        createdAt: row[index.criado_em] || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    if (!items.length) throw new Error("Nenhuma linha válida encontrada.");
    if (!confirm(`Foram validadas ${items.length} linhas. Deseja importá-las?`)) return;
    await bulkPut("transactions", items);
    await reloadData();
    renderAll();
    toast(`${items.length} transação(ões) importada(s).`);
  } catch (error) {
    alert(error.message || "Não foi possível importar este CSV.");
  } finally {
    event.target.value = "";
  }
}

async function clearDatabase() {
  if (!confirm("Apagar TODOS os dados financeiros locais? Faça um backup antes de continuar.")) return;
  await clearDatabaseData();
  await seedDefaults();
  await reloadData();
  renderAll();
  toast("Banco local limpo.");
}

async function renderDatabaseStats() {
  const pairs = [
    ["#dbTransactions", "transactions"],
    ["#dbAccounts", "accounts"],
    ["#dbSchedules", "schedules"],
    ["#dbCategories", "categories"],
    ["#dbRates", "exchangeRates"]
  ];
  await Promise.all(pairs.map(async ([selector, store]) => {
    const element = $(selector);
    if (element) element.textContent = String(await count(store));
  }));
}

function setupConnectivity() {
  const update = () => {
    $("#onlineStatus").textContent = navigator.onLine ? "Online" : "Offline";
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          toast("Nova versão disponível. Recarregue a página para atualizar.");
        }
      });
    });
  } catch {
    // O aplicativo continua funcional sem Service Worker.
  }
}

function emptyNode(text) {
  const element = document.createElement("div");
  element.className = "empty";
  element.textContent = text;
  return element;
}

function toast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}
