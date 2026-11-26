import type { Database } from "@/integrations/supabase/types";

export type FinancialEntry = Database["public"]["Tables"]["financial_entries"]["Row"];
export type FinancialAccount = Database["public"]["Tables"]["financial_accounts"]["Row"];
export type FinancialCategory = Database["public"]["Tables"]["financial_categories"]["Row"];
export type CreditContract = Database["public"]["Tables"]["credit_contracts"]["Row"];
export type CreditInstallment = Database["public"]["Tables"]["credit_installments"]["Row"];
export type Contract = Database["public"]["Tables"]["contracts"]["Row"];
export type ContractTemplate = Database["public"]["Tables"]["contract_templates"]["Row"];

export const ACCOUNT_TYPE_LABEL: Record<string, string> = { caixa: "Caixa", banco: "Banco", outra: "Outra conta" };
export const ENTRY_STATUS_LABEL: Record<string, string> = { pendente: "Pendente", parcial: "Parcial", pago: "Pago", cancelado: "Cancelado", estornado: "Estornado" };
export const CONTRACT_STATUS_LABEL: Record<string, string> = { ativo: "Ativo", quitado: "Quitado", renegociado: "Renegociado", cancelado: "Cancelado" };
export const INSTALLMENT_STATUS_LABEL: Record<string, string> = { aberto: "Em aberto", parcial: "Parcialmente paga", pago: "Paga", vencido: "Vencida", cancelado: "Cancelada" };
export const CONTRACT_TYPE_LABEL: Record<string, string> = {
  venda_prazo: "Contrato de venda a prazo",
  compra_pf: "Recibo/termo de compra de pessoa física",
  entrada_usado: "Recibo/termo de entrada de usado em upgrade",
  recebimento_parcela: "Comprovante de recebimento de parcela",
};
export const DOC_STATUS_LABEL: Record<string, string> = {
  modelo_pendente: "Modelo pendente de configuração",
  gerado: "Documento gerado",
  aguardando_assinatura: "Aguardando assinatura",
  assinado_anexado: "Arquivo assinado anexado",
  verificado: "Assinaturas verificadas",
};

/** Adds months to an ISO date, clamping the day to the last day of the target month (31/01 + 1 mês → 28/02). */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export type ScheduleItem = { number: number; dueDate: string; amountCents: number };

/**
 * No-interest installment schedule in integer cents: equal installments with the
 * cent remainder on the last one. The sum always equals the financed principal.
 * Example: 2400.00 in 6x → 6 × 400.00. Example: 1000.00 in 3x → 333.33, 333.33, 333.34.
 */
export function buildSchedule(principalCents: number, count: number, firstDue: string): ScheduleItem[] {
  if (count < 1 || principalCents <= 0) return [];
  const base = Math.floor(principalCents / count);
  const last = principalCents - base * (count - 1);
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    dueDate: addMonthsClamped(firstDue, i),
    amountCents: i === count - 1 ? last : base,
  }));
}

/** Effective installment status: "vencido" is computed from the due date, never stored. */
export function installmentStatus(
  inst: { status: string; due_date: string },
  today: string,
): string {
  if (inst.status === "cancelado" || inst.status === "pago") return inst.status;
  if (inst.due_date < today) return "vencido";
  return inst.status;
}

/** Account balance in cents: initial balance + paid entries - paid exits. Pending/reversed/cancelled never count. */
export function accountBalanceCents(
  account: { initial_balance: number | string },
  entries: Array<{ account_id: string | null; kind: string; status: string; paid_amount: number | string }>,
  accountId: string,
  toCents: (v: number | string | null) => number,
): number {
  let bal = toCents(account.initial_balance);
  for (const e of entries) {
    if (e.account_id !== accountId || e.status !== "pago") continue;
    bal += e.kind === "entrada" ? toCents(e.paid_amount) : -toCents(e.paid_amount);
  }
  return bal;
}
