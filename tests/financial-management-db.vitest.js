import { describe, expect, test } from "vitest";
import { normalizeRecord } from "../js/db.js";

describe("persistência do plano de gestão financeira", () => {
  test("aceita o plano local usando o store settings existente", () => {
    const record = normalizeRecord("settings", {
      key: "financialManagementPlan",
      value: {
        actions: [{ id: "action-budget-food", status: "concluida" }],
        scenario: { incomeChangePercent: 5 },
        futureExpenses: [{ id: "planned_1", name: "Seguro", amount: 100 }]
      }
    });
    expect(record.key).toBe("financialManagementPlan");
    expect(record.value.actions[0].status).toBe("concluida");
    expect(record.value.scenario.incomeChangePercent).toBe(5);
    expect(record.value.futureExpenses).toHaveLength(1);
  });

  test("normaliza estados desconhecidos e rejeita payloads inválidos", () => {
    const record = normalizeRecord("settings", {
      key: "financialManagementPlan",
      value: { actions: [{ id: "action-1", status: "apagar-tudo" }] }
    });
    expect(record.value.actions[0].status).toBe("pendente");
    expect(() => normalizeRecord("settings", { key: "financialManagementPlan", value: [] })).toThrow();
    expect(() => normalizeRecord("settings", { key: "financialManagementPlan", value: { actions: [{ id: "id com espaços" }] } })).toThrow();
  });
});
