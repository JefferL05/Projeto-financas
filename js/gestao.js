import { getAll, put } from "./db.js";
import { formatMoney, parseLooseNumber, todayISO, downloadFile } from "./utils.js";
import { ACCOUNT_TYPES, archiveAccount, createAccount, listAccounts } from "./accounts/account-service.js";
import { accountSummary, availableFunds, netWorth } from "./accounts/account-balance.js";
import { createTransfer } from "./accounts/transfers.js";
import { reconciliationDifference, reconcileAccount } from "./accounts/reconciliation.js";
import { buildICS, createSchedule, listUpcomingSchedules, markSchedulePaid, postponeSchedule, skipOccurrence } from "./transactions/schedules.js";
import { buildReport, safeToSpend } from "./reports/report-engine.js";
import { resolvePeriod } from "./finance/period-utils.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  accounts: [],
  transactions: [],
  schedules: [],
  categories: [],
  goals: [],
  budgets: [],
  rates: [],
  settings: { brlToPyg: 1300, baseCurrency: "PYG" },
  pendingTransfer: null
};

let toastTimer;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindTabs();
  bindForms();
  setDefaults();
  await reload();
  renderAll();
}

function bindTabs() {
  $$("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      $$("[data-tab]").forEach((item) => {
        const active = item.dataset.tab === tab;
        item.classList.toggle("active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      });
      $$(".intel-view").forEach((view) => view.classList.toggle("active", view.id === `tab-${tab}`));
    });
  });
}

function bindForms() {
  $("#accountForm").addEventListener("submit", handleAccountSubmit);
  $("#transferForm").addEventListener("submit", handleTransferPreview);
  $("#reconcileAccount").addEventListener("change", renderReconciliation);
  $("#statementBalance").addEventListener("input", renderReconciliationDifference);
  $("#finishReconciliationBtn").addEventListener("click", finishReconciliation);
  $("#scheduleForm").addEventListener("submit", handleScheduleSubmit);
  $("#exportIcsBtn").addEventListener("click", exportICS);
}

function setDefaults() {
  $("#transferDate").value = todayISO();
  $("#scheduleDueDate").value = todayISO();
  const typeSelect = $("#accountType");
  ACCOUNT_TYPES.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    typeSelect.appendChild(option);
  });
}

async function reload() {
  const [accounts, transactions, schedules, categories, goals, budgets, rates, settings] = await Promise.all([
    listAccounts({ includeArchived: true }),
    getAll("transactions"),
    getAll("schedules"),
    getAll("categories"),
    getAll("goals"),
    getAll("budgets"),
    getAll("exchangeRates"),
    getAll("settings")
  ]);

  state.accounts = accounts;
  state.transactions = transactions;
  state.schedules = schedules;
  state.categories = categories;
  state.goals = goals;
  state.budgets = budgets;
  state.rates = rates;
  const map = Object.fromEntries(settings.map((item) => [item.key, item.value]));
  state.settings.brlToPyg = Number(map.brlToPyg) || 1300;
  state.settings.baseCurrency = map.baseCurrency || "PYG";

  fillAccountSelects();
  fillCategorySelect();
}

function fillAccountSelects() {
  const active = state.accounts.filter((account) => !account.archived);
  ["transferSource", "transferDestination", "reconcileAccount", "scheduleAccount"].forEach((id) => {
    const select = $(`#${id}`);
    const previous = select.value;
    select.replaceChildren();
    active.forEach((account) => {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = `${account.name} · ${account.currency}`;
      select.appendChild(option);
    });
    if (active.some((account) => account.id === previous)) select.value = previous;
  });
}

function fillCategorySelect() {
  const select = $("#scheduleCategory");
  select.replaceChildren();
  state.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.name;
    option.textContent = category.name;
    select.appendChild(option);
  });
}

async function handleAccountSubmit(event) {
  event.preventDefault();
  try {
    await createAccount({
      name: $("#accountName").value,
      type: $("#accountType").value,
      currency: $("#accountCurrency").value,
      openingBalance: parseLooseNumber($("#accountOpening").value),
      onBudget: $("#accountOnBudget").checked,
      includeInNetWorth: $("#accountNetWorth").checked
    });
    event.target.reset();
    $("#accountOnBudget").checked = true;
    $("#accountNetWorth").checked = true;
    await reload();
    renderAll();
    toast("Conta criada.");
  } catch (error) {
    toast(error.message || "Não foi possível criar a conta.");
  }
}

