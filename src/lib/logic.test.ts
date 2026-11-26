import { describe, expect, it } from "vitest";
import { isValidImei, validateImeiPair } from "./imei";
import { parseBRLToCents, sumCents, centsToDecimal } from "./money";
import { stockCapitalCents, commercialDescription } from "./devices";

describe("IMEI", () => {
  it("accepts a valid Luhn IMEI", () => expect(isValidImei("490154203237518")).toBe(true));
  it("rejects a bad check digit", () => expect(isValidImei("490154203237519")).toBe(false));
  it("rejects identical IMEI 1 and IMEI 2", () =>
    expect(validateImeiPair("490154203237518", "490154203237518")).not.toBeNull());
});

describe("money", () => {
  it("parses BRL input to cents", () => expect(parseBRLToCents("1.234,56")).toBe(123456));
  it("sums without float drift", () => expect(centsToDecimal(sumCents(["0.10", "0.20"]))).toBe("0.30"));
  it("total cost = purchase + freight + other", () =>
    expect(sumCents(["1500.00", "35.50", "14.50"])).toBe(155000));
});

describe("stock capital", () => {
  it("counts only units still owned by the store", () => {
    const cents = stockCapitalCents(
      [
        { status: "disponivel", total_cost: "1500.00" },
        { status: "em_conferencia", total_cost: "1000.00" },
        { status: "vendido", total_cost: "9999.00" },
        { status: "devolvido_fornecedor", total_cost: "800.00" },
      ],
      [{ quantity: 3, unit_cost: "20.00" }],
    );
    expect(cents).toBe(256000);
  });
});

describe("shared description", () => {
  it("omits price when not requested", () => {
    const text = commercialDescription(
      { model: "iPhone 13", storage: "128 GB", color: "Azul", condition: "seminovo", battery_health: 88, sale_price: 3000 },
      false,
      () => "R$ 3.000,00",
    );
    expect(text).not.toContain("R$");
  });
});
