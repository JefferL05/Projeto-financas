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

import { $, $$ } from "./dom.js";

/* ==========================================================================
   Estado da aplicação
   ========================================================================== */
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
  txCurrency: "BRL",
  smartSuggestions: [],
  isBalanceHidden: false,
  selectedAccountId: null,
  isRecurring: false
};

const els = {};
let toastTimer;

/* ==========================================================================
   Inicialização
   ========================================================================== */
document.addEventListener("DOMContentLoaded", init);

async function init() {
  mapElements();
  bindEvents();
  setupTheme();
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
    txOverlay: $("#txOverlay"),
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
    toast: $("#toast"),

    // Novo modal (design do ZIP)
    typeExpense: $("#type-expense"),
    typeIncome: $("#type-income"),
    typeTransfer: $("#type-transfer"),
    btnCurrencyBrl: $("#btn-currency-brl"),
    btnCurrencyPyg: $("#btn-currency-pyg"),
    currencySymbol: $("#currency-symbol"),
    previewText: $("#preview-text"),
    accountChips: $("#accountChips"),
    categoryGrid: $("#categoryGrid"),
    categoryCount: $("#categoryCount"),
    txDateDisplay: $("#txDateDisplay"),
    txTimeDisplay: $("#txTimeDisplay"),
    txTagsContainer: $("#txTagsContainer"),
    toggleRecurringBtn: $("#toggleRecurringBtn"),
    saveTransactionBtn: $("#saveTransactionBtn"),
    recurringInput: $("#recurring"),

    // Dashboard (design do ZIP)
    mainBalanceVal: $("#mainBalanceVal"),
    subBalanceVal: $("#subBalanceVal"),
    mainCurrencyChip: $("#mainCurrencyChip"),
    toggleBalanceBtn: $("#toggleBalanceBtn"),
    toggleBalanceIcon: $("#toggleBalanceIcon"),
    rateHint: $("#rateHint"),
    monthlyVariation: $("#monthlyVariation"),
    baseRateVal: $("#baseRateVal"),
    refreshRateBtn: $("#refreshRateBtn"),
    syncRateIcon: $("#syncRateIcon"),
    simInput: $("#simInput"),
    simOutput: $("#simOutput"),
    periodTitle: $("#periodTitle"),
    monthlyNet: $("#monthlyNet"),
    monthIncome: $("#monthIncome"),
    monthIncomeCount: $("#monthIncomeCount"),
    monthExpense: $("#monthExpense"),
    monthExpenseCount: $("#monthExpenseCount"),
    accountsCarousel: $("#accountsCarousel"),
    accountsCount: $("#accountsCount"),
    txFilterBar: $("#txFilterBar"),
    recentTransactions: $("#recentTransactions"),
    dbStatus: $("#dbStatus")
  });
}

