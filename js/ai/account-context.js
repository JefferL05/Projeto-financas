import { accountSummary, availableFunds, isLiabilityAccount, netWorth } from "../accounts/account-balance.js";
import { formatMoney } from "../utils.js";
import { safeToSpend } from "../reports/report-engine.js";
import { resolvePeriod } from "../finance/period-utils.js";

function responseBase(intent, title) {
  return {
    intent,
    confidence: 0.9,
    title,
    summary: "",
    metrics: [],
    observations: [],
    suggestedActions: [],
    clarification: null,
    requiresConfirmation: false,
    proposedMutation: null,
    source: "Contas e planejamento locais"
  };
}

function convertedValue(value, currency, baseCurrency, rate) {
  if (currency === baseCurrency) return Number(value) || 0;
  return baseCurrency === "PYG" ? Number(value || 0) * rate : Number(value || 0) / rate;
}

export function buildAccountResponse(route, {
  accounts = [],
  transactions = [],
  schedules = [],
  goals = [],
  budgets = [],
  rate = 1300,
  baseCurrency = "PYG",
  now = new Date()
} = {}) {
  if (route.intent === "available_funds") {
    const result = responseBase(route.intent, "Dinheiro disponível");
    const value = availableFunds(accounts, transactions, { baseCurrency, rate });
    result.summary = accounts.length
      ? `As contas líquidas incluídas no orçamento somam ${formatMoney(value, baseCurrency)}.`
      : "Ainda não há contas suficientes para calcular o dinheiro disponível.";
    result.metrics.push({ label: "Disponível", value, currency: baseCurrency, approximate: false });
    result.observations.push("Inclui somente contas líquidas marcadas para orçamento; não é uma garantia de gasto seguro.");
    return result;
  }

  if (route.intent === "net_worth") {
    const result = responseBase(route.intent, "Patrimônio líquido");
    const value = netWorth(accounts, transactions, { baseCurrency, rate });
    result.summary = accounts.length
      ? `Seu patrimônio líquido cadastrado é ${formatMoney(value, baseCurrency)}.`
      : "Cadastre contas e saldos para calcular patrimônio líquido.";
    result.metrics.push({ label: "Patrimônio líquido", value, currency: baseCurrency, approximate: false });
    result.observations.push("Fórmula: ativos incluídos no patrimônio menos passivos incluídos no patrimônio.");
    return result;
  }

  if (route.intent === "liabilities") {
    const result = responseBase(route.intent, "Dívidas cadastradas");
    const liabilities = accounts.filter((account) => !account.archived && isLiabilityAccount(account));
    const selected = route.entities?.accountId
      ? liabilities.filter((account) => account.id === route.entities.accountId)
      : liabilities;
    const total = selected.reduce((sum, account) => {
      const balance = accountSummary(account, transactions, { baseCurrency, rate }).balance;
      return sum + convertedValue(balance, account.currency, baseCurrency, rate);
    }, 0);
    result.summary = selected.length
      ? `O saldo dos passivos selecionados soma ${formatMoney(total, baseCurrency)}.`
      : "Não encontrei contas de cartão, empréstimo ou dívida cadastradas.";
    result.metrics.push({ label: "Passivos", value: total, currency: baseCurrency, approximate: false });
    result.observations = selected.slice(0, 5).map((account) => {
      const summary = accountSummary(account, transactions, { baseCurrency, rate });
      return `${account.name}: ${formatMoney(summary.balance, account.currency)}.`;
    });
    return result;
  }

  if (route.intent === "upcoming_commitments") {
    const result = responseBase(route.intent, "Próximos compromissos");
    const period = route.filters?.period || resolvePeriod("this_week", now);
    const matching = schedules
      .filter((schedule) => schedule.active !== false && schedule.nextDueDate >= period.start && schedule.nextDueDate <= period.end)
      .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
    const total = matching.reduce((sum, schedule) => sum + convertedValue(schedule.amount, schedule.currency, baseCurrency, rate), 0);
    result.summary = matching.length
      ? `Há ${matching.length} compromisso(s) no período, totalizando aproximadamente ${formatMoney(total, baseCurrency)}.`
      : "Não encontrei compromissos no período solicitado.";
    result.metrics.push({ label: "Compromissos", value: total, currency: baseCurrency, approximate: matching.some((item) => item.currency !== baseCurrency) });
    result.observations = matching.slice(0, 5).map((schedule) => `${schedule.nextDueDate}: ${schedule.name} — ${formatMoney(schedule.amount, schedule.currency)}.`);
    return result;
  }

  if (route.intent === "reconciliation_status") {
    const result = responseBase(route.intent, "Status de conciliação");
    const selected = route.entities?.accountId
      ? accounts.filter((account) => account.id === route.entities.accountId)
      : accounts.filter((account) => !account.archived);
    if (!selected.length) {
      result.summary = "Não encontrei a conta solicitada.";
      return result;
    }
    const pending = selected.flatMap((account) => transactions.filter((transaction) => transaction.accountId === account.id && transaction.status !== "reconciled"));
    result.summary = pending.length
      ? `Existem ${pending.length} movimentação(ões) ainda não conciliada(s) nas contas selecionadas.`
      : "As movimentações registradas das contas selecionadas estão conciliadas.";
    result.observations = selected.slice(0, 5).map((account) => `${account.name}: última conciliação ${account.lastReconciledAt ? new Date(account.lastReconciledAt).toLocaleDateString("pt-BR") : "não registrada"}.`);
    return result;
  }

  if (route.intent === "safe_to_spend") {
    const result = responseBase(route.intent, "Valor potencialmente disponível");
    const month = resolvePeriod("this_month", now);
    const safe = safeToSpend({ accounts, transactions, schedules, goals, budgets, rate, baseCurrency, untilDate: month.end });
    if (!safe.available) {
      result.summary = safe.reason;
      return result;
    }
    result.summary = `Com os dados atuais, o valor potencialmente disponível é ${formatMoney(safe.value, baseCurrency)}.`;
    result.metrics.push({ label: "Potencialmente disponível", value: safe.value, currency: baseCurrency, approximate: true });
    result.observations.push(
      `Disponível: ${formatMoney(safe.components.availableFunds, baseCurrency)}; compromissos: ${formatMoney(safe.components.commitments, baseCurrency)}; reservas de metas: ${formatMoney(safe.components.goalReservations, baseCurrency)}; orçamento comprometido: ${formatMoney(safe.components.budgetCommitted, baseCurrency)}.`
    );
    result.observations.push(safe.note);
    return result;
  }

  return null;
}
