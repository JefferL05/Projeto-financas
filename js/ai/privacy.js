const PRIVACY_KEY = "ProjetoFinancasAIPrivacy";

export const PRIVACY_LEVELS = {
  LOCAL: "local",
  AGGREGATED: "aggregated",
  SELECTED_DETAILS: "selected_details"
};

export function getPrivacySettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRIVACY_KEY) || "{}");
    return {
      level: Object.values(PRIVACY_LEVELS).includes(saved.level) ? saved.level : PRIVACY_LEVELS.LOCAL,
      onlineEnabled: Boolean(saved.onlineEnabled),
      consentAt: saved.consentAt || null
    };
  } catch {
    return { level: PRIVACY_LEVELS.LOCAL, onlineEnabled: false, consentAt: null };
  }
}

export function savePrivacySettings(settings) {
  const safe = {
    level: Object.values(PRIVACY_LEVELS).includes(settings.level) ? settings.level : PRIVACY_LEVELS.LOCAL,
    onlineEnabled: Boolean(settings.onlineEnabled),
    consentAt: settings.onlineEnabled ? (settings.consentAt || new Date().toISOString()) : null
  };
  localStorage.setItem(PRIVACY_KEY, JSON.stringify(safe));
  return safe;
}

export function canUseOnlineAI(settings = getPrivacySettings()) {
  return settings.onlineEnabled && settings.level !== PRIVACY_LEVELS.LOCAL && Boolean(settings.consentAt);
}

export function minimizeFinancialContext(context, level) {
  const base = {
    period: context.period,
    transactionCount: context.transactionCount,
    incomePYG: context.incomePYG,
    expensePYG: context.expensePYG,
    balancePYG: context.balancePYG,
    savingsRate: context.savingsRate,
    comparison: context.comparison,
    projection: context.projection,
    categories: context.categories?.slice(0, 8),
    originalByCurrency: context.originalByCurrency,
    rate: context.rate,
    approximate: context.approximate
  };

  if (level === PRIVACY_LEVELS.SELECTED_DETAILS) {
    base.recurring = context.recurring?.slice(0, 5).map(({ transactionIds, ...item }) => item);
    base.anomalies = context.anomalies?.slice(0, 5).map(({ transactionId, ...item }) => item);
    base.goals = context.goals?.slice(0, 5).map(({ goal, projection }) => ({
      goal: { name: goal.name, currency: goal.currency, target: goal.target, current: goal.current, targetDate: goal.targetDate },
      projection
    }));
  }
  return base;
}