function bindEvents() {
  // Navegação de views
  $$(".nav-link[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  $$("[data-view-jump]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.viewJump));
  });

  // Bottom nav
  $$("[data-path]").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      if (view) switchView(view);
    });
  });

  $("#fabNewTransaction").addEventListener("click", (e) => {
    e.preventDefault();
    openTransactionDialog();
  });
  $("#navIA").addEventListener("click", (e) => {
    e.preventDefault();
    switchView("settings"); // placeholder: futuro painel de IA
  });

  $("#newTransactionBtn").addEventListener("click", () => openTransactionDialog());
  $("#quickImportBtn").addEventListener("click", () => els.smartImportDialog.showModal());

  // Tipo de lançamento (segmented)
  $$("[data-tx-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.txType = button.dataset.txType;
      updateTransactionTypeButtons();
    });
  });
  els.typeExpense.addEventListener("click", () => setTxType("expense"));
  els.typeIncome.addEventListener("click", () => setTxType("income"));
  els.typeTransfer.addEventListener("click", () => setTxType("transfer"));

  // Moeda da transação
  els.txAccount.addEventListener("change", syncCurrencyWithAccount);
  els.btnCurrencyBrl.addEventListener("click", () => selectCurrency("BRL"));
  els.btnCurrencyPyg.addEventListener("click", () => selectCurrency("PYG"));
  els.txAmount.addEventListener("input", calculateExchange);

  // Modal
  els.transactionForm.addEventListener("submit", saveTransaction);

  // Filtros de transações
  [els.filterMonth, els.filterType, els.filterCurrency, els.filterCategory, els.filterAccount]
    .forEach((element) => element.addEventListener("change", renderTransactions));
  els.searchInput.addEventListener("input", renderTransactions);

  // Filtros rápidos do dashboard
  $$(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".filter-btn").forEach((b) => {
        b.classList.remove("bg-primary", "text-on-primary", "shadow-sm", "font-semibold");
        b.classList.add("text-on-surface-variant");
      });
      btn.classList.add("bg-primary", "text-on-primary", "shadow-sm", "font-semibold");
      btn.classList.remove("text-on-surface-variant");
      renderRecentTransactions();
    });
  });

  // Importação rápida
  els.smartInput.addEventListener("input", renderSmartSuggestions);
  els.smartDefaultCurrency.addEventListener("change", renderSmartSuggestions);
  $("#importSmartBtn").addEventListener("click", importSmartSuggestions);

  // Backup / dados / configurações
  $("#exportJsonBtn").addEventListener("click", exportJSON);
  $("#importJsonInput").addEventListener("change", importJSON);
  $("#exportCsvBtn").addEventListener("click", exportCSV);
  $("#importCsvInput").addEventListener("change", importCSV);
  $("#clearDatabaseBtn").addEventListener("click", clearDatabase);
  $("#saveSettingsBtn").addEventListener("click", saveSettings);
  $("#fetchRateBtn").addEventListener("click", fetchRate);
  $("#addCategoryBtn").addEventListener("click", addCategory);

  // Toggle saldo
  els.toggleBalanceBtn.addEventListener("click", toggleBalance);

  // Recorrência
  els.toggleRecurringBtn.addEventListener("click", () => toggleRecurring());

  // Fecha modal ao clicar no overlay
  els.txOverlay.addEventListener("click", () => closeTransactionDialog());
}

/* ==========================================================================
   Tema
   ========================================================================== */
function setupTheme() {
  const root = document.documentElement;
  const button = $("#themeToggleBtn");
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (!button) return;

  let savedTheme = "dark";
  try {
    savedTheme = localStorage.getItem("pf-theme") || "dark";
  } catch { /* storage pode estar indisponível */ }

  const applyTheme = (theme) => {
    const isLight = theme === "light";
    root.dataset.theme = isLight ? "light" : "dark";
    root.classList.toggle("dark", !isLight);
    if (metaTheme) metaTheme.setAttribute("content", isLight ? "#f5f8fb" : "#0b1326");
    button.textContent = isLight ? "🌙" : "☀️";
    button.setAttribute("aria-label", isLight ? "Ativar tema escuro" : "Ativar tema claro");
    button.setAttribute("aria-pressed", String(isLight));
  };

  applyTheme(savedTheme);
  button.addEventListener("click", () => {
    const nextTheme = root.dataset.theme === "light" ? "dark" : "light";
    applyTheme(nextTheme);
    renderAll();
    try { localStorage.setItem("pf-theme", nextTheme); } catch { /* ok */ }
  });
}

/* ==========================================================================
   Semente de defaults e recarga de dados
   ========================================================================== */