function renderAccounts() {
  const activeAccounts = state.accounts.filter((account) => !account.archived);
  const baseCurrency = state.settings.baseCurrency;
  const rate = state.settings.brlToPyg;

  $("#netWorthValue").textContent = formatMoney(netWorth(activeAccounts, state.transactions, { baseCurrency, rate }), baseCurrency);
  $("#availableValue").textContent = formatMoney(availableFunds(activeAccounts, state.transactions, { baseCurrency, rate }), baseCurrency);
  $("#activeAccountsCount").textContent = String(activeAccounts.length);

  const list = $("#accountsList");
  list.replaceChildren();

  if (!state.accounts.length) {
    list.appendChild(emptyNode("Nenhuma conta cadastrada."));
    return;
  }

  state.accounts.forEach((account) => {
    const summary = accountSummary(account, state.transactions, { baseCurrency, rate });
    const row = document.createElement("div");
    row.className = "transaction-row";

    const main = document.createElement("div");
    main.className = "transaction-main";
    const name = document.createElement("strong");
    name.textContent = account.name;
    const meta = document.createElement("div");
    meta.className = "transaction-meta";
    meta.textContent = `${account.currency} · ${account.type}${account.archived ? " · arquivada" : ""}`;
    main.append(name, meta);

    const side = document.createElement("div");
    side.className = "transaction-side";
    const balance = document.createElement("strong");
    balance.className = "transaction-value";
    balance.textContent = formatMoney(summary.balance, account.currency);
    const cleared = document.createElement("small");
    cleared.textContent = `Conferido: ${formatMoney(summary.clearedBalance, account.currency)}`;

    const actions = document.createElement("div");
    actions.className = "transaction-actions";
    const archive = document.createElement("button");
    archive.type = "button";
    archive.textContent = account.archived ? "Reabrir" : "Arquivar";
    archive.addEventListener("click", async () => {
      await archiveAccount(account, !account.archived);
      await reload();
      renderAll();
    });
    actions.appendChild(archive);
    side.append(balance, cleared, actions);
    row.append(main, side);
    list.appendChild(row);
  });
}

function handleTransferPreview(event) {
  event.preventDefault();
  const source = state.accounts.find((account) => account.id === $("#transferSource").value);
  const destination = state.accounts.find((account) => account.id === $("#transferDestination").value);
  if (!source || !destination || source.id === destination.id) {
    toast("Escolha duas contas diferentes.");
    return;
  }

  const sourceAmount = parseLooseNumber($("#transferSourceAmount").value);
  const destinationAmount = parseLooseNumber($("#transferDestinationAmount").value);
  const exchangeRate = parseLooseNumber($("#transferRate").value) || null;
  if (!sourceAmount || !destinationAmount) {
    toast("Informe os dois valores.");
    return;
  }

  state.pendingTransfer = {
    sourceAccount: source,
    destinationAccount: destination,
    sourceAmount,
    destinationAmount,
    exchangeRate,
    date: $("#transferDate").value,
    description: $("#transferDescription").value.trim() || "Transferência entre contas"
  };

  renderTransferPreview();
}

function renderTransferPreview() {
  const box = $("#transferPreview");
  box.replaceChildren();
  box.classList.remove("hidden");
  const transfer = state.pendingTransfer;
  if (!transfer) return;

  const title = document.createElement("strong");
  title.textContent = "Confirme a transferência";
  const description = document.createElement("p");
  description.textContent = `${transfer.sourceAccount.name}: ${formatMoney(transfer.sourceAmount, transfer.sourceAccount.currency)} → ${transfer.destinationAccount.name}: ${formatMoney(transfer.destinationAmount, transfer.destinationAccount.currency)}.`;
  box.append(title, description);

  if (transfer.sourceAccount.currency !== transfer.destinationAccount.currency) {
    const rate = document.createElement("p");
    rate.className = "muted";
    rate.textContent = `Cotação informada: ${transfer.exchangeRate || "não informada"}.`;
    box.appendChild(rate);
  }

  const actions = document.createElement("div");
  actions.className = "button-stack";
  const confirmButton = document.createElement("button");
  confirmButton.className = "btn btn-primary";
  confirmButton.type = "button";
  confirmButton.textContent = "Confirmar transferência";
  confirmButton.addEventListener("click", confirmTransfer);
  const cancelButton = document.createElement("button");
  cancelButton.className = "btn btn-secondary";
  cancelButton.type = "button";
  cancelButton.textContent = "Cancelar";
  cancelButton.addEventListener("click", () => {
    state.pendingTransfer = null;
    box.classList.add("hidden");
    box.replaceChildren();
  });
  actions.append(confirmButton, cancelButton);
  box.appendChild(actions);
}

