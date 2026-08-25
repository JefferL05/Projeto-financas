import { normalizeToPYG } from "../utils.js";

export function evaluateBudgets({ budgets = [], transactions = [], rate = 1300, month }) {
  return budgets.filter((b) => !month || b.period === month).map((budget) => {
    const spentOriginal = transactions
      .filter((t) => t.type === "expense" && t.category === budget.category && t.currency === budget.currency && (!month || t.date?.startsWith(month)))
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const limit = Number(budget.limit || 0);
    const usedPercent = limit > 0 ? spentOriginal / limit * 100 : 0;
    const remaining = Math.max(0, limit - spentOriginal);
    const status = usedPercent >= 100 ? "excedido" : usedPercent >= 80 ? "atencao" : "saudavel";

    return {
      ...budget,
      spent: spentOriginal,
      remaining,
      usedPercent,
      status,
      spentPYG: normalizeToPYG(spentOriginal, budget.currency, rate),
      limitPYG: normalizeToPYG(limit, budget.currency, rate)
    };
  });
}

export function projectedBudgetStatus(budgetEvaluation, elapsedDays, totalDays) {
  const projected = elapsedDays > 0 ? budgetEvaluation.spent / elapsedDays * totalDays : 0;
  return {
    projected,
    projectedOverrun: Math.max(0, projected - Number(budgetEvaluation.limit || 0)),
    willExceed: projected > Number(budgetEvaluation.limit || 0)
  };
}
