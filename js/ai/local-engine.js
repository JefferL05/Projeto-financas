import { formatMoney } from "../utils.js";
import { periodLabel } from "../finance/period-utils.js";

function metric(label, value, currency = "PYG", approximate = false) {
  return { label, value, currency, approximate };
}

function valuesForCurrency(analysis, currency) {
  return currency === "BRL"
    ? {
        income: analysis.incomeBRL,
        expense: analysis.expenseBRL,
        balance: analysis.balanceBRL,
        previousExpense: analysis.previous.expenseBRL,
        fairPreviousExpense: analysis.fairComparison?.expenseBRL ?? null
      }
    : {
        income: analysis.incomePYG,
        expense: analysis.expensePYG,
        balance: analysis.balancePYG,
        previousExpense: analysis.previous.expensePYG,
        fairPreviousExpense: analysis.fairComparison?.expensePYG ?? null
      };
}

function conversionObservation(analysis, currency) {
  if (!analysis.approximate) return null;
  return currency === "PYG"
    ? `Valores em BRL foram convertidos para PYG. Quando não há cotação histórica salva, é usada a cotação disponível e o resultado é marcado como aproximado.`
    : `Valores em PYG foram convertidos para BRL. Quando não há cotação histórica salva, é usada a cotação disponível e o resultado é marcado como aproximado.`;
}

