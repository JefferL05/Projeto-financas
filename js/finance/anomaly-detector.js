function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function detectAnomalies(transactions, { minimumHistory = 3, threshold = 1.8 } = {}) {
  const expenses = transactions.filter((t) => t.type === "expense" && Number(t.amount) > 0);
  const byKey = new Map();

  for (const tx of expenses) {
    const key = `${tx.currency}|${tx.category}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(tx);
  }

  const results = [];
  for (const items of byKey.values()) {
    if (items.length < minimumHistory + 1) continue;
    items.sort((a, b) => a.date.localeCompare(b.date));

    for (let i = minimumHistory; i < items.length; i++) {
      const current = items[i];
      const history = items.slice(Math.max(0, i - 12), i).map((x) => Number(x.amount));
      const med = median(history);
      const avg = history.reduce((a, b) => a + b, 0) / history.length;
      if (!med) continue;
      const ratio = Number(current.amount) / med;
      if (ratio >= threshold) {
        results.push({
          transactionId: current.id,
          description: current.description,
          category: current.category,
          currency: current.currency,
          amount: Number(current.amount),
          categoryMedian: med,
          categoryAverage: avg,
          ratioToMedian: ratio,
          criterion: `Valor ${ratio.toFixed(1)}× acima da mediana recente da categoria (${history.length} lançamentos anteriores).`,
          message: "Fora do seu padrão recente; pode valer a pena revisar."
        });
      }
    }
  }

  return results.sort((a, b) => b.ratioToMedian - a.ratioToMedian);
}
