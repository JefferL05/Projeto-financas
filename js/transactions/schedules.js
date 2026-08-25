import { getAll, put, runAtomic } from "../db.js";
import { addDays, localISO, parseLocalISO, todayLocalISO } from "../finance/date-utils.js";
import { uid } from "../utils.js";

export const SCHEDULE_FREQUENCIES = ["once", "weekly", "monthly", "yearly"];

function addMonthsLocal(date, months) {
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(day, maxDay));
}

export function nextOccurrence(schedule, fromDate = schedule.nextDueDate) {
  const current = parseLocalISO(fromDate);
  if (!current) return null;
  const interval = Math.max(1, Number(schedule.interval || 1));
  let next;

  if (schedule.frequency === "weekly") next = addDays(current, 7 * interval);
  else if (schedule.frequency === "monthly") next = addMonthsLocal(current, interval);
  else if (schedule.frequency === "yearly") next = new Date(current.getFullYear() + interval, current.getMonth(), current.getDate());
  else return null;

  const iso = localISO(next);
  if (schedule.endDate && iso > schedule.endDate) return null;
  return iso;
}

export function scheduleOccurrences(schedule, { start, end }) {
  const occurrences = [];
  let due = schedule.nextDueDate;
  let guard = 0;

  while (due && due <= end && guard < 500) {
    if (due >= start) occurrences.push({ scheduleId: schedule.id, dueDate: due, schedule });
    due = nextOccurrence(schedule, due);
    guard += 1;
  }

  return occurrences;
}

export async function listUpcomingSchedules({ now = new Date(), days = 30 } = {}) {
  const schedules = (await getAll("schedules")).filter((item) => item.active !== false);
  const today = todayLocalISO(now);
  const end = localISO(addDays(now, days));
  const overdue = [];
  const todayItems = [];
  const upcoming7 = [];
  const upcoming30 = [];

  for (const schedule of schedules) {
    for (const occurrence of scheduleOccurrences(schedule, { start: "0000-01-01", end })) {
      if (occurrence.dueDate < today) overdue.push(occurrence);
      else if (occurrence.dueDate === today) todayItems.push(occurrence);
      else if (occurrence.dueDate <= localISO(addDays(now, 7))) upcoming7.push(occurrence);
      else upcoming30.push(occurrence);
    }
  }

  return { overdue, today: todayItems, next7Days: upcoming7, next30Days: upcoming30 };
}

export async function createSchedule(input) {
  const now = new Date().toISOString();
  return put("schedules", {
    id: uid("schedule"),
    name: input.name,
    kind: input.kind || "expense",
    amount: Number(input.amount),
    currency: input.currency,
    accountId: input.accountId,
    destinationAccountId: input.destinationAccountId || null,
    category: input.category || "Outros",
    frequency: input.frequency || "once",
    interval: Math.max(1, Number(input.interval || 1)),
    dayOfMonth: input.dayOfMonth || null,
    nextDueDate: input.nextDueDate,
    endDate: input.endDate || null,
    reminderDays: Number(input.reminderDays || 0),
    autoPost: Boolean(input.autoPost),
    active: input.active !== false,
    createdAt: now,
    updatedAt: now
  });
}

export async function markSchedulePaid(schedule, { date = schedule.nextDueDate, description = schedule.name } = {}) {
  const existing = await getAll("transactions");
  const duplicate = existing.some((item) => item.scheduleId === schedule.id && item.date === date);
  if (duplicate) throw new Error("Esta ocorrência já foi registrada.");

  const timestamp = new Date().toISOString();
  const transaction = {
    id: uid("tx"),
    type: schedule.kind === "income" ? "income" : "expense",
    currency: schedule.currency,
    amount: Number(schedule.amount),
    accountId: schedule.accountId,
    category: schedule.category || "Outros",
    description,
    date,
    tags: schedule.kind === "subscription" ? ["assinatura"] : [],
    status: "cleared",
    scheduleId: schedule.id,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const nextDueDate = nextOccurrence(schedule, date);
  const updatedSchedule = {
    ...schedule,
    nextDueDate: nextDueDate || schedule.nextDueDate,
    active: Boolean(nextDueDate),
    updatedAt: timestamp
  };

  await runAtomic(["transactions", "schedules"], "readwrite", (stores) => {
    stores.transactions.put(transaction);
    stores.schedules.put(updatedSchedule);
  });

  return { transaction, schedule: updatedSchedule };
}

export async function postponeSchedule(schedule, days = 1) {
  const current = parseLocalISO(schedule.nextDueDate);
  if (!current) throw new TypeError("Data do compromisso inválida.");
  return put("schedules", {
    ...schedule,
    nextDueDate: localISO(addDays(current, days)),
    updatedAt: new Date().toISOString()
  });
}

export async function skipOccurrence(schedule) {
  const nextDueDate = nextOccurrence(schedule);
  return put("schedules", {
    ...schedule,
    nextDueDate: nextDueDate || schedule.nextDueDate,
    active: Boolean(nextDueDate),
    updatedAt: new Date().toISOString()
  });
}

export function buildICS(schedules = []) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Projeto Finanças//PT-BR"];
  for (const schedule of schedules) {
    if (!schedule.active || !schedule.nextDueDate) continue;
    const date = schedule.nextDueDate.replaceAll("-", "");
    const summary = String(schedule.name || "Compromisso financeiro").replace(/[\n,;]/g, " ");
    lines.push("BEGIN:VEVENT", `UID:${schedule.id}@projeto-financas`, `DTSTART;VALUE=DATE:${date}`, `SUMMARY:${summary}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