async function seedDefaults() {
  if (!(await getAll("categories")).length) {
    await bulkPut("categories", DEFAULT_CATEGORIES.map((name) => ({
      name, createdAt: new Date().toISOString()
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
  renderAccountChips();
  renderCategoryGrid();
}

/* ==========================================================================
   Selets de categoria e conta (compatível com app original)
   ========================================================================== */
function fillCategorySelects() {
  const currentTx = els.txCategory.value;
  const currentFilter = els.filterCategory.value;
  els.txCategory.replaceChildren();
  els.filterCategory.replaceChildren(new Option("Todas as categorias", ""));
  state.categories.forEach((category) => {
    els.txCategory.appendChild(new Option(category.name, category.name));
    els.filterCategory.appendChild(new Option(category.name, category.name));
  });
  if (state.categories.some((c) => c.name === currentTx)) els.txCategory.value = currentTx;
  if (state.categories.some((c) => c.name === currentFilter)) els.filterCategory.value = currentFilter;
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
  if (state.accounts.some((a) => a.id === currentTx && !a.archived)) els.txAccount.value = currentTx;
  if (state.accounts.some((a) => a.id === currentFilter)) els.filterAccount.value = currentFilter;
}

/* ==========================================================================
   Componentes do novo design (carrossel de contas, grid de categorias, chips)
   ========================================================================== */
function renderAccountChips() {
  const container = els.accountChips;
  container.replaceChildren();
  const nonArchived = state.accounts.filter((a) => !a.archived);
  nonArchived.forEach((account) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 rounded-xl " +
      (account.id === state.selectedAccountId
        ? "bg-surface-container-highest text-on-surface shadow-sm"
        : "bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors");
    chip.innerHTML = `
      <div class="w-7 h-7 rounded-lg bg-surface-container-high flex items-center justify-center">
        <span class="material-symbols-outlined text-[16px]">account_balance_wallet</span>
      </div>
      <div class="flex flex-col text-left min-w-0">
        <span class="text-label-md leading-none truncate block">${escapeHtml(account.name)}</span>
        <span class="text-currency-tabular text-body-sm text-outline-variant font-mono leading-tight">
          ${formatMoney(account.openingBalance, account.currency)}
        </span>
      </div>
      <span class="material-symbols-outlined text-[16px] text-primary ml-1">check_circle</span>
    `;
    chip.addEventListener("click", () => {
      state.selectedAccountId = account.id;
      els.txAccount.value = account.id;
      state.txCurrency = account.currency;
      selectCurrency(account.currency);
      renderAccountChips();
    });
    container.appendChild(chip);
  });
}

function renderCategoryGrid() {
  const container = els.categoryGrid;
  container.replaceChildren();
  state.categories.forEach((category) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-card p-3 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface flex flex-col items-center justify-center gap-1.5 transition-all transform active:scale-95 text-center";
    btn.innerHTML = `
      <div class="w-9 h-9 rounded-full bg-surface-container-highest flex items-center justify-center">
        <span class="material-symbols-outlined text-[20px]">category</span>
      </div>
      <span class="text-label-sm font-semibold truncate w-full">${escapeHtml(category.name)}</span>
    `;
    btn.addEventListener("click", () => {
      els.txCategory.value = category.name;
      $$(".category-card").forEach((b) => {
        b.className = "category-card p-3 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface flex flex-col items-center justify-center gap-1.5 transition-all transform active:scale-95 text-center";
      });
      btn.className = "category-card p-3 rounded-xl bg-tertiary-container text-on-tertiary-container flex flex-col items-center justify-center gap-1.5 shadow-sm transition-all transform active:scale-95 text-center";
    });
    container.appendChild(btn);
  });
  els.categoryCount.textContent = `${state.categories.length} disponíveis`;
}

/* ==========================================================================
   Navegação de views
   ========================================================================== */
function switchView(view) {
  $$(".view").forEach((section) => section.classList.remove("active"));
  $$(".bottom-nav-item").forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle("active", active);
    item.style.color = active ? "var(--ds-primary)" : "var(--ds-on-surface-variant)";
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
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
  if (view === "dashboard") renderDashboard();
}

/* ==========================================================================
   Modal de transação (novo design do ZIP)
   ========================================================================== */
function setTxType(type) {
  state.txType = type;
  updateTransactionTypeButtons();
  updateCurrencySymbolColor();
}

function updateTransactionTypeButtons() {
  const defaultClass = "flex-1 py-2.5 px-3 rounded-lg font-label-md text-label-md transition-all duration-200 flex items-center justify-center gap-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high";
  els.typeExpense.className = defaultClass;
  els.typeIncome.className = defaultClass;
  els.typeTransfer.className = defaultClass;

  if (state.txType === "expense") {
    els.typeExpense.className = "flex-1 py-2.5 px-3 rounded-lg font-label-md text-label-md transition-all duration-200 flex items-center justify-center gap-1.5 bg-error text-on-error shadow-sm";
  } else if (state.txType === "income") {
    els.typeIncome.className = "flex-1 py-2.5 px-3 rounded-lg font-label-md text-label-md transition-all duration-200 flex items-center justify-center gap-1.5 bg-secondary text-on-secondary shadow-sm";
  } else {
    els.typeTransfer.className = "flex-1 py-2.5 px-3 rounded-lg font-label-md text-label-md transition-all duration-200 flex items-center justify-center gap-1.5 bg-primary-container text-on-primary-container shadow-sm";
  }
}

function updateCurrencySymbolColor() {
  if (state.txType === "expense") {
    els.currencySymbol.className = "text-currency-display text-error font-mono";
  } else if (state.txType === "income") {
    els.currencySymbol.className = "text-currency-display text-secondary font-mono";
  } else {
    els.currencySymbol.className = "text-currency-display text-primary font-mono";
  }
}

function selectCurrency(curr) {
  state.txCurrency = curr;
  els.txCurrency.value = curr;
  const symbol = els.currencySymbol;
  if (curr === "BRL") {
    els.btnCurrencyBrl.className = "flex items-center gap-1 px-2.5 py-1 rounded-full font-label-sm text-label-sm transition-all duration-150 bg-secondary-container text-on-secondary-container shadow-sm";
    els.btnCurrencyPyg.className = "flex items-center gap-1 px-2.5 py-1 rounded-full font-label-sm text-label-sm transition-all duration-150 text-on-surface-variant hover:text-on-surface";
    symbol.innerText = "R$";
  } else {
    els.btnCurrencyPyg.className = "flex items-center gap-1 px-2.5 py-1 rounded-full font-label-sm text-label-sm transition-all duration-150 bg-error-container text-on-error-container shadow-sm";
    els.btnCurrencyBrl.className = "flex items-center gap-1 px-2.5 py-1 rounded-full font-label-sm text-label-sm transition-all duration-150 text-on-surface-variant hover:text-on-surface";
    symbol.innerText = "₲";
  }
  calculateExchange();
}

function calculateExchange() {
  const rate = state.settings.brlToPyg;
  const input = els.txAmount;
  const preview = els.previewText;
  let valStr = input.value.replace(".", "").replace(",", ".").trim();
  let num = parseFloat(valStr) || 0;

  if (state.txCurrency === "BRL") {
    const pygVal = Math.round(num * rate);
    preview.innerText = `≈ ₲ ${pygVal.toLocaleString("es-PY")} na cotação ${rate.toLocaleString("pt-BR")}`;
  } else {
    const brlVal = (num / rate).toFixed(2);
    preview.innerText = `≈ R$ ${parseFloat(brlVal).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} na cotação ${rate.toLocaleString("pt-BR")}`;
  }
}

function toggleRecurring() {
  state.isRecurring = !state.isRecurring;
  const btn = els.toggleRecurringBtn;
  const dot = btn.querySelector(".toggle-dot");
  if (state.isRecurring) {
    btn.classList.remove("bg-surface-container-lowest");
    btn.classList.add("bg-primary");
    dot.classList.add("translate-x-6", "bg-on-primary");
    dot.classList.remove("bg-outline-variant");
  } else {
    btn.classList.remove("bg-primary");
    btn.classList.add("bg-surface-container-lowest");
    dot.classList.remove("translate-x-6", "bg-on-primary");
    dot.classList.add("bg-outline-variant");
  }
  els.recurringInput.value = String(state.isRecurring);
}

function openTransactionDialog(transaction = null) {
  if (transaction?.type === "transfer") {
    toast("Edite transferências pela área Contas & Planejamento.");
    return;
  }

  state.txType = transaction?.type || "expense";
  state.txCurrency = transaction?.currency || "BRL";
  state.isRecurring = false;

  els.transactionId.value = transaction?.id || "";
  els.txAccount.value = transaction?.accountId || "";
  state.selectedAccountId = els.txAccount.value || defaultAccountId(state.txCurrency);
  els.txCurrency.value = state.txCurrency;

  // Formata valor
  if (transaction) {
    els.txAmount.value = state.txCurrency === "PYG"
      ? Math.round(transaction.amount).toLocaleString("pt-BR")
      : Number(transaction.amount).toFixed(2).replace(".", ",");
  } else {
    els.txAmount.value = "";
  }

  els.txCategory.value = transaction?.category || state.categories[0]?.name || "Outros";
  els.txDate.value = transaction?.date || todayISO();
  els.txStatus.value = transaction?.status || "cleared";
  els.txDescription.value = transaction?.description || "";
  els.txTags.value = (transaction?.tags || []).join(", ");
  els.recurringInput.value = "false";

  $("#transactionDialogTitle").textContent = transaction ? "Editar transação" : "Novo lançamento";

  updateTransactionTypeButtons();
  updateCurrencySymbolColor();
  selectCurrency(state.txCurrency);
  renderAccountChips();
  renderCategoryGrid();
  toggleRecurring();
  calculateExchange();

  els.transactionDialog.showModal();
  els.txOverlay.classList.add("open");
}

function closeTransactionDialog() {
  els.transactionDialog.close();
  els.txOverlay.classList.remove("open");
}

function defaultAccountId(currency) {
  return state.accounts.find((a) => !a.archived && a.currency === currency)?.id || "";
}

function selectedAccount() {
  return state.accounts.find((a) => a.id === els.txAccount.value) ||
    state.accounts.find((a) => a.id === state.selectedAccountId) ||
    null;
}

function syncCurrencyWithAccount() {
  const account = selectedAccount();
  if (account) {
    state.txCurrency = account.currency;
    selectCurrency(account.currency);
  }
}

/* ==========================================================================
   Salvar transação (mantida da versão original)
   ========================================================================== */
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

  closeTransactionDialog();
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
    if (!confirm(`Excluir “${transaction.description}"?`)) return;
    await remove("transactions", id);
  }

  await reloadData();
  renderAll();
  toast("Movimentação excluída.");
}

/* ==========================================================================
   Renderização do dashboard (novo design do ZIP)
   ========================================================================== */
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
  const flow = base === "PYG" ? analysis.balancePYG : analysis.balanceBRL;

  // Métricas originais (apenas se existirem no DOM)
  if (els.pygIncome) els.pygIncome.textContent = `+ ${formatMoney(pyg.income, "PYG")}`;
  if (els.pygExpense) els.pygExpense.textContent = `- ${formatMoney(pyg.expense, "PYG")}`;
  if (els.pygBalance) els.pygBalance.textContent = formatMoney(pyg.income - pyg.expense, "PYG");
  if (els.brlIncome) els.brlIncome.textContent = `+ ${formatMoney(brl.income, "BRL")}`;
  if (els.brlExpense) els.brlExpense.textContent = `- ${formatMoney(brl.expense, "BRL")}`;
  if (els.brlBalance) els.brlBalance.textContent = formatMoney(brl.income - brl.expense, "BRL");
  if (els.consolidatedBalance) els.consolidatedBalance.textContent = formatMoney(flow, base);
  if (els.netWorthBalance) els.netWorthBalance.textContent = formatMoney(netWorth(state.accounts, state.transactions, { baseCurrency: base, rate }), base);
  if (els.availableBalance) els.availableBalance.textContent = formatMoney(availableFunds(state.accounts, state.transactions, { baseCurrency: base, rate }), base);

  const daily = base === "PYG" ? analysis.projection.dailyAverage : analysis.projection.dailyAverage / rate;
  const projection = base === "PYG" ? analysis.projection.projectedExpense : analysis.projection.projectedExpense / rate;
  if (els.dailyAverage) els.dailyAverage.textContent = formatMoney(daily, base);
  if (els.projectionText) els.projectionText.textContent = `Projeção: ${formatMoney(projection, base)} no mês`;
  if (els.rateStatus) els.rateStatus.textContent = analysis.approximate
    ? `Fluxo mensal · conversões podem usar 1 BRL ≈ ${Math.round(rate)} PYG`
    : "Receitas menos despesas do mês";

  // Novo design: patrimônio principal com toggle
  if (els.mainBalanceVal) els.mainBalanceVal.textContent = state.isBalanceHidden ? "••••••••" : formatMoney(flow, base);
  if (els.subBalanceVal) els.subBalanceVal.textContent = state.isBalanceHidden ? "≈ ₲ ••••••••" : `≈ ₲ ${Math.round(flow * rate).toLocaleString("es-PY")}`;
  if (els.toggleBalanceIcon) els.toggleBalanceIcon.textContent = state.isBalanceHidden ? "visibility_off" : "visibility";
  if (els.mainCurrencyChip) els.mainCurrencyChip.textContent = base;

  // Variação mensal
  const net = analysis.balancePYG - (analysis.previous?.expensePYG || 0) - (analysis.previous?.incomePYG || 0);
  if (els.monthlyVariation) els.monthlyVariation.textContent = `${net >= 0 ? "+" : ""}${net.toLocaleString("pt-BR")} PYG este mês`;

  // Período
  const now = new Date();
  if (els.periodTitle) els.periodTitle.textContent = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(now);

  // Resumo entradas/saídas
  if (els.monthIncome) els.monthIncome.textContent = formatMoney(analysis.incomePYG, "PYG");
  if (els.monthExpense) els.monthExpense.textContent = formatMoney(analysis.expensePYG, "PYG");
  if (els.monthIncomeCount) els.monthIncomeCount.textContent = `${analysis.incomeCount || 0} depósitos`;
  if (els.monthExpenseCount) els.monthExpenseCount.textContent = `${analysis.expenseCount || 0} lançamentos`;
  if (els.monthlyNet) els.monthlyNet.textContent = formatMoney(flow, base);

  // Carrossel de contas
  renderAccountsCarousel();

  // Simulador de câmbio
  if (els.baseRateVal) els.baseRateVal.textContent = `₲ ${rate.toLocaleString("pt-BR")},00`;
  if (els.rateHint) els.rateHint.textContent = `(Taxa ₲ ${rate.toLocaleString("pt-BR")} / R$ 1)`;
  if (!state.isBalanceHidden && els.simInput) els.simInput.textContent = `R$ 100`;
  if (!state.isBalanceHidden && els.simOutput) els.simOutput.textContent = `₲ ${Math.round(100 * rate).toLocaleString("es-PY")}`;

  renderRecentTransactions();
  const cashflowCanvas = $("#cashflowChart");
  const categoryCanvas = $("#categoryChart");
  if (cashflowCanvas) renderCashflowChart(cashflowCanvas, buildMonthlyCashflow(6));
  if (categoryCanvas) renderCategoryChart(categoryCanvas, analysis.categories.map((item) => ({ label: item.category, value: item.valuePYG })));
}

