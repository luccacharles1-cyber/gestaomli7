export const TZ = "America/Sao_Paulo";

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return d.toLocaleDateString("pt-BR", { timeZone: TZ });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
}

/** Today in São Paulo as YYYY-MM-DD. */
export function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}