export function buildLocalResponse(route, analysis, { baseCurrency = "PYG" } = {}) {
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
    proposedMutation: null,
    period: route.filters?.period || analysis.period,
    source: "Motor financeiro local",
    formula: null,
    assumptions: []
  };

  const label = route.filters?.period ? periodLabel(route.filters.period) : "período selecionado";
  const currency = route.filters?.currency || baseCurrency || "PYG";
  const values = valuesForCurrency(analysis, currency);
  const approx = analysis.approximate;

  if (route.confidence < 0.6 || route.intent === "unknown") {
    return {
      ...base,
      title: "Preciso entender melhor",
      clarification: "Não entendi com segurança. Tente informar período, moeda, categoria ou a ação desejada.",
      summary: "Não vou adivinhar silenciosamente."
    };
  }

  if (!analysis.transactionCount && !["goals", "budgets", "recurring", "anomalies"].includes(route.intent)) {
    return {
      ...base,
      title: "Sem dados no período",
      summary: `Não encontrei transações em ${label}.`,
      observations: ["Altere o período ou registre novos lançamentos."]
    };
  }

  if (route.intent === "spending_summary" || route.intent === "category_spending") {
    base.title = route.filters.category ? `Gastos com ${route.filters.category}` : "Resumo de gastos";
    base.summary = `Você gastou ${formatMoney(values.expense, currency)} em ${label}.`;
    base.metrics.push(metric("Despesas", values.expense, currency, approx));
    base.formula = "Soma das despesas do período, convertidas somente quando necessário.";
    if (analysis.categories[0] && currency === "PYG") {
      base.observations.push(`Maior categoria: ${analysis.categories[0].category} (${formatMoney(analysis.categories[0].valuePYG, "PYG")}).`);
    }
  } else if (route.intent === "income_summary") {
    base.title = "Receitas";
    base.summary = `As receitas em ${label} somam ${formatMoney(values.income, currency)}.`;
    base.metrics.push(metric("Receitas", values.income, currency, approx));
    base.formula = "Soma das receitas do período.";
  } else if (route.intent === "balance_summary") {
    base.title = "Fluxo líquido do período";
    base.summary = `Receitas menos despesas no período resultam em ${formatMoney(values.balance, currency)}.`;
    base.metrics.push(metric("Fluxo líquido", values.balance, currency, approx));
    base.formula = "Receitas − despesas do período. Este valor não representa patrimônio líquido.";
  } else if (route.intent === "compare_periods") {
    base.title = "Comparação de períodos";
    const variation = analysis.comparison.variationPercent;
    base.summary = variation === null
      ? "Não há base suficiente no período anterior para calcular variação percentual."
      : `Seus gastos ${variation > 0 ? "aumentaram" : variation < 0 ? "diminuíram" : "ficaram estáveis"} ${Math.abs(variation).toFixed(1)}% na comparação principal.`;
    base.metrics.push(metric("Período atual", values.expense, currency, approx));
    base.metrics.push(metric("Mês/período anterior", values.previousExpense, currency, analysis.previous.approximate));
    base.formula = "Comparação principal usa o período-calendário anterior quando aplicável.";

    if (analysis.fairComparison && values.fairPreviousExpense !== null) {
      const fairVariation = analysis.fairComparison.comparison.variationPercent;
      base.observations.push(
        fairVariation === null
          ? `Comparação pelos mesmos dias do período anterior: sem base suficiente.`
          : `Comparando apenas os mesmos dias do mês anterior, a variação é ${fairVariation > 0 ? "+" : ""}${fairVariation.toFixed(1)}%.`
      );
    }
  } else if (route.intent === "savings") {
    base.title = "Taxa de poupança";
    base.summary = analysis.savingsRate === null
      ? "Não há receita registrada suficiente para calcular a taxa de poupança."
      : `Sua taxa de poupança é ${analysis.savingsRate.toFixed(1)}%.`;
    base.metrics.push({ label: "Taxa de poupança", value: analysis.savingsRate, unit: "%", approximate: false });
    base.formula = "(Receitas − despesas) ÷ receitas × 100.";
    if (analysis.commitmentRate !== null) base.observations.push(`Comprometimento da renda: ${analysis.commitmentRate.toFixed(1)}%.`);
  } else if (route.intent === "projection") {
    const projection = currency === "BRL"
      ? analysis.projection.projectedExpense / analysis.rate
      : analysis.projection.projectedExpense;
    const daily = currency === "BRL"
      ? analysis.projection.dailyAverage / analysis.rate
      : analysis.projection.dailyAverage;
    base.title = "Projeção do mês";
    base.summary = `Mantido o ritmo atual, a projeção de despesas é ${formatMoney(projection, currency)}.`;
    base.metrics.push(metric("Média diária", daily, currency, true));
    base.metrics.push(metric("Projeção", projection, currency, true));
    base.formula = "Média diária registrada × quantidade de dias do mês.";
    base.observations.push("Projeções são estimativas, não garantias.");
  } else if (route.intent === "recurring") {
    base.title = "Gastos recorrentes";
    base.summary = analysis.recurring.length
      ? `Identifiquei ${analysis.recurring.length} padrão(ões) recorrente(s).`
      : "Não encontrei padrões recorrentes com confiança suficiente.";
    base.observations = analysis.recurring.slice(0, 5).map((item) => `${item.description}: ${item.cadence}, ${item.occurrences} ocorrências. Critério: ${item.criterion}`);
  } else if (route.intent === "anomalies") {
    base.title = "Gastos fora do padrão";
    base.summary = analysis.anomalies.length
      ? `Encontrei ${analysis.anomalies.length} lançamento(s) fora do seu padrão recente.`
      : "Não encontrei lançamentos claramente fora do padrão recente.";
    base.observations = analysis.anomalies.slice(0, 5).map((item) => `${item.description}: ${item.message} Critério: ${item.criterion}`);
  } else if (route.intent === "goals") {
    base.title = "Metas financeiras";
    base.summary = analysis.goals.length ? `Você possui ${analysis.goals.length} meta(s) cadastrada(s).` : "Você ainda não possui metas cadastradas.";
    base.observations = analysis.goals.slice(0, 5).map(({ goal, projection }) => `${goal.name}: ${projection.progressPercent.toFixed(0)}% concluída; aporte necessário ${formatMoney(projection.requiredMonthly, goal.currency)}/mês.`);
  } else if (route.intent === "budgets") {
    base.title = "Orçamentos";
    base.summary = analysis.budgets.length ? `Há ${analysis.budgets.length} orçamento(s) para o mês.` : "Nenhum orçamento por categoria foi configurado para o mês atual.";
    base.observations = analysis.budgets.map((budget) => `${budget.category}: ${budget.usedPercent.toFixed(0)}% utilizado — ${formatMoney(budget.spent, budget.currency)} de ${formatMoney(budget.limit, budget.currency)}${budget.approximate ? " (aprox.)" : ""}.`);
  }

  if (!base.summary) {
    base.summary = `Receitas: ${formatMoney(values.income, currency)}; despesas: ${formatMoney(values.expense, currency)}; fluxo líquido: ${formatMoney(values.balance, currency)}.`;
  }

  const conversion = conversionObservation(analysis, currency);
  if (conversion) {
    base.observations.push(conversion);
    base.assumptions.push(`Cotação de referência atual: 1 BRL = ${Math.round(analysis.rate)} PYG.`);
  }

  return base;
}