function renderAccountsCarousel() {
  const container = els.accountsCarousel;
  container.replaceChildren();
  const nonArchived = state.accounts.filter((a) => !a.archived);
  if (els.accountsCount) els.accountsCount.textContent = `Ver todas (${nonArchived.length})`;

  nonArchived.forEach((account) => {
    const card = document.createElement("div");
    card.className = "snap-start shrink-0 w-64 rounded-xl bg-surface-container p-sm shadow-md flex flex-col justify-between";
    const flag = account.currency === "BRL" ? "🇧🇷" : "🇵🇾";
    const colorClass = account.currency === "BRL" ? "text-primary" : "text-tertiary";
    const balance = accountSummary(account, state.transactions);
    const balanceBRL = formatMoney(balance, account.currency);
    const balanceConverted = account.currency === "BRL"
      ? `≈ ₲ ${Math.round(balance * rate).toLocaleString("es-PY")}`
      : `≈ R$ ${(balance / rate).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center ${colorClass} font-bold">${flag}</div>
          <div>
            <span class="text-label-md text-on-surface block leading-tight">${escapeHtml(account.name)}</span>
            <span class="text-label-sm text-secondary">${account.currency === "BRL" ? "Ativo Físico" : "Efetivo Guaraní"}</span>
          </div>
        </div>
        <span class="material-symbols-outlined text-[18px] text-on-surface-variant">payments</span>
      </div>
      <div class="mt-3">
        <span class="text-currency-tabular text-headline-sm ${colorClass} font-bold block">${balanceBRL}</span>
        <span class="text-body-sm text-on-surface-variant font-currency-tabular">${balanceConverted}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function toggleBalance() {
  state.isBalanceHidden = !state.isBalanceHidden;
  renderDashboard();
}

/* ==========================================================================
   Transações recentes (com filtro rápido do dashboard)
   ========================================================================== */
function createTransactionRow(transaction) {
  const row = document.createElement("article");
  row.className = "tx-item flex items-center justify-between p-sm rounded-xl bg-surface-container hover:bg-surface-container-high transition-colors";
  row.dataset.currency = transaction.currency;

  const main = document.createElement("div");
  main.className = "flex items-center gap-3 min-w-0";

  const iconMap = { income: "payments", expense: "shopping_cart", transfer: "swap_horiz" };
  const iconColor = transaction.type === "income" ? "text-secondary" : transaction.type === "expense" ? "text-primary" : "text-primary";
  const iconBg = transaction.type === "income" ? "bg-secondary-container/20" : "bg-surface-container-high";

  main.innerHTML = `
    <div class="w-10 h-10 rounded-full ${iconBg} flex items-center justify-center text-${iconColor === 'text-secondary' ? 'secondary' : 'primary'} shrink-0">
      <span class="material-symbols-outlined text-[20px]">${iconMap[transaction.type]}</span>
    </div>
    <div class="flex flex-col min-w-0">
      <span class="text-label-md text-on-surface truncate">${escapeHtml(transaction.description)}</span>
      <div class="flex items-center gap-1.5 text-on-surface-variant">
        <span class="text-body-sm">${formatDate(transaction.date)}</span>
        <span>•</span>
        <span class="text-body-sm">${escapeHtml(transaction.category)}</span>
        <span>•</span>
        <span class="text-label-sm ${transaction.currency === 'BRL' ? 'text-secondary' : 'text-tertiary'}">${escapeHtml(transaction.accountId || '')}</span>
      </div>
    </div>
  `;

  const side = document.createElement("div");
  side.className = "text-right shrink-0";
  const sign = transaction.type === "income" ? "+" : "-";
  const color = transaction.type === "income" ? "text-secondary font-bold" : "text-on-surface font-semibold";
  side.innerHTML = `
    <span class="text-currency-tabular text-body-lg ${color} block">${sign}${formatMoney(transaction.amount, transaction.currency)}</span>
    ${transaction.type === "income" ? '<span class="text-currency-tabular text-body-sm text-secondary/70">Recebido</span>' : `<span class="text-currency-tabular text-body-sm text-on-surface-variant">₲ ${Math.round(transaction.amount * state.settings.brlToPyg).toLocaleString("es-PY")}</span>`}
  `;

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "text-label-sm text-primary hover:underline";
  edit.textContent = "Editar";
  edit.addEventListener("click", () => editTransaction(transaction.id));

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "text-label-sm text-error hover:underline";
  removeButton.textContent = "Excluir";
  removeButton.addEventListener("click", () => deleteTransaction(transaction.id));

  const actions = document.createElement("div");
  actions.className = "flex items-center gap-2";
  actions.append(edit, removeButton);
  side.appendChild(actions);

  row.append(main, side);
  return row;
}

function renderRecentTransactions() {
  const container = els.recentTransactions;
  container.replaceChildren();
  const recent = [...state.transactions]
    .sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date))
    .slice(0, 5);

  const activeFilter = $$(".filter-btn.bg-primary").length
    ? $$(".filter-btn.bg-primary")[0].getAttribute("data-filter")
    : "all";

  const filtered = recent.filter((tx) => activeFilter === "all" || tx.currency === activeFilter);

  if (!filtered.length) {
    container.appendChild(emptyNode("Nenhuma transação encontrada."));
    return;
  }
  filtered.forEach((transaction) => container.appendChild(createTransactionRow(transaction)));
}

/* ==========================================================================
   Lista de transações (compatível com app original)
   ========================================================================== */
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

  if (els.transactionCount) els.transactionCount.textContent = `${filtered.length} transaç${filtered.length === 1 ? "ão" : "ões"}`;
  const container = $("#transactionsList");
  container.replaceChildren();
  if (!filtered.length) container.appendChild(emptyNode("Nenhuma transação encontrada."));
  else filtered.forEach((transaction) => container.appendChild(createTransactionRowFull(transaction)));
}

function createTransactionRowFull(transaction) {
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

/* ==========================================================================
   Cashflow / analytics (compatível com app original)
   ========================================================================== */
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
  if (els.topCategory) els.topCategory.textContent = analysis.categories[0]?.category || "—";
  const largest = analysis.largestTransactions[0];
  if (els.largestExpense) els.largestExpense.textContent = largest ? formatMoney(largest.amount, largest.currency) : "—";
  if (els.savingsRate) els.savingsRate.textContent = analysis.savingsRate === null ? "—" : `${analysis.savingsRate.toFixed(1)}%`;
  if (els.monthProjection) els.monthProjection.textContent = formatMoney(analysis.projection.projectedExpense, "PYG");

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

/* ==========================================================================
   Importação rápida / sugestões (compatível com app original)
   ========================================================================== */
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

/* ==========================================================================
   Configurações (compatível com app original)
   ========================================================================== */
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

/* ==========================================================================
   Categorias (compatível com app original)
   ========================================================================== */
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
  if (!confirm(`Excluir a categoria “${name}"?`)) return;
  await remove("categories", name);
  await reloadData();
  renderAll();
  toast("Categoria excluída.");
}

/* ==========================================================================
   Backup / export / import (compatível com app original)
   ========================================================================== */
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

/* ==========================================================================
   Utilidades de UI e banco
   ========================================================================== */
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
    if (els.dbStatus) {
      const base = navigator.onLine ? "Online" : "Offline";
      els.dbStatus.textContent = `IndexedDB v6 • ${base} e Seguro`;
    }
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}
