import type { Database } from "@/integrations/supabase/types";

export type PaymentMethod = Database["public"]["Enums"]["payment_method"];
export type SaleStatus = Database["public"]["Enums"]["sale_status"];
export type Sale = Database["public"]["Tables"]["sales"]["Row"];

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  crediario: "Crediário próprio",
  outro: "Outro",
};

export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export type SaleTotals = {
  itemsCents: number;
  discountCents: number;
  totalCents: number;
  tradeInCents: number;
  receivedCents: number;
  balanceCents: number;
};

/**
 * Sale math in integer cents.
 * Revenue (faturamento) = items - discount. The trade-in is an acquisition, never
 * a discount and never cash; only payments count as money in.
 * Example: items 4000, trade-in 1500, pix 2500 → total 4000, received 2500, balance 0.
 */
export function saleTotals(
  itemPricesCents: number[],
  discountCents: number,
  tradeInCents: number,
  paymentCents: number[],
): SaleTotals {
  const itemsCents = itemPricesCents.reduce((a, b) => a + b, 0);
  const totalCents = itemsCents - discountCents;
  const receivedCents = paymentCents.reduce((a, b) => a + b, 0);
  const balanceCents = totalCents - tradeInCents - receivedCents;
  return { itemsCents, discountCents, totalCents, tradeInCents, receivedCents, balanceCents };
}

/** Client-side pre-validation mirroring the server rules (server is authoritative). */
export function validateSaleTotals(t: SaleTotals): string | null {
  if (t.itemsCents <= 0) return "A venda precisa de ao menos um item válido.";
  if (t.discountCents < 0) return "Desconto inválido.";
  if (t.totalCents < 0) return "O desconto não pode ser maior que o total.";
  if (t.balanceCents < 0) return "Pagamentos e troca excedem o total da venda.";
  return null;
}

export function validateProductQuantity(quantity: number, available: number): string | null {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return "Quantidade deve ser inteira e maior que zero.";
  if (quantity > available) return "Quantidade acima do saldo disponível.";
  return null;
}
