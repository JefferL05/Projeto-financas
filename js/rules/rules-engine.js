import { normalizeRecord } from "../db.js";

const ALLOWED_CONDITION_FIELDS = new Set(["description", "category", "currency", "type", "amount", "accountId"]);
const ALLOWED_OPERATORS = new Set(["contains", "startsWith", "equals", "gt", "gte", "lt", "lte"]);
const ALLOWED_ACTION_FIELDS = new Set(["category", "accountId", "tags", "description"]);

function normalize(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function matchesCondition(transaction, condition) {
  if (!ALLOWED_CONDITION_FIELDS.has(condition.field) || !ALLOWED_OPERATORS.has(condition.operator)) return false;
  const actual = transaction[condition.field];
  const expected = condition.value;

  if (["gt", "gte", "lt", "lte"].includes(condition.operator)) {
    const left = Number(actual);
    const right = Number(expected);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (condition.operator === "gt") return left > right;
    if (condition.operator === "gte") return left >= right;
    if (condition.operator === "lt") return left < right;
    return left <= right;
  }

  const left = normalize(actual);
  const right = normalize(expected);
  if (condition.operator === "contains") return left.includes(right);
  if (condition.operator === "startsWith") return left.startsWith(right);
  return left === right;
}

export function ruleMatches(transaction, rule) {
  if (!rule?.enabled || !Array.isArray(rule.conditions) || !rule.conditions.length) return false;
  return rule.conditions.every((condition) => matchesCondition(transaction, condition));
}

function applyAction(transaction, action) {
  if (!ALLOWED_ACTION_FIELDS.has(action.field)) return transaction;

  if (action.field === "tags") {
    const tags = Array.isArray(action.value) ? action.value : [action.value];
    return {
      ...transaction,
      tags: [...new Set([...(transaction.tags || []), ...tags.map((item) => String(item).slice(0, 40))])].slice(0, 12)
    };
  }

  return { ...transaction, [action.field]: action.value };
}

export function simulateRules(transactions = [], rules = []) {
  const activeRules = [...rules]
    .filter((rule) => rule.enabled !== false)
    .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));

  return transactions.map((transaction) => {
    let result = { ...transaction };
    const matchedRuleIds = [];

    for (const rule of activeRules) {
      if (!ruleMatches(result, rule)) continue;
      matchedRuleIds.push(rule.id);
      for (const action of rule.actions || []) result = applyAction(result, action);
    }

    return {
      original: transaction,
      result,
      matchedRuleIds,
      changed: JSON.stringify(transaction) !== JSON.stringify(result)
    };
  });
}

export function validateRule(rule) {
  if (!rule || !Array.isArray(rule.conditions) || !Array.isArray(rule.actions)) return false;
  if (!rule.conditions.length || !rule.actions.length) return false;
  return rule.conditions.every((condition) => ALLOWED_CONDITION_FIELDS.has(condition.field) && ALLOWED_OPERATORS.has(condition.operator))
    && rule.actions.every((action) => ALLOWED_ACTION_FIELDS.has(action.field));
}

export function previewRule(rule, transactions) {
  if (!validateRule(rule)) throw new TypeError("Regra inválida.");
  const matches = simulateRules(transactions, [rule]).filter((item) => item.changed);
  return {
    ruleId: rule.id,
    matchCount: matches.length,
    matches
  };
}

export function buildRuleApplicationHistory(rule, preview) {
  return {
    id: `rule-history-${Date.now()}`,
    ruleId: rule.id,
    appliedAt: new Date().toISOString(),
    changedIds: preview.matches.map((item) => item.original.id),
    before: preview.matches.map((item) => item.original),
    after: preview.matches.map((item) => normalizeRecord("transactions", item.result))
  };
}
