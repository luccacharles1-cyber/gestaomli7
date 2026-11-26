import { toCents } from "./money";

export const STAGES = ["novo", "atendimento", "proposta", "negociacao", "concluida", "perdida"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  novo: "Novo contato",
  atendimento: "Atendimento",
  proposta: "Proposta enviada",
  negociacao: "Negociação",
  concluida: "Concluída",
  perdida: "Perdida",
};

export const ADJ_KINDS = ["bateria", "conservacao", "pecas", "defeitos"] as const;
export type AdjKind = (typeof ADJ_KINDS)[number];
export const ADJ_LABEL: Record<AdjKind, string> = {
  bateria: "Bateria",
  conservacao: "Conservação",
  pecas: "Peças trocadas",
  defeitos: "Defeitos",
};

export const EVAL_STATUS_LABEL: Record<string, string> = {
  aprovada: "Aprovada",
  pendente: "Aguardando aprovação",
  recusada: "Recusada",
  utilizada: "Usada em venda",
};

/** Mirrors the server: suggested = max(0, reference + Σ adjustments); null when there is no reference. */
export function suggestedCents(reference: string | number | null, adjustments: Array<string | number>): number | null {
  if (reference == null) return null;
  return Math.max(0, toCents(reference) + adjustments.reduce<number>((a, v) => a + toCents(v), 0));
}

/** Approval needed when there is no reference or the offer exceeds the suggestion. */
export function needsApproval(suggested: number | null, offeredCents: number): boolean {
  return suggested == null || offeredCents > suggested;
}

export function whatsappUrl(phone: string | null | undefined): string | null {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.length <= 11) d = `55${d}`;
  return `https://wa.me/${d}`;
}
