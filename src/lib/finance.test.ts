import { describe, expect, it } from "vitest";
import { addMonthsClamped, accountBalanceCents, buildSchedule, installmentStatus } from "./finance";
import { toCents } from "./money";

describe("crediário sem juros", () => {
  it("exemplo obrigatório: venda de R$ 3.000, entrada de R$ 600, 6 parcelas de R$ 400", () => {
    // Principal financiado = 3000 - 600 = 2400
    const schedule = buildSchedule(240000, 6, "2026-12-10");
    expect(schedule).toHaveLength(6);
    for (const p of schedule) expect(p.amountCents).toBe(40000);
    expect(schedule.reduce((a, p) => a + p.amountCents, 0)).toBe(240000);
  });

  it("diferença de centavos fica explicitamente na última parcela", () => {
    const schedule = buildSchedule(100000, 3, "2026-01-10");
    expect(schedule.map((p) => p.amountCents)).toEqual([33333, 33333, 33334]);
    expect(schedule.reduce((a, p) => a + p.amountCents, 0)).toBe(100000);
  });

  it("vencimento em mês sem o dia escolhido usa o último dia do mês", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
    const schedule = buildSchedule(30000, 3, "2026-01-31");
    expect(schedule.map((p) => p.dueDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("parcela com saldo após o vencimento fica vencida; paga e cancelada não mudam", () => {
    expect(installmentStatus({ status: "aberto", due_date: "2026-01-01" }, "2026-01-02")).toBe("vencido");
    expect(installmentStatus({ status: "parcial", due_date: "2026-01-01" }, "2026-01-02")).toBe("vencido");
    expect(installmentStatus({ status: "aberto", due_date: "2026-01-02" }, "2026-01-02")).toBe("aberto");
    expect(installmentStatus({ status: "pago", due_date: "2026-01-01" }, "2026-01-02")).toBe("pago");
    expect(installmentStatus({ status: "cancelado", due_date: "2026-01-01" }, "2026-01-02")).toBe("cancelado");
  });
});

describe("saldo de conta", () => {
  it("saldo inicial + entradas pagas - saídas pagas; pendente e estornado não contam", () => {
    const entries = [
      { account_id: "a", kind: "entrada", status: "pago", paid_amount: 100 },
      { account_id: "a", kind: "saida", status: "pago", paid_amount: 30 },
      { account_id: "a", kind: "entrada", status: "pendente", paid_amount: 0 },
      { account_id: "a", kind: "entrada", status: "estornado", paid_amount: 50 },
      { account_id: "b", kind: "entrada", status: "pago", paid_amount: 999 },
    ];
    expect(accountBalanceCents({ initial_balance: 10 }, entries, "a", toCents)).toBe(1000 + 10000 - 3000);
  });
});
