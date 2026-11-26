/** Digits-only E.164 key used to match contacts and avoid duplicates (Brazil DDI added to local numbers). */
export function normalizePhone(phone: string | null | undefined): string | null {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.length <= 11) d = `55${d}`;
  return d;
}

/** Meta allows free-form replies only within 24h of the customer's last message. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;
export function windowOpen(lastInboundAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastInboundAt) return false;
  return now - new Date(lastInboundAt).getTime() < WINDOW_MS;
}

/** Number of positional {{n}} variables in a template body. */
export function templateVarCount(body: string | null | undefined): number {
  const nums = [...(body ?? "").matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

export const MSG_STATUS_LABEL: Record<string, string> = {
  pending: "Pendente", accepted: "Aceita pela Meta", sent: "Enviada", delivered: "Entregue",
  read: "Lida", failed: "Falhou", unknown: "Resultado incerto", received: "Recebida",
};

export const SUPPORTED_TYPES = ["text", "image", "button", "interactive"];
