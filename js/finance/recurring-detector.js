function normalizeDescription(value = "") {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\d+/g, "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

function daysBetween(a, b) {
  return Math.abs((new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / 86400000);
}

export function detectRecurring(transactions, { valueTolerance = 0.18 } = {}) {
  const expenses = transactions.filter((t) => t.type === "expense" && Number(t.amount) > 0 && t.date);
  const groups = new Map();

  for (const tx of expenses) {
    const key = `${tx.currency}|${tx.category}|${normalizeDescription(tx.description) || tx.category.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }

  const results = [];
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    items.sort((a, b) => a.date.localeCompare(b.date));
    const values = items.map((x) => Number(x.amount));
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const closeValues = values.filter((v) => Math.abs(v - avg) / Math.max(avg, 1) <= valueTolerance).length;
    const intervals = items.slice(1).map((x, i) => daysBetween(x.date, items[i].date));
    const weekly = intervals.filter((d) => d >= 5 && d <= 9).length;
    const monthly = intervals.filter((d) => d >= 24 && d <= 38).length;
    const cadence = monthly >= Math.max(1, intervals.length / 2) ? "mensal" : weekly >= Math.max(1, intervals.length / 2) ? "semanal" : null;

    if (!cadence || closeValues < Math.ceil(values.length * 0.6)) continue;
    results.push({
      description: items.at(-1).description,
      category: items[0].category,
      currency: items[0].currency,
      averageAmount: avg,
      cadence,
      occurrences: items.length,
      confidence: Math.min(0.98, 0.55 + items.length * 0.07 + closeValues / values.length * 0.2),
      transactionIds: items.map((x) => x.id),
      criterion: `Descrição/categoria semelhantes, valores próximos e intervalo ${cadence}.`
    });
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}