async function confirmTransfer() {
  if (!state.pendingTransfer) return;
  try {
    await createTransfer(state.pendingTransfer);
    state.pendingTransfer = null;
    $("#transferPreview").classList.add("hidden");
    $("#transferPreview").replaceChildren();
    $("#transferForm").reset();
    $("#transferDate").value = todayISO();
    await reload();
    renderAll();
    toast("Transferência registrada atomicamente.");
  } catch (error) {
    toast(error.message || "Transferência não realizada.");
  }
}

function renderReconciliation() {
  const account = state.accounts.find((item) => item.id === $("#reconcileAccount").value);
  const container = $("#reconcileTransactions");
  container.replaceChildren();
  if (!account) return;

  const transactions = state.transactions
    .filter((item) => item.accountId === account.id && item.status !== "reconciled")
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!transactions.length) container.appendChild(emptyNode("Nenhuma transação pendente de conciliação."));

  transactions.forEach((transaction) => {
    const label = document.createElement("label");
    label.className = "reconcile-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.transactionId = transaction.id;
    checkbox.addEventListener("change", renderReconciliationDifference);
    const text = document.createElement("span");
    text.textContent = `${transaction.date} · ${transaction.description} · ${formatMoney(transaction.amount, transaction.currency)}`;
    label.append(checkbox, text);
    container.appendChild(label);
  });

  renderReconciliationDifference();
}

function selectedReconciliationIds() {
  return $$("#reconcileTransactions input[type=checkbox]:checked").map((item) => item.dataset.transactionId).filter(Boolean);
}

function renderReconciliationDifference() {
  const account = state.accounts.find((item) => item.id === $("#reconcileAccount").value);
  if (!account) return;
  const selected = new Set(selectedReconciliationIds());
  const staged = state.transactions.map((transaction) => selected.has(transaction.id) ? { ...transaction, status: "reconciled" } : transaction);
  const summary = accountSummary(account, staged, { baseCurrency: account.currency, rate: state.settings.brlToPyg });
  $("#clearedBalance").textContent = formatMoney(summary.clearedBalance, account.currency);
  const statement = parseLooseNumber($("#statementBalance").value);
  const difference = Number.isFinite(statement) ? reconciliationDifference(account, staged, statement) : 0;
  $("#reconciliationDifference").textContent = formatMoney(difference, account.currency);
}

async function finishReconciliation() {
  const account = state.accounts.find((item) => item.id === $("#reconcileAccount").value);
  if (!account) return;
  const statementBalance = parseLooseNumber($("#statementBalance").value);
  if (!Number.isFinite(statementBalance)) {
    toast("Informe o saldo da conta.");
    return;
  }

  const result = await reconcileAccount({
    account,
    statementBalance,
    transactionIds: selectedReconciliationIds(),
    date: todayISO(),
    createAdjustment: $("#createReconciliationAdjustment").checked
  });

  if (!result.ok) {
    toast(`Diferença de ${formatMoney(result.difference, account.currency)}. Revise ou autorize um ajuste.`);
    return;
  }

  await reload();
  renderAll();
  toast("Conciliação concluída.");
}

async function handleScheduleSubmit(event) {
  event.preventDefault();
  const account = state.accounts.find((item) => item.id === $("#scheduleAccount").value);
  if (!account) return;
  try {
    await createSchedule({
      name: $("#scheduleName").value,
      kind: $("#scheduleKind").value,
      amount: parseLooseNumber($("#scheduleAmount").value),
      currency: account.currency,
      accountId: account.id,
      category: $("#scheduleCategory").value || "Outros",
      frequency: $("#scheduleFrequency").value,
      nextDueDate: $("#scheduleDueDate").value,
      reminderDays: Number($("#scheduleReminder").value || 0),
      autoPost: false,
      active: true
    });
    event.target.reset();
    $("#scheduleDueDate").value = todayISO();
    await reload();
    renderAll();
    toast("Compromisso adicionado.");
  } catch (error) {
    toast(error.message || "Não foi possível criar o compromisso.");
  }
}

