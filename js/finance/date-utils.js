export function localDateParts(date = new Date()) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate()
  };
}

export function localISO(date = new Date()) {
  const { year, month, day } = localDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseLocalISO(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function addDays(value, amount) {
  const source = value instanceof Date ? value : parseLocalISO(value);
  if (!source) throw new TypeError("Data inválida.");
  return new Date(source.getFullYear(), source.getMonth(), source.getDate() + amount);
}

export function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function todayLocalISO(now = new Date()) {
  return localISO(startOfLocalDay(now));
}

export function yesterdayLocalISO(now = new Date()) {
  return localISO(addDays(startOfLocalDay(now), -1));
}

export function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function daysBetweenInclusive(startValue, endValue) {
  const start = startValue instanceof Date ? startValue : parseLocalISO(startValue);
  const end = endValue instanceof Date ? endValue : parseLocalISO(endValue);
  if (!start || !end) return 0;
  const startUTC = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUTC = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((endUTC - startUTC) / 86400000) + 1;
}

export function formatLocalDate(value, locale = "pt-BR") {
  const date = value instanceof Date ? value : parseLocalISO(value);
  return date ? new Intl.DateTimeFormat(locale).format(date) : "";
}

export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function daysInLocalMonth(date = new Date()) {
  return endOfMonth(date).getDate();
}
