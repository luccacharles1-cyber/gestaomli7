import { parseBRLToCents } from "./money";

export function signedAdjustmentCents(input: string): number | null {
  const value = input.trim();
  const negative = value.startsWith("-");
  const cents = parseBRLToCents(negative ? value.slice(1) : value);
  return cents == null ? null : negative ? -cents : cents;
}

export function evaluationActions(
  evaluation: { archived: boolean; sale_id: string | null; status: string; created_by: string },
  permissions: { userId: string; registerSales: boolean; approve: boolean; manageTeam: boolean },
) {
  const allowed = !evaluation.archived && permissions.registerSales &&
    (evaluation.created_by === permissions.userId || permissions.approve || permissions.manageTeam);
  const used = evaluation.sale_id != null || evaluation.status === "utilizada";
  return { edit: allowed && !used, delete: allowed && !used, archive: allowed && used };
}