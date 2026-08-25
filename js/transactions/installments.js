import { createSchedule } from "./schedules.js";
import { parseLocalISO, localISO } from "../finance/date-utils.js";

function addMonths(date, months) {
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(day, maxDay));
}

export function calculateInstallment({ total, count, interestPercent = 0 }) {
  const principal = Number(total);
  const installments = Math.max(1, Number(count));
  const rate = Math.max(0, Number(interestPercent || 0)) / 100;
  const finalTotal = principal * (1 + rate);
  return {
    originalTotal: principal,
    finalTotal,
    count: installments,
    installmentValue: finalTotal / installments,
    interestValue: finalTotal - principal
  };
}

export async function createInstallmentPlan({
  name,
  total,
  count,
  interestPercent = 0,
  currency,
  accountId,
  category,
  firstDate
}) {
  const calculation = calculateInstallment({ total, count, interestPercent });
  const first = parseLocalISO(firstDate);
  if (!first) throw new TypeError("Data da primeira parcela inválida.");

  const schedules = [];
  for (let index = 0; index < calculation.count; index++) {
    const due = localISO(addMonths(first, index));
    schedules.push(await createSchedule({
      name: `${name} · ${index + 1}/${calculation.count}`,
      kind: "installment",
      amount: calculation.installmentValue,
      currency,
      accountId,
      category,
      frequency: "once",
      nextDueDate: due,
      reminderDays: 3,
      active: true,
      autoPost: false
    }));
  }

  return { calculation, schedules };
}
