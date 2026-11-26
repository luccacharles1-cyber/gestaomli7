import { describe, expect, it } from "vitest";
import { needsApproval, suggestedCents, whatsappUrl } from "./crm";

describe("avaliação de usados", () => {
  it("soma ajustes fixos ao valor de referência", () => {
    expect(suggestedCents("2000.00", ["-150.00", "-200.00"])).toBe(165000);
  });
  it("nunca sugere valor negativo", () => {
    expect(suggestedCents("100.00", ["-300.00"])).toBe(0);
  });
  it("sem referência exige aprovação", () => {
    expect(suggestedCents(null, [])).toBeNull();
    expect(needsApproval(null, 100000)).toBe(true);
  });
  it("valor acima do sugerido exige aprovação; igual ou abaixo não", () => {
    expect(needsApproval(165000, 165001)).toBe(true);
    expect(needsApproval(165000, 165000)).toBe(false);
  });
});

describe("whatsapp", () => {
  it("adiciona DDI do Brasil", () => {
    expect(whatsappUrl("(11) 98888-7777")).toBe("https://wa.me/5511988887777");
    expect(whatsappUrl("123")).toBeNull();
  });
});
