import { convertTransaction } from "./exchange.js";

export function evaluateBudgets({ budgets = [], transactions = [], rate = 1300, rates = [], month }) {
  return budgets
    .filter((budget) => !month || budget.period === month)
    .map((budget) => {
      const matching = transactions.filter((transaction) =>
        transaction.type === "expense"
        && transaction.category === budget.category
        && (!month || transaction.date?.startsWith(month))
      );

      const originalByCurrency = { BRL: 0, PYG: 0 };
      let spent = 0;
      let approximate = false;
      const conversionDetails = [];

      for (const transaction of matching) {
        originalByCurrency[transaction.currency] += Number(transaction.amount || 0);
        const converted = convertTransaction(transaction, budget.currency, rates, rate);
        spent += converted.amount;
        approximate ||= converted.approximate;
        if (transaction.currency !== budget.currency) {
          conversionDetails.push({
            transactionId: transaction.id,
            fromCurrency: transaction.currency,
            toCurrency: budget.currency,
            originalAmount: transaction.amount,
            convertedAmount: converted.amount,
            rate: converted.rate,
            rateDate: converted.rateDate || null,
            approximate: converted.approximate
          });
        }
      }

      const limit = Number(budget.limit || 0);
      const usedPercent = limit > 0 ? spent / limit * 100 : 0;
      const remaining = Math.max(0, limit - spent);
      const status = usedPercent >= 100 ? "excedido" : usedPercent >= 80 ? "atencao" : "saudavel";

      return {
        ...budget,
        spent,
        remaining,
        usedPercent,
        status,
        originalByCurrency,
        approximate,
        rate: Number(rate) || 1300,
        conversionDetails
      };
    });
}

export function projectedBudgetStatus(budgetEvaluation, elapsedDays, totalDays) {
  const projected = elapsedDays > 0
    ? budgetEvaluation.spent / elapsedDays * totalDays
    : 0;

  return {
    projected,
    projectedOverrun: Math.max(0, projected - Number(budgetEvaluation.limit || 0)),
    willExceed: projected > Number(budgetEvaluation.limit || 0),
    approximate: Boolean(budgetEvaluation.approximate)
  };
}