async function renderSchedules() {
  const groups = await listUpcomingSchedules({ days: 30 });
  const container = $("#scheduleGroups");
  container.replaceChildren();
  const definitions = [
    ["Atrasados", groups.overdue],
    ["Hoje", groups.today],
    ["Próximos 7 dias", groups.next7Days],
    ["Próximos 30 dias", groups.next30Days]
  ];

  definitions.forEach(([title, items]) => {
    const section = document.createElement("section");
    section.className = "schedule-group";
    const heading = document.createElement("h3");
    heading.textContent = `${title} (${items.length})`;
    section.appendChild(heading);
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Nenhum compromisso.";
      section.appendChild(empty);
    }

    items.forEach(({ schedule, dueDate }) => {
      const row = document.createElement("div");
      row.className = "transaction-row";
      const main = document.createElement("div");
      main.className = "transaction-main";
      const name = document.createElement("strong");
      name.textContent = schedule.name;
      const meta = document.createElement("div");
      meta.className = "transaction-meta";
      meta.textContent = `${dueDate} · ${formatMoney(schedule.amount, schedule.currency)} · ${schedule.category}`;
      main.append(name, meta);

      const actions = document.createElement("div");
      actions.className = "transaction-actions";
      const paid = document.createElement("button");
      paid.type = "button";
      paid.textContent = "Marcar pago";
      paid.addEventListener("click", async () => {
        if (!confirm(`Registrar “${schedule.name}” como pago em ${dueDate}?`)) return;
        await markSchedulePaid(schedule, { date: dueDate });
        await reload();
        renderAll();
      });
      const postpone = document.createElement("button");
      postpone.type = "button";
      postpone.textContent = "Adiar 1 dia";
      postpone.addEventListener("click", async () => {
        await postponeSchedule(schedule, 1);
        await reload();
        renderAll();
      });
      const skip = document.createElement("button");
      skip.type = "button";
      skip.textContent = "Ignorar";
      skip.addEventListener("click", async () => {
        if (!confirm("Ignorar esta ocorrência sem criar transação?")) return;
        await skipOccurrence(schedule);
        await reload();
        renderAll();
      });
      actions.append(paid, postpone, skip);
      row.append(main, actions);
      section.appendChild(row);
    });
    container.appendChild(section);
  });
}

function exportICS() {
  const content = buildICS(state.schedules);
  downloadFile("projeto-financas-compromissos.ics", content, "text/calendar;charset=utf-8");
}

function renderReports() {
  const period = resolvePeriod("this_month", new Date());
  const report = buildReport({
    transactions: state.transactions,
    accounts: state.accounts,
    goals: state.goals,
    budgets: state.budgets,
    schedules: state.schedules,
    rates: state.rates,
    rate: state.settings.brlToPyg,
    baseCurrency: state.settings.baseCurrency,
    period
  });

  const flow = state.settings.baseCurrency === "PYG" ? report.analysis.balancePYG : report.analysis.balanceBRL;
  $("#monthlyFlow").textContent = formatMoney(flow, state.settings.baseCurrency);
  const commitments = state.schedules.filter((schedule) => schedule.active !== false && schedule.nextDueDate >= todayISO()).slice(0, 30);
  const commitmentTotal = commitments.reduce((sum, schedule) => {
    if (schedule.currency === state.settings.baseCurrency) return sum + Number(schedule.amount);
    return sum + (state.settings.baseCurrency === "PYG" ? Number(schedule.amount) * state.settings.brlToPyg : Number(schedule.amount) / state.settings.brlToPyg);
  }, 0);
  $("#upcomingCommitments").textContent = formatMoney(commitmentTotal, state.settings.baseCurrency);

  const safe = safeToSpend({
    accounts: state.accounts,
    transactions: state.transactions,
    schedules: state.schedules,
    goals: state.goals,
    budgets: state.budgets,
    rate: state.settings.brlToPyg,
    baseCurrency: state.settings.baseCurrency,
    untilDate: period.end
  });
  $("#safeSpendValue").textContent = safe.available ? formatMoney(safe.value, safe.baseCurrency) : "—";
  $("#safeSpendNote").textContent = safe.available ? safe.note : safe.reason;

  const list = $("#accountReportList");
  list.replaceChildren();
  report.accountSummaries.forEach((summary) => {
    const row = document.createElement("div");
    row.className = "transaction-row";
    const name = document.createElement("strong");
    name.textContent = summary.account.name;
    const value = document.createElement("strong");
    value.textContent = formatMoney(summary.balance, summary.account.currency);
    row.append(name, value);
    list.appendChild(row);
  });
}

function renderAll() {
  renderAccounts();
  renderReconciliation();
  renderSchedules();
  renderReports();
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
