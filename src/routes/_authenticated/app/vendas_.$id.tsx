import { SaleDocuments } from "@/components/app/SaleDocuments";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Ban, HandCoins, Loader2, Printer, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";
import { PAYMENT_LABEL, SALE_STATUS_LABEL } from "@/lib/sales";
import { ENTRY_STATUS_LABEL, INSTALLMENT_STATUS_LABEL, buildSchedule, installmentStatus, type CreditContract, type CreditInstallment, type FinancialAccount, type FinancialEntry } from "@/lib/finance";
import { formatBRL, formatCents, parseBRLToCents, toCents } from "@/lib/money";
import { formatDate, formatDateTime, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/app/vendas_/$id")({
  head: () => ({ meta: [{ title: "Venda — MLI Gestão" }, { name: "description", content: "Detalhes da venda e recibo." }, { property: "og:title", content: "Venda — MLI Gestão" }, { property: "og:description", content: "Detalhes da venda e recibo." },{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"}] }),
  component: VendaPage,
});

type Snapshot = {
  store?: { name?: string; legal_name?: string; document?: string; phone?: string; email?: string; address?: string; warranty_text?: string };
  client?: { name?: string; document?: string; whatsapp?: string; email?: string; address?: string } | null;
  items?: Array<{ model: string; storage?: string; color?: string; imei1?: string; imei2?: string; serial_number?: string; condition?: string; price: string }>;
  trade_in?: { model: string; storage?: string; color?: string; imei1?: string; imei2?: string; condition?: string; agreed_value: string } | null;
  payments?: Array<{ method: keyof typeof PAYMENT_LABEL; amount: string; installments?: number | null }>;
};

function VendaPage() {
  const { id } = Route.useParams();
  const { store, perms } = useStore();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [reverseEntry, setReverseEntry] = useState<FinancialEntry | null>(null);

  const key = ["sale", id];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [s, items, pays, trade, events, entries, contract, accounts, products, evaluations] = await Promise.all([
        supabase.from("sales").select("*, clients(name, document, whatsapp)").eq("id", id).eq("store_id", store.id).maybeSingle(),
        supabase.from("sale_items").select("*, devices(model, storage, color, imei1, imei2, condition)").eq("sale_id", id),
        supabase.from("sale_payments").select("*").eq("sale_id", id).order("created_at"),
        supabase.from("sale_trade_ins").select("*, devices(model, storage, imei1, imei2, condition, status)").eq("sale_id", id),
        supabase.from("sale_events").select("*").eq("sale_id", id).order("created_at"),
        perms.viewFinance ? supabase.from("financial_entries").select("*").eq("sale_id", id).order("created_at") : Promise.resolve({ data: [] }),
        perms.viewFinance ? supabase.from("credit_contracts").select("*, credit_installments(*)").eq("sale_id", id).maybeSingle() : Promise.resolve({ data: null }),
        perms.viewFinance ? supabase.from("financial_accounts").select("*").eq("store_id", store.id).eq("active", true) : Promise.resolve({ data: [] }),
        supabase.from("sale_product_items").select("*").eq("store_id", store.id).eq("sale_id", id),
        supabase.from("evaluations").select("*").eq("store_id",store.id).eq("sale_id",id),
      ]);
      if (products.error) throw products.error;
      if (s.error) throw s.error;
      if (evaluations.error) throw evaluations.error;
      return {
        sale: s.data, products: products.data ?? [], items: items.data ?? [], payments: pays.data ?? [], tradeIns: trade.data ?? [], events: events.data ?? [],
        entries: (entries.data ?? []) as FinancialEntry[],
        contract: (contract.data ?? null) as (CreditContract & { credit_installments: CreditInstallment[] }) | null,
        accounts: (accounts.data ?? []) as FinancialAccount[],
        evaluations: evaluations.data ?? [],
      };
    },
  });

  async function cancelSale() {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("cancel_sale", { _sale_id: id, _reason: reason });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Venda cancelada. Itens devolvidos ao estoque; eventual usado marcado como devolvido ao cliente.");
    setCancelOpen(false);
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["sales"] });
    qc.invalidateQueries();
  }

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (error) return <p className="text-destructive">Erro ao carregar a venda.</p>;
  if (!data?.sale) return <p>Venda não encontrada. <Link to="/app/vendas" className="underline">Voltar às vendas</Link></p>;

  const s = data.sale;
  const snap = (s.receipt_snapshot ?? {}) as Snapshot;
  const balance = Number(s.balance);
  const hasCrediario = data.payments.some((p) => p.method === "crediario");
  const refundedCents = data.entries.filter((e) => e.kind === "saida" && e.is_refund && e.status === "pago").reduce((a, e) => a + toCents(e.amount), 0);
  const refundPendingCents = toCents(s.refund_due) - refundedCents;

  function refresh() {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["sales"] });
    qc.invalidateQueries({ queryKey: ["finance"] });
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/app/vendas" className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground print:hidden"><ArrowLeft className="mr-1 h-4 w-4" />Vendas</Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Venda · Recibo nº {s.receipt_number}</h1>
          <p className="text-sm text-muted-foreground">{formatDateTime(s.created_at)} · {s.clients?.name ?? "Cliente não identificado"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className={s.status === "cancelada" ? "bg-destructive/10 text-destructive" : "bg-success/15 text-success"}>{SALE_STATUS_LABEL[s.status]}</Badge>

          {s.status === "concluida" && balance > 0 && perms.registerPayments && (
            <Button onClick={() => setReceiptOpen(true)}><HandCoins className="mr-1 h-4 w-4" />Registrar recebimento</Button>
          )}
          {s.status === "concluida" && perms.cancelSales && (
            <Button variant="destructive" onClick={() => setCancelOpen(true)}><Ban className="mr-1 h-4 w-4" />Cancelar venda</Button>
          )}
        </div>
      </div>

      {s.status === "cancelada" && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm print:hidden">
          <p className="font-semibold text-destructive">Venda cancelada em {formatDateTime(s.cancelled_at)}</p>
          {s.cancel_reason && <p className="mt-1 text-muted-foreground">Motivo: {s.cancel_reason}</p>}
        </div>
      )}

      {s.status === "cancelada" && perms.viewFinance && toCents(s.refund_due) > 0 && (
        <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm print:hidden">
          <p className="font-semibold">Reembolso ao cliente</p>
          <p className="mt-1 text-muted-foreground">
            A devolver: {formatBRL(s.refund_due)} · Já reembolsado: {formatCents(refundedCents)} · <strong className={refundPendingCents > 0 ? "text-destructive" : "text-success"}>Pendente: {formatCents(refundPendingCents)}</strong>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Cancelar a venda não comprova devolução do dinheiro — registre cada reembolso efetivo aqui.</p>
          {refundPendingCents > 0 && perms.registerPayments && (
            <Button size="sm" className="mt-2" onClick={() => setRefundOpen(true)}>Registrar reembolso</Button>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 print:hidden">
        <section className="rounded-xl border bg-card p-4 text-sm">
          <p className="mb-2 font-semibold">Itens vendidos</p>
          <ul className="space-y-2">
            {data.products.map(p => <li key={p.id} className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="break-words font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{p.quantity} × {formatBRL(p.unit_price)}</span></span><span className="shrink-0">{formatBRL(p.subtotal)}</span></li>)}
            {data.items.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-2">
                <span>
                  <Link to="/app/estoque/$id" params={{ id: i.device_id }} className="font-medium underline-offset-2 hover:underline">{i.devices?.model} {i.devices?.storage}</Link>
                  <span className="block text-xs text-muted-foreground">{[i.devices?.color, i.devices?.imei1 ? `IMEI ${i.devices.imei1}` : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span>{formatBRL(i.price)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-1 border-t pt-2">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatBRL(s.items_total)}</span></div>
            {Number(s.discount) > 0 && <div className="flex justify-between"><span>Desconto</span><span>-{formatBRL(s.discount)}</span></div>}
            <div className="flex justify-between font-semibold"><span>Total</span><span>{formatBRL(s.total)}</span></div>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4 text-sm">
          <p className="mb-2 font-semibold">Recebimentos</p>
          {data.payments.length === 0 ? <p className="text-muted-foreground">Nenhum recebimento registrado.</p> : (
            <ul className="space-y-1">
              {data.payments.map((p) => (
                <li key={p.id} className="flex justify-between">
                  <span>{PAYMENT_LABEL[p.method]}{p.installments ? ` · ${p.installments}x` : ""}</span>
                  <span>{formatBRL(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 space-y-1 border-t pt-2">
            {Number(s.trade_in_value) > 0 && <div className="flex justify-between"><span>Usado na troca</span><span>{formatBRL(s.trade_in_value)}</span></div>}
            <div className="flex justify-between"><span>Recebido</span><span>{formatBRL(s.amount_received)}</span></div>
            <div className="flex justify-between font-semibold"><span>Saldo pendente</span><span className={balance > 0 ? "text-warning-foreground" : ""}>{formatBRL(s.balance)}</span></div>
          </div>
        </section>

        {perms.viewFinance && data.entries.length > 0 && (
          <section className="rounded-xl border bg-card p-4 text-sm">
            <p className="mb-2 font-semibold">Movimentos financeiros</p>
            <ul className="space-y-1.5">
              {data.entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate">{e.description}</span>
                    <span className="text-xs text-muted-foreground">
                      {[e.paid_at ? formatDate(e.paid_at) : e.due_date ? `vence ${formatDate(e.due_date)}` : null, ENTRY_STATUS_LABEL[e.status], e.reversal_reason ? `Motivo: ${e.reversal_reason}` : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className={`font-medium ${e.kind === "entrada" ? "text-success" : "text-destructive"}`}>{e.kind === "entrada" ? "+" : "-"}{formatBRL(e.amount)}</span>
                    {e.status === "pago" && e.kind === "entrada" && !e.reversal_of && perms.reversePayments && (
                      <Button size="sm" variant="ghost" title="Estornar" onClick={() => setReverseEntry(e)}><Undo2 className="h-4 w-4" /></Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {perms.viewFinance && hasCrediario && (
          <section className="rounded-xl border bg-card p-4 text-sm">
            <p className="mb-2 font-semibold">Crediário próprio</p>
            {data.contract ? (
              <div className="space-y-2">
                <p>Financiado: <strong>{formatBRL(data.contract.principal)}</strong> · {data.contract.credit_installments.filter((i) => i.status === "pago").length}/{data.contract.installments_count} parcelas pagas</p>
                <ul className="space-y-1">
                  {data.contract.credit_installments.sort((a, b) => a.number - b.number).map((i) => {
                    const st = installmentStatus(i, todayISO());
                    return (
                      <li key={i.id} className="flex justify-between gap-2">
                        <span>Parcela {i.number} · {formatDate(i.due_date)}</span>
                        <span className="flex items-center gap-2">
                          <span>{formatBRL(i.amount)}</span>
                          <Badge variant="secondary" className={st === "pago" ? "bg-success/15 text-success" : st === "vencido" ? "bg-destructive/10 text-destructive" : ""}>{INSTALLMENT_STATUS_LABEL[st]}</Badge>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <Link to="/app/financeiro" className="inline-block text-sm underline">Receber parcelas no Financeiro</Link>
              </div>
            ) : perms.approveCredit ? (
              <div>
                <p className="mb-2 text-muted-foreground">Esta venda tem valor financiado em crediário. Crie o contrato para gerar o cronograma de parcelas.</p>
                <Button size="sm" onClick={() => setCreditOpen(true)}>Criar contrato de crediário</Button>
              </div>
            ) : (
              <p className="text-muted-foreground">Venda com crediário aguardando a criação do contrato por um usuário autorizado.</p>
            )}
          </section>
        )}

        {data.tradeIns.length > 0 && (
          <section className="rounded-xl border bg-card p-4 text-sm">
            <p className="mb-2 font-semibold">Usado recebido na troca</p>
            <ul className="space-y-1">
              {data.tradeIns.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-2">
                  <span>
                    <Link to="/app/estoque/$id" params={{ id: t.device_id }} className="font-medium underline-offset-2 hover:underline">{t.devices?.model} {t.devices?.storage}</Link>
                    <span className="block text-xs text-muted-foreground">{[t.devices?.imei1 ? `IMEI ${t.devices.imei1}` : null, t.devices?.status === "em_conferencia" ? "Em conferência" : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span>{formatBRL(t.agreed_value)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-xl border bg-card p-4 text-sm">
          <p className="mb-2 font-semibold">Histórico</p>
          <ul className="space-y-1">
            {data.events.map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <span>{e.event === "concluida" ? "Venda concluída" : e.event === "cancelada" ? "Venda cancelada" : e.event}</span>
                <span className="text-muted-foreground">{formatDateTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
          {s.notes && <p className="mt-3 border-t pt-2 text-muted-foreground">Obs.: {s.notes}</p>}
          {data.evaluations.map(e => <div key={e.id} className="mt-3 border-t pt-3"><p className="font-semibold">Avaliação do usado{e.archived ? " · Arquivada" : ""}</p><p>{e.model} {e.storage} · Valor acordado: {formatBRL(e.offered_value)}</p><p>Referência: {e.reference_value == null ? "Sem referência" : formatBRL(e.reference_value)} · Sugerido: {e.suggested_value == null ? "—" : formatBRL(e.suggested_value)}</p><p>{(e.adjustments as Array<{kind:string;label:string;amount:number}>).map(a=>`${a.kind}: ${a.label} (${formatBRL(a.amount)})`).join(" · ") || "Sem ajustes"}</p>{e.notes && <p>{e.notes}</p>}</div>)}
        </section>
      </div>

      <div className="mt-6"><SaleDocuments saleId={id} /></div>

      <ReceiptDialog open={receiptOpen} onClose={() => setReceiptOpen(false)} saleId={id} balanceCents={toCents(s.balance)} accounts={data.accounts} onSaved={refresh} />
      <CreditDialog open={creditOpen} onClose={() => setCreditOpen(false)} saleId={id} principal={data.payments.filter((p) => p.method === "crediario").reduce((a, p) => a + Number(p.amount), 0)} onSaved={refresh} />
      <RefundDialog open={refundOpen} onClose={() => setRefundOpen(false)} saleId={id} pendingCents={refundPendingCents} accounts={data.accounts} onSaved={refresh} />
      <ReverseEntryDialog entry={reverseEntry} onClose={() => setReverseEntry(null)} onSaved={refresh} />

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancelar venda nº {s.receipt_number}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            As quantidades dos produtos voltam ao estoque, os aparelhos ficam disponíveis e o usado da troca é marcado como devolvido ao cliente.
            Recebíveis em aberto são cancelados e o valor recebido fica registrado como reembolso pendente — a devolução do dinheiro é registrada à parte.
            A venda e o recibo originais são preservados no histórico.
          </p>
          <Textarea rows={3} placeholder="Motivo do cancelamento" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Voltar</Button>
            <Button variant="destructive" disabled={busy || !reason.trim()} onClick={cancelSale}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Confirmar cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

function ReceiptDialog({ open, onClose, saleId, balanceCents, accounts, onSaved }: { open: boolean; onClose: () => void; saleId: string; balanceCents: number; accounts: FinancialAccount[]; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState("pix");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cents = parseBRLToCents(amount) ?? 0;
    if (cents <= 0) { toast.error("Informe um valor válido."); return; }
    if (cents > balanceCents) { toast.error(`O valor excede o saldo devedor de ${formatCents(balanceCents)}. Troco ou crédito exigem tratamento explícito.`); return; }
    if (!accountId) { toast.error("Escolha a conta de destino."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("register_sale_receipt", {
      _sale_id: saleId, _amount: cents / 100, _account_id: accountId, _method: method, _received_at: date, _note: note, _client_token: crypto.randomUUID(),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Recebimento registrado. O saldo foi atualizado e o recibo original não foi alterado.");
    setAmount(""); setNote("");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Registrar recebimento</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <p className="text-sm text-muted-foreground">Saldo devedor: <strong>{formatCents(balanceCents)}</strong>. Isso não gera outra venda nem modifica o recibo original.</p>
          <Fld label="Valor (R$)"><Input required value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={formatCents(balanceCents)} /></Fld>
          <div className="grid grid-cols-2 gap-3">
            <Fld label="Conta de destino"><Select value={accountId} onValueChange={setAccountId}><SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></Fld>
            <Fld label="Meio de pagamento"><Select value={method} onValueChange={setMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PAYMENT_LABEL).filter(([k]) => k !== "crediario").map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Fld>
          </div>
          <Fld label="Data"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Fld>
          <Fld label="Observação (opcional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Fld>
          <DialogFooter><Button variant="outline" type="button" onClick={onClose}>Cancelar</Button><Button disabled={busy}>{busy ? "Registrando…" : "Confirmar recebimento"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreditDialog({ open, onClose, saleId, principal, onSaved }: { open: boolean; onClose: () => void; saleId: string; principal: number; onSaved: () => void }) {
  const [count, setCount] = useState("6");
  const [firstDue, setFirstDue] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const n = Math.max(1, Math.min(60, Number(count) || 1));
  const preview = buildSchedule(toCents(principal), n, firstDue);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("create_credit_contract", {
      _sale_id: saleId, _installments: n, _first_due: firstDue, _notes: notes, _client_token: crypto.randomUUID(),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Contrato de crediário criado sem juros.");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Criar contrato de crediário</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <p className="text-sm text-muted-foreground">Principal financiado: <strong>{formatBRL(principal)}</strong> · sem juros. A soma das parcelas é sempre igual ao principal; a diferença de centavos fica na última parcela.</p>
          <div className="grid grid-cols-2 gap-3">
            <Fld label="Quantidade de parcelas"><Input required type="number" min={1} max={60} value={count} onChange={(e) => setCount(e.target.value)} /></Fld>
            <Fld label="Primeiro vencimento"><Input required type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></Fld>
          </div>
          <Fld label="Condições pactuadas (opcional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: combinado em balcão, sem encargos" /></Fld>
          {preview.length > 0 && (
            <div className="rounded-lg border p-3 text-sm">
              <p className="mb-1 font-semibold">Cronograma</p>
              <ul className="grid grid-cols-2 gap-x-4">
                {preview.map((p) => <li key={p.number} className="flex justify-between"><span>{p.number}ª · {formatDate(p.dueDate)}</span><span>{formatCents(p.amountCents)}</span></li>)}
              </ul>
            </div>
          )}
          <DialogFooter><Button variant="outline" type="button" onClick={onClose}>Cancelar</Button><Button disabled={busy}>{busy ? "Criando…" : "Criar contrato"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({ open, onClose, saleId, pendingCents, accounts, onSaved }: { open: boolean; onClose: () => void; saleId: string; pendingCents: number; accounts: FinancialAccount[]; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState("pix");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cents = parseBRLToCents(amount) ?? 0;
    if (cents <= 0 || cents > pendingCents) { toast.error(`Valor deve ser entre 0,01 e ${formatCents(pendingCents)}.`); return; }
    if (!accountId) { toast.error("Escolha a conta de origem."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("register_refund", {
      _sale_id: saleId, _amount: cents / 100, _account_id: accountId, _method: method, _paid_at: date, _note: note, _client_token: crypto.randomUUID(),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Reembolso registrado.");
    setAmount(""); setNote("");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Registrar reembolso</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <p className="text-sm text-muted-foreground">Reembolso pendente: <strong>{formatCents(pendingCents)}</strong>.</p>
          <Fld label="Valor (R$)"><Input required value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={formatCents(pendingCents)} /></Fld>
          <div className="grid grid-cols-2 gap-3">
            <Fld label="Conta de origem"><Select value={accountId} onValueChange={setAccountId}><SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></Fld>
            <Fld label="Meio"><Select value={method} onValueChange={setMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PAYMENT_LABEL).filter(([k]) => k !== "crediario").map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Fld>
          </div>
          <Fld label="Data"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Fld>
          <Fld label="Observação (opcional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Fld>
          <DialogFooter><Button variant="outline" type="button" onClick={onClose}>Cancelar</Button><Button disabled={busy}>{busy ? "Registrando…" : "Confirmar reembolso"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReverseEntryDialog({ entry, onClose, onSaved }: { entry: FinancialEntry | null; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!entry || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("reverse_receipt", { _entry_id: entry.id, _reason: reason });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Estorno registrado com movimento reverso.");
    setReason("");
    onSaved(); onClose();
  }

  return (
    <Dialog open={!!entry} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Estornar recebimento</DialogTitle></DialogHeader>
        {entry && (
          <form onSubmit={save} className="space-y-3">
            <p className="text-sm text-muted-foreground">{entry.description} · {formatBRL(entry.amount)}. O lançamento original é preservado e um movimento reverso rastreável é criado.</p>
            <Fld label="Motivo do estorno"><Input required value={reason} onChange={(e) => setReason(e.target.value)} /></Fld>
            <DialogFooter><Button variant="outline" type="button" onClick={onClose}>Voltar</Button><Button variant="destructive" disabled={busy || !reason.trim()}>{busy ? "Estornando…" : "Confirmar estorno"}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
