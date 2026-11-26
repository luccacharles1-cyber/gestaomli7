import { describe, expect, it } from "vitest";
import { normalizePhone, templateVarCount, windowOpen, WINDOW_MS } from "./whatsapp";

describe("whatsapp", () => {
  it("normaliza o número para evitar contatos duplicados", () => {
    expect(normalizePhone("(31) 9208-4578")).toBe("553192084578");
    expect(normalizePhone("+55 31 99208-4578")).toBe("5531992084578");
    expect(normalizePhone("123")).toBeNull();
  });
  it("janela de 24 horas após a última mensagem do cliente", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    expect(windowOpen(new Date(now - WINDOW_MS + 1000).toISOString(), now)).toBe(true);
    expect(windowOpen(new Date(now - WINDOW_MS).toISOString(), now)).toBe(false);
    expect(windowOpen(null, now)).toBe(false);
  });
  it("conta variáveis do modelo", () => {
    expect(templateVarCount("Pedido {{1}} chega {{2}}")).toBe(2);
    expect(templateVarCount("Olá")).toBe(0);
  });
});
