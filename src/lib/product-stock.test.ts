import { describe, expect, it } from "vitest";
import { canDeleteProduct, stockAdjustment } from "./product-stock";
describe("quantity-stock actions", () => {
  it("records 10 to 8 as a two-unit exit", () => expect(stockAdjustment(10,8,"Contagem física")).toEqual({previous_quantity:10,quantity:8,reason:"Contagem física",delta:-2}));
  it("rejects negative balances", () => expect(()=>stockAdjustment(10,-1,"Contagem")).toThrow());
  it("requires a reason", () => expect(()=>stockAdjustment(10,8," ")).toThrow());
  it("allows deletion only without balance or history", () => {
    expect(canDeleteProduct(0,false)).toBe(true);
    expect(canDeleteProduct(1,false)).toBe(false);
    expect(canDeleteProduct(0,true)).toBe(false);
  });
});