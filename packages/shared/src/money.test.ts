import { describe, expect, it } from "vitest";
import { addCentavos, formatCentavos, pesosToCentavos } from "./money.js";

describe("money", () => {
  it("converts pesos to centavos without floats", () => {
    expect(pesosToCentavos("100.50")).toBe(10050n);
    expect(pesosToCentavos("-1.05")).toBe(-105n);
  });

  it("formats centavos for display", () => {
    const formatted = formatCentavos(12345n);
    expect(formatted).toContain("123.45");
  });

  it("adds centavos", () => {
    expect(addCentavos(100n, 250n, -50n)).toBe(300n);
  });
});
