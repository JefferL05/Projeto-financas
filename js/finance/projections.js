export function monthlyProjection(expense, period, now = new Date()) {
  const start = new Date(`${period.start}T00:00:00`);
  const end = new Date(`${period.end}T00:00:00`);
  const isCurrentMonth = start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth();
  const elapsed = isCurrentMonth ? Math.max(1, now.getDate()) : Math.max(1, Math.round((end - start) / 86400000) + 1);
  const totalDays = isCurrentMonth ? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() : elapsed;
  const dailyAverage = Number(expense || 0) / elapsed;
  return {
    dailyAverage,
    projectedExpense: dailyAverage * totalDays,
    elapsedDays: elapsed,
    totalDays,
    approximate: isCurrentMonth
  };
}

export function goalProjection(goal, now = new Date()) {
  const target = Number(goal.target || 0);
  const current = Number(goal.current || 0);
  const monthly = Number(goal.monthly || 0);
  const remaining = Math.max(0, target - current);
  const end = new Date(`${goal.targetDate}T00:00:00`);
  const monthsRemaining = Math.max(0, (end.getFullYear() - now.getFullYear()) * 12 + end.getMonth() - now.getMonth());
  const requiredMonthly = remaining === 0 ? 0 : monthsRemaining > 0 ? remaining / monthsRemaining : remaining;
  const monthsAtCurrentPace = remaining === 0 ? 0 : monthly > 0 ? Math.ceil(remaining / monthly) : null;
  const estimatedDate = monthsAtCurrentPace === null ? null : new Date(now.getFullYear(), now.getMonth() + monthsAtCurrentPace, 1).toISOString().slice(0, 10);
  return {
    remaining,
    progressPercent: target > 0 ? Math.min(100, current / target * 100) : 0,
    monthsRemaining,
    requiredMonthly,
    monthsAtCurrentPace,
    estimatedDate,
    completed: remaining <= 0,
    overdue: end < now && remaining > 0
  };
}
