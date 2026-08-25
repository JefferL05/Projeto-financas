import {
  addDays,
  daysBetweenInclusive,
  endOfMonth,
  localISO,
  parseLocalISO,
  startOfLocalDay,
  startOfMonth
} from "./date-utils.js";

const MONTHS = {
  janeiro: 0,
  fevereiro: 1,
  marco: 2,
  março: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11
};

export function startOfDay(date = new Date()) {
  return startOfLocalDay(date);
}

export function resolvePeriod(period = "this_month", now = new Date()) {
  const today = startOfLocalDay(now);
  let start;
  let end;

  if (period === "today") {
    start = today;
    end = today;
  } else if (period === "yesterday") {
    start = addDays(today, -1);
    end = start;
  } else if (period === "this_week") {
    const mondayOffset = (today.getDay() + 6) % 7;
    start = addDays(today, -mondayOffset);
    end = today;
  } else if (period === "last_week") {
    const mondayOffset = (today.getDay() + 6) % 7;
    const thisMonday = addDays(today, -mondayOffset);
    start = addDays(thisMonday, -7);
    end = addDays(thisMonday, -1);
  } else if (period === "last_month") {
    const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    start = startOfMonth(previousMonth);
    end = endOfMonth(previousMonth);
  } else if (/^last_(3|6|12)_months$/.test(period)) {
    const months = Number(period.match(/\d+/)[0]);
    start = new Date(today.getFullYear(), today.getMonth() - months + 1, 1);
    end = today;
  } else {
    start = startOfMonth(today);
    end = today;
  }

  return {
    key: period,
    start: localISO(start),
    end: localISO(end)
  };
}

export function customPeriod(start, end) {
  if (!parseLocalISO(start) || !parseLocalISO(end) || start > end) {
    throw new TypeError("Intervalo personalizado inválido.");
  }
  return { key: "custom", start, end };
}

function previousCalendarMonth(referenceDate) {
  const previous = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
  return {
    key: "previous_month",
    start: localISO(startOfMonth(previous)),
    end: localISO(endOfMonth(previous)),
    comparisonMode: "calendar"
  };
}

function previousCalendarWeek(periodStart) {
  return {
    key: "previous_week",
    start: localISO(addDays(periodStart, -7)),
    end: localISO(addDays(periodStart, -1)),
    comparisonMode: "calendar"
  };
}

function previousRollingMonths(period, months) {
  const start = parseLocalISO(period.start);
  if (!start) throw new TypeError("Período inválido.");
  const previousEnd = addDays(start, -1);
  const previousStart = new Date(previousEnd.getFullYear(), previousEnd.getMonth() - months + 1, 1);
  return {
    key: `previous_${months}_months`,
    start: localISO(previousStart),
    end: localISO(previousEnd),
    comparisonMode: "calendar"
  };
}

export function previousPeriod(period) {
  const start = parseLocalISO(period?.start);
  const end = parseLocalISO(period?.end);
  if (!start || !end) throw new TypeError("Período inválido.");

  if (period.key === "today") {
    const yesterday = addDays(start, -1);
    return { key: "previous_day", start: localISO(yesterday), end: localISO(yesterday), comparisonMode: "calendar" };
  }

  if (period.key === "this_week") return previousCalendarWeek(start);
  if (period.key === "this_month") return previousCalendarMonth(start);
  if (period.key === "last_3_months") return previousRollingMonths(period, 3);
  if (period.key === "last_6_months") return previousRollingMonths(period, 6);
  if (period.key === "last_12_months") return previousRollingMonths(period, 12);

  const days = daysBetweenInclusive(start, end);
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  return {
    key: "previous",
    start: localISO(previousStart),
    end: localISO(previousEnd),
    comparisonMode: "same_duration"
  };
}

export function comparablePreviousPeriod(period, now = new Date()) {
  if (period?.key !== "this_month") return null;

  const currentStart = parseLocalISO(period.start);
  const currentEnd = parseLocalISO(period.end);
  if (!currentStart || !currentEnd) return null;

  const previousMonth = new Date(currentStart.getFullYear(), currentStart.getMonth() - 1, 1);
  const lastDayPreviousMonth = endOfMonth(previousMonth).getDate();
  const currentDay = Math.min(currentEnd.getDate(), lastDayPreviousMonth);

  return {
    key: "previous_month_same_days",
    start: localISO(previousMonth),
    end: localISO(new Date(previousMonth.getFullYear(), previousMonth.getMonth(), currentDay)),
    comparisonMode: "same_days"
  };
}

export function inPeriod(date, period) {
  return Boolean(date && period && date >= period.start && date <= period.end);
}

export function periodLabel(period) {
  const labels = {
    today: "hoje",
    yesterday: "ontem",
    this_week: "esta semana",
    last_week: "semana passada",
    this_month: "este mês",
    last_month: "mês passado",
    last_3_months: "últimos 3 meses",
    last_6_months: "últimos 6 meses",
    last_12_months: "últimos 12 meses",
    previous_month_same_days: "mesmos dias do mês passado"
  };
  return labels[period?.key] || `${period?.start || "?"} a ${period?.end || "?"}`;
}

export function extractPeriodFromText(text, now = new Date()) {
  const q = String(text || "").toLowerCase();
  if (/\bhoje\b/.test(q)) return resolvePeriod("today", now);
  if (/\bontem\b/.test(q)) return resolvePeriod("yesterday", now);
  if (/esta semana|nessa semana/.test(q)) return resolvePeriod("this_week", now);
  if (/semana passada|ultima semana|última semana/.test(q)) return resolvePeriod("last_week", now);
  if (/m[eê]s passado|ultimo mes|último mês/.test(q)) return resolvePeriod("last_month", now);
  if (/ultimos? 3|últimos? 3/.test(q)) return resolvePeriod("last_3_months", now);
  if (/ultimos? 6|últimos? 6/.test(q)) return resolvePeriod("last_6_months", now);
  if (/ultimos? 12|últimos? 12/.test(q)) return resolvePeriod("last_12_months", now);

  for (const [name, month] of Object.entries(MONTHS)) {
    if (!q.includes(name)) continue;
    const yearMatch = q.match(/\b(20\d{2})\b/);
    let year = yearMatch ? Number(yearMatch[1]) : now.getFullYear();
    if (!yearMatch && month > now.getMonth()) year -= 1;
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    return {
      key: "custom",
      start: localISO(start),
      end: localISO(end),
      label: `${name} de ${year}`
    };
  }

  return resolvePeriod("this_month", now);
}
