const MONTHS = {
  janeiro: 0, fevereiro: 1, marco: 2, março: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11
};

function iso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function resolvePeriod(period = "this_month", now = new Date()) {
  const today = startOfDay(now);
  let start;
  let end;

  if (period === "today") {
    start = end = today;
  } else if (period === "yesterday") {
    start = end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  } else if (period === "this_week") {
    const day = (today.getDay() + 6) % 7;
    start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - day);
    end = today;
  } else if (period === "last_month") {
    start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    end = new Date(today.getFullYear(), today.getMonth(), 0);
  } else if (/^last_(3|6|12)_months$/.test(period)) {
    const months = Number(period.match(/\d+/)[0]);
    start = new Date(today.getFullYear(), today.getMonth() - months + 1, 1);
    end = today;
  } else {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end = today;
  }

  return { key: period, start: iso(start), end: iso(end) };
}

export function customPeriod(start, end) {
  return { key: "custom", start, end };
}

export function previousPeriod(period) {
  const start = new Date(`${period.start}T00:00:00`);
  const end = new Date(`${period.end}T00:00:00`);
  const days = Math.round((end - start) / 86400000) + 1;
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  return { key: "previous", start: iso(prevStart), end: iso(prevEnd) };
}

export function inPeriod(date, period) {
  return Boolean(date && date >= period.start && date <= period.end);
}

export function periodLabel(period) {
  const labels = {
    today: "hoje", yesterday: "ontem", this_week: "esta semana", this_month: "este mês",
    last_month: "mês passado", last_3_months: "últimos 3 meses", last_6_months: "últimos 6 meses",
    last_12_months: "últimos 12 meses"
  };
  return labels[period.key] || `${period.start} a ${period.end}`;
}

export function extractPeriodFromText(text, now = new Date()) {
  const q = text.toLowerCase();
  if (/\bhoje\b/.test(q)) return resolvePeriod("today", now);
  if (/\bontem\b/.test(q)) return resolvePeriod("yesterday", now);
  if (/esta semana|nessa semana/.test(q)) return resolvePeriod("this_week", now);
  if (/m[eê]s passado|ultimo mes|último mês/.test(q)) return resolvePeriod("last_month", now);
  if (/ultimos? 3|últimos? 3/.test(q)) return resolvePeriod("last_3_months", now);
  if (/ultimos? 6|últimos? 6/.test(q)) return resolvePeriod("last_6_months", now);
  if (/ultimos? 12|últimos? 12/.test(q)) return resolvePeriod("last_12_months", now);

  for (const [name, month] of Object.entries(MONTHS)) {
    if (q.includes(name)) {
      const yearMatch = q.match(/\b(20\d{2})\b/);
      let year = yearMatch ? Number(yearMatch[1]) : now.getFullYear();
      if (!yearMatch && month > now.getMonth()) year -= 1;
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0);
      return { key: "custom", start: iso(start), end: iso(end), label: `${name} de ${year}` };
    }
  }

  return resolvePeriod("this_month", now);
}
