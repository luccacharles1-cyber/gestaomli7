export const BILLING_LABEL: Record<string, string> = {
  legacy: "Acesso legado (sem assinatura)",
  trial: "Teste",
  courtesy: "Cortesia",
  active: "Assinatura paga",
  past_due: "Pagamento atrasado",
  canceled: "Cancelada",
  none: "Sem assinatura",
};
export const ACCESS_LABEL: Record<string, string> = { active: "Liberado", suspended: "Suspenso" };

export type AccessSub = { access_status: string; billing_status: string; access_until: string | null } | null | undefined;

/** Mirrors public.store_access_ok: suspended, or an expired trial/courtesy, blocks store operations. Missing row = legacy access. */
export function accessBlocked(sub: AccessSub, now: Date = new Date()): boolean {
  if (!sub) return false;
  if (sub.access_status === "suspended") return true;
  return (sub.billing_status === "trial" || sub.billing_status === "courtesy") && !!sub.access_until && new Date(sub.access_until) < now;
}

/** Contracted MRR counts only paid subscriptions with renewal on and a contracted price — never trials, courtesies or legacy stores. */
export function contractedMrrCents(subs: Array<{ billing_status: string; renewal_canceled: boolean; contracted_price: string | number | null }>): number {
  return subs
    .filter((s) => s.billing_status === "active" && !s.renewal_canceled && s.contracted_price != null)
    .reduce((a, s) => a + Math.round(Number(s.contracted_price) * 100), 0);
}
