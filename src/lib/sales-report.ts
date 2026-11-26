import { formatBRL, toCents } from "./money";
import { TZ } from "./format";

export type ReportSale = { id: string; created_at: string; receipt_number: number | null; seller_id: string | null; status: string; total: number; trade_in_value: number; amount_received: number; balance: number };
export type ReportItem = { sale_id: string; device_id: string; model: string; storage: string | null; cost: number | null; quantity?: number; unitPrice?: number; subtotal?: number };
export type ReportEntry = { sale_id: string | null; contract_id: string | null; method: string | null; kind: string; status: string; paid_amount: number; is_refund: boolean; reversal_of: string | null };
export type ReportPayment = { sale_id: string; method: string; amount: number };

export function reportRange(period: string, from: string, to: string, now = new Date()) {
  const today = now.toLocaleDateString("en-CA", { timeZone: TZ });
  let start = from, end = to;
  if (period === "hoje") start = end = today;
  else if (period === "7d") { start = new Date(new Date(`${today}T12:00:00-03:00`).getTime() - 6 * 86400000).toLocaleDateString("en-CA", { timeZone: TZ }); end = today; }
  else if (period !== "custom") { start = `${today.slice(0, 7)}-01`; end = today; }
  if (![start, end].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))) || start > end) throw new Error("Informe um período válido; o início deve ser anterior ao fim.");
  return { from: start, to: end, gte: `${start}T00:00:00-03:00`, lte: `${end}T23:59:59.999-03:00` };
}

export function salesReport(sales: ReportSale[], items: ReportItem[], entries: ReportEntry[], payments: ReportPayment[], costsAllowed: boolean, financeAllowed: boolean, seller = "", model = "") {
  const rows = sales.filter(s => (!seller || s.seller_id === seller) && (!model || items.some(i => i.sale_id === s.id && i.model === model))).map(s => {
    // Model filters select whole sales, not fragments: discounts and totals remain consistent.
    const devices = items.filter(i => i.sale_id === s.id);
    const paid = entries.filter(e => e.sale_id === s.id && e.status === "pago" && !e.reversal_of);
    const creditPaid = paid.filter(e => e.kind === "entrada" && e.contract_id).reduce((sum,e) => sum + toCents(e.paid_amount), 0);
    const cardAccepted = payments.filter(p => p.sale_id === s.id && ["cartao_credito", "cartao_debito"].includes(p.method)).reduce((sum,p) => sum + toCents(p.amount), 0);
    const cardPaid = paid.filter(e => !e.contract_id && e.kind === "entrada" && ["cartao_credito", "cartao_debito"].includes(e.method ?? "")).reduce((sum,e) => sum + toCents(e.paid_amount),0);
    const refunded = paid.filter(e => e.kind === "saida" && e.is_refund).reduce((sum,e) => sum + toCents(e.paid_amount),0);
    const active = s.status === "concluida";
    const revenue = active ? toCents(s.total) : 0;
    const missingCosts = costsAllowed && active ? devices.filter(i => i.cost == null).map(i => `${i.model}${i.storage ? ` ${i.storage}` : ""}`) : [];
    return { id:s.id, date:s.created_at, number:s.receipt_number, sellerId:s.seller_id, status:s.status, devices:devices.map(i => `${i.quantity ? `${i.quantity}x ` : ""}${i.model}${i.storage ? ` ${i.storage}` : ""}${i.unitPrice != null ? ` · ${formatBRL(i.unitPrice)} un. · Subtotal: ${formatBRL(i.subtotal ?? 0)}` : ""}`), count:active ? devices.reduce((sum,i)=>sum+(i.quantity ?? 1),0) : 0, revenue, tradeIn:toCents(s.trade_in_value), received:financeAllowed ? toCents(s.amount_received) + creditPaid - cardAccepted + cardPaid - refunded : null, pending:financeAllowed ? (active ? Math.max(0,toCents(s.balance) - creditPaid) : 0) : null, profit:costsAllowed && active ? revenue - devices.reduce((sum,i) => sum + toCents(i.cost) * (i.quantity ?? 1),0) : null, missingCosts };
  });
  const completed = rows.filter(r => r.status === "concluida");
  const revenue = completed.reduce((sum,r) => sum+r.revenue,0);
  const profit = costsAllowed ? completed.reduce((sum,r) => sum+(r.profit ?? 0),0) : null;
  return { rows, summary: { revenue, sales:completed.length, devices:completed.reduce((sum,r) => sum+r.count,0), ticket:completed.length ? Math.round(revenue/completed.length) : 0, profit, margin:profit != null && revenue ? profit/revenue*100 : null, incomplete:completed.filter(r => r.missingCosts.length).length }, sellers: [...new Set(completed.map(r=>r.sellerId))].map(id=>({id, devices:completed.filter(r=>r.sellerId===id).reduce((sum,r)=>sum+r.count,0), revenue:completed.filter(r=>r.sellerId===id).reduce((sum,r)=>sum+r.revenue,0)})) };
}