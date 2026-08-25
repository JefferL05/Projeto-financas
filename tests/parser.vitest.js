import { describe, expect, test } from "vitest";
import { parseSmartInput } from "../js/parser.js";

describe("importação rápida", () => {
  test("interpreta gastos em guaranis", () => {
    const result = parseSmartInput("-83.467 mercado\n-90.000 almoço", "PYG");

    expect(result).toEqual([
      expect.objectContaining({
        type: "expense",
        currency: "PYG",
        amount: 83467,
        category: "Mercado",
        description: "mercado"
      }),
      expect.objectContaining({
        type: "expense",
        currency: "PYG",
        amount: 90000,
        category: "Alimentação",
        description: "almoço"
      })
    ]);
  });

  test("interpreta receitas e despesas em reais", () => {
    const result = parseSmartInput("Recebi 420 reais\n-22,50 mercado", "BRL");

    expect(result[0]).toMatchObject({
      type: "income",
      currency: "BRL",
      amount: 420
    });
    expect(result[1]).toMatchObject({
      type: "expense",
      currency: "BRL",
      amount: 22.5,
      category: "Mercado"
    });
  });

  test("alterna a moeda quando encontra cabeçalhos", () => {
    const result = parseSmartInput("Guaranis\n-50.000 mercado\nReais\n-25 gasolina", "PYG");

    expect(result[0].currency).toBe("PYG");
    expect(result[1].currency).toBe("BRL");
  });

  test("não interpreta HTML como código", () => {
    const result = parseSmartInput('-10 <img src=x onerror="alert(1)">', "BRL");

    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(10);
    expect(result[0].description).toContain("<img");
  });

  test("ignora linhas sem valor válido", () => {
    expect(parseSmartInput("mercado\nsem valor\n-0 almoço", "PYG")).toEqual([]);
  });
});
