import { formatMoney } from "../utils.js";
import { periodLabel } from "../finance/period-utils.js";

function metric(label, value, currency = "PYG", approximate = false) {
  return { label, value, currency, approximate };
}

export function buildLocalResponse(route, analysis) {
  const base = {
    intent: route.intent,
    confidence: route.confidence,
    title: "Análise financeira",
    summary: "",
    metrics: [],
    observations: [],
    suggestedActions: [],
    clarification: null,
    requiresConfirmation: false,
    proposedMutation: null
  };

  const label = route.filters?.period ? periodLabel(route.filters.period) : "período selecionado";
  const approx = analysis.approximate;

  if (route.confidence < 0.6 || route.intent === "unknown") {
    return { ...base, title: "Preciso entender melhor", clarification: "Não entendi com segurança. Tente informar período, moeda, categoria ou a ação desejada.", summary: "Não vou adivinhar silenciosamente." };
  }

  if (!analysis.transactionCount && !["goals", "budgets", "recurring", "anomalies"].includes(route.intent)) {
    return { ...base, title: "Sem dados no período", summary: `Não encontrei transações em ${label}.`, observations: ["Altere o período ou registre novos lançamentos."] };
  }

  if (route.intent === "spending_summary" || route.intent === "category_spending") {
    base.title = route.filters.category ? `Gastos com ${route.filters.category}` : "Resumo de gastos";
    base.summary = `Você gastou ${formatMoney(analysis.expensePYG, "PYG")} em ${label}.`;
    base.metrics.push(metric("Despesas", analysis.expensePYG, "PYG", approx));
    if (analysis.categories[0]) base.observations.push(`Maior categoria: ${analysis.categories[0].category} (${formatMoney(analysis.categories[0].valuePYG, "PYG")}).`);
  } else if (route.intent === "income_summary") {
    base.title = "Receitas";
    base.summary = `As receitas em ${label} somam ${formatMoney(analysis.incomePYG, "PYG")}.`;
    base.metrics.push(metric("Receitas", analysis.incomePYG, "PYG", approx));
  } else if (route.intent === "balance_summary") {
    base.title = "Saldo do período";
    base.summary = `O saldo calculado é ${formatMoney(analysis.balancePYG, "PYG")}.`;
    base.metrics.push(metric("Saldo", analysis.balancePYG, "PYG", approx));
  } else if (route.intent === "compare_periods") {
    base.title = "Comparação de períodos";
    const v = analysis.comparison.variationPercent;
    base.summary = v === null ? "Não há base suficiente no período anterior para calcular variação percentual." : `Seus gastos ${v > 0 ? "aumentaram" : v < 0 ? "diminuíram" : "ficaram estáveis"} ${Math.abs(v).toFixed(1)}%.`;
    base.metrics.push(metric("Período atual", analysis.expensePYG, "PYG", approx));
    base.metrics.push(metric("Período anterior", analysis.previous.expensePYG, "PYG", analysis.previous.approximate));
  } else if (route.intent === "savings") {
    base.title = "Taxa de poupança";
    if (analysis.savingsRate === null) base.summary = "Não há receita registrada suficiente para calcular a taxa de poupança.";
    else base.summary = `Sua taxa de poupança é ${analysis.savingsRate.toFixed(1)}%.`;
    base.metrics.push({ label: "Taxa de poupança", value: analysis.savingsRate, unit: "%", approximate: false });
    if (analysis.commitmentRate !== null) base.observations.push(`Comprometimento da renda: ${analysis.commitmentRate.toFixed(1)}%.`);
  } else if (route.intent === "projection") {
    base.title = "Projeção do mês";
    base.summary = `Mantido o ritmo atual, a projeção de despesas é ${formatMoney(analysis.projection.projectedExpense, "PYG")}.`;
    base.metrics.push(metric("Média diária", analysis.projection.dailyAverage, "PYG", true));
    base.metrics.push(metric("Projeção", analysis.projection.projectedExpense, "PYG", true));
    base.observations.push("Projeções são estimativas baseadas no ritmo registrado até agora.");
  } else if (route.intent === "recurring") {
    base.title = "Gastos recorrentes";
    base.summary = analysis.recurring.length ? `Identifiquei ${analysis.recurring.length} padrão(ões) recorrente(s).` : "Não encontrei padrões recorrentes com confiança suficiente.";
    base.observations = analysis.recurring.slice(0, 5).map((x) => `${x.description}: ${x.cadence}, ${x.occurrences} ocorrências. Critério: ${x.criterion}`);
  } else if (route.intent === "anomalies") {
    base.title = "Gastos fora do padrão";
    base.summary = analysis.anomalies.length ? `Encontrei ${analysis.anomalies.length} lançamento(s) fora do padrão recente.` : "Não encontrei lançamentos claramente fora do padrão recente.";
    base.observations = analysis.anomalies.slice(0, 5).map((x) => `${x.description}: ${x.message} Critério: ${x.criterion}`);
  } else if (route.intent === "goals") {
    base.title = "Metas financeiras";
    base.summary = analysis.goals.length ? `Você possui ${analysis.goals.length} meta(s) cadastrada(s).` : "Você ainda não possui metas cadastradas.";
    base.observations = analysis.goals.slice(0, 5).map(({ goal, projection }) => `${goal.name}: ${projection.progressPercent.toFixed(0)}% concluída; aporte necessário ${formatMoney(projection.requiredMonthly, goal.currency)}/mês.`);
  } else if (route.intent === "budgets") {
    base.title = "Orçamentos";
    base.summary = analysis.budgets.length ? `Há ${analysis.budgets.length} orçamento(s) para o mês.` : "Nenhum orçamento por categoria foi configurado para o mês atual.";
    base.observations = analysis.budgets.map((b) => `${b.category}: ${b.usedPercent.toFixed(0)}% utilizado — status ${b.status}.`);
  }

  if (!base.summary) base.summary = `Receitas: ${formatMoney(analysis.incomePYG, "PYG")}; despesas: ${formatMoney(analysis.expensePYG, "PYG")}; saldo: ${formatMoney(analysis.balancePYG, "PYG")}.`;
  if (approx) base.observations.push(`Valores consolidados usam a cotação configurada de 1 BRL = ${Math.round(analysis.rate)} PYG.`);
  return base;
}
