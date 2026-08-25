export function normalizeRateHistory(rates = []) {
  return rates
    .filter((item) => item && item.date && Number(item.rate) > 0)
    .map((item) => ({ ...item, rate: Number(item.rate) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function findHistoricalRate(date, rates = [], currentRate = 1300) {
  const history = normalizeRateHistory(rates);
  if (!history.length) {
    return {
      rate: Number(currentRate) || 1300,
      source: "current",
      approximate: true,
      rateDate: null
    };
  }

  const exact = [...history].reverse().find((item) => item.date === date);
  if (exact) {
    return { rate: exact.rate, source: exact.source || "history", approximate: false, rateDate: exact.date };
  }

  const previous = [...history].reverse().find((item) => item.date <= date);
  if (previous) {
    return { rate: previous.rate, source: previous.source || "history", approximate: true, rateDate: previous.date };
  }

  const nearest = history[0];
  return { rate: nearest.rate, source: nearest.source || "history", approximate: true, rateDate: nearest.date };
}

export function transactionRateInfo(transaction, rates = [], currentRate = 1300) {
  if (transaction.currency === "PYG") {
    return { rate: 1, source: "original", approximate: false, rateDate: transaction.date };
  }

  if (Number(transaction.exchangeRateSnapshot) > 0) {
    return {
      rate: Number(transaction.exchangeRateSnapshot),
      source: "snapshot",
      approximate: false,
      rateDate: transaction.date
    };
  }

  return findHistoricalRate(transaction.date, rates, currentRate);
}

export function convertTransaction(transaction, targetCurrency, rates = [], currentRate = 1300) {
  const amount = Number(transaction.amount) || 0;
  if (transaction.currency === targetCurrency) {
    return {
      amount,
      currency: targetCurrency,
      approximate: false,
      rate: transaction.currency === "BRL" ? transactionRateInfo(transaction, rates, currentRate).rate : 1,
      source: "original"
    };
  }

  const rateInfo = transactionRateInfo(transaction, rates, currentRate);
  const converted = targetCurrency === "PYG" ? amount * rateInfo.rate : amount / rateInfo.rate;
  return {
    amount: converted,
    currency: targetCurrency,
    approximate: rateInfo.approximate,
    rate: rateInfo.rate,
    source: rateInfo.source,
    rateDate: rateInfo.rateDate
  };
}

export function convertAmount(amount, sourceCurrency, targetCurrency, rate) {
  const value = Number(amount) || 0;
  const safeRate = Number(rate) > 0 ? Number(rate) : 1300;
  if (sourceCurrency === targetCurrency) return value;
  return targetCurrency === "PYG" ? value * safeRate : value / safeRate;
}
