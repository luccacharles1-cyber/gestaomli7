import { describe, expect, it } from "vitest";
import { evaluationActions, signedAdjustmentCents } from "./evaluation-actions";

const row = { archived: false, sale_id: null, status: "aprovada", created_by: "seller" };
const seller = { userId: "seller", registerSales: true, approve: false, manageTeam: false };

describe("evaluation record actions", () => {
  it("preserves a -150,00 discount as negative 15000 cents", () => {
    expect(signedAdjustmentCents("-150,00")).toBe(-15000);
    expect(signedAdjustmentCents("150,00")).toBe(15000);
    expect(signedAdjustmentCents("--150,00")).toBeNull();
  });
  it("allows editing and deleting an unused own evaluation", () => {
    expect(evaluationActions(row, seller)).toEqual({ edit: true, delete: true, archive: false });
  });
  it("offers only archive for an evaluation linked to a sale", () => {
    expect(evaluationActions({ ...row, sale_id: "sale", status: "utilizada" }, seller)).toEqual({ edit: false, delete: false, archive: true });
  });
  it("never offers destructive actions for an archived record", () => {
    expect(evaluationActions({ ...row, archived: true }, seller)).toEqual({ edit: false, delete: false, archive: false });
  });
  it("blocks another seller and permits the existing approval permission", () => {
    expect(evaluationActions(row, { ...seller, userId: "other" }).edit).toBe(false);
    expect(evaluationActions(row, { ...seller, userId: "owner", approve: true }).edit).toBe(true);
    expect(evaluationActions(row, { ...seller, registerSales: false }).delete).toBe(false);
  });
});