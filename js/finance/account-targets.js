export function calculateAmountToZero(balance) {
  const value = Number(balance);
  if (!Number.isFinite(value)) {
    throw new TypeError("Saldo inválido para cálculo de ajuste.");
  }

  if (value < 0) {
    return { direction: "deposit", amount: Math.abs(value), targetBalance: 0 };
  }

  if (value > 0) {
    return { direction: "withdraw", amount: value, targetBalance: 0 };
  }

  return { direction: "none", amount: 0, targetBalance: 0 };
}

export function calculateAmountToTarget(balance, target) {
  const current = Number(balance);
  const desired = Number(target);
  if (!Number.isFinite(current) || !Number.isFinite(desired)) {
    throw new TypeError("Saldo ou meta inválidos.");
  }

  const difference = desired - current;
  return {
    direction: difference > 0 ? "deposit" : difference < 0 ? "withdraw" : "none",
    amount: Math.abs(difference),
    targetBalance: desired
  };
}
