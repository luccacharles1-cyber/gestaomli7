import { describe, expect, it } from "vitest";
import { accessBlocked, contractedMrrCents } from "./platform";

const now = new Date("2026-11-05T12:00:00Z");

describe("acesso da loja", () => {
  it("loja legada sem assinatura configurada continua liberada", () => {
    expect(accessBlocked({ access_status: "active", billing_status: "legacy", access_until: null }, now)).toBe(false);
    expect(accessBlocked(null, now)).toBe(false);
  });
  it("suspensão bloqueia", () => {
    expect(accessBlocked({ access_status: "suspended", billing_status: "active", access_until: null }, now)).toBe(true);
  });
  it("teste ou cortesia vencidos bloqueiam; dentro da validade, não", () => {
    expect(accessBlocked({ access_status: "active", billing_status: "trial", access_until: "2026-11-01T00:00:00Z" }, now)).toBe(true);
    expect(accessBlocked({ access_status: "active", billing_status: "courtesy", access_until: "2026-12-01T00:00:00Z" }, now)).toBe(false);
  });
});

describe("receita recorrente contratada", () => {
  it("exclui teste, cortesia, legado e renovação cancelada", () => {
    expect(contractedMrrCents([
      { billing_status: "active", renewal_canceled: false, contracted_price: "99.90" },
      { billing_status: "courtesy", renewal_canceled: false, contracted_price: "99.90" },
      { billing_status: "trial", renewal_canceled: false, contracted_price: "99.90" },
      { billing_status: "legacy", renewal_canceled: false, contracted_price: null },
      { billing_status: "active", renewal_canceled: true, contracted_price: "149.90" },
    ])).toBe(9990);
  });
});
