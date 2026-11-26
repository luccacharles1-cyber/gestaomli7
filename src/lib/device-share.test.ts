import { describe, expect, it } from "vitest";
import { deviceShareText } from "./device-share";

const device = { model: "iPhone 13", storage: "128 GB", color: "Azul", condition: "seminovo" as const, battery_health: 90, sale_price: 2500.5, notes: "Segredo interno", origin_name: "Fornecedor privado", purchase_cost: 1200, margin: 1300.5 };

describe("commercial device sharing", () => {
  it("shares registered commercial details and sale price in reais, never private fields", () => {
    expect(deviceShareText(device, true, true).text).toBe("iPhone 13 128 GB Azul • Seminovo • Bateria 90%\nR$\u00a02.500,50");
  });
  it("includes price independently when description is deselected", () => {
    expect(deviceShareText(device, false, true).text).toBe("R$\u00a02.500,50");
  });
  it("omits deselected price", () => {
    expect(deviceShareText(device, true, false).text).toBe("iPhone 13 128 GB Azul • Seminovo • Bateria 90%");
  });
  it("shares no commercial text when both options are deselected", () => {
    expect(deviceShareText(device, false, false).text).toBe("");
  });
  it("omits missing fields instead of inventing content", () => {
    expect(deviceShareText({ ...device, model: " ", sale_price: null }, true, true)).toEqual({ text: "", omitted: ["Descrição comercial não cadastrada; será omitida.", "Preço de venda não cadastrado; será omitido."] });
  });
  it("keeps a registered zero price", () => {
    expect(deviceShareText({ ...device, sale_price: 0 }, false, true).text).toBe("R$\u00a00,00");
  });
});