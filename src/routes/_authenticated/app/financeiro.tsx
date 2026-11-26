import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ArrowLeftRight, Landmark, Loader2, MessageCircle, Plus, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";
import { BUCKET } from "@/lib/storage";
import {
  ACCOUNT_TYPE_LABEL, CONTRACT_STATUS_LABEL, ENTRY_STATUS_LABEL, INSTALLMENT_STATUS_LABEL,
  accountBalanceCents, installmentStatus, type CreditContract, type CreditInstallment, type FinancialAccount, type FinancialCategory, type FinancialEntry,
} from "@/lib/finance";
import { PAYMENT_LABEL } from "@/lib/sales";
import { formatBRL, formatCents, parseBRLToCents, toCents } from "@/lib/money";
import { formatDate, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/app/financeiro")({
  head: () => ({ meta: [{ title: "Financeiro — MLI Gestão" }, { name: "description", content: "Contas, lançamentos, contas a pagar e receber e crediário." }, { property: "og:title", content: "Financeiro — MLI Gestão" }, { property: "og:description", content: "Contas, lançamentos, contas a pagar e receber e crediário." }] }),
  component: Financeiro,
});

type EntryRow = FinancialEntry & { clients?: { name: string } | null; financial_accounts?: { name: string } | null };
type ContractRow = CreditContract & { clients?: { name: string; whatsapp?: string | null } | null; sales?: { receipt_number: number | null } | null };

function useFinanceData() {
  const { store, perms } = useStore();
  return useQuery({
    queryKey: ["finance", store.id, perms.viewFinance],
    enabled: perms.viewFinance,
    queryFn: async () => {
      const [accounts, categories, entries, contracts, installments, cardSettings] = await Promise.all([
        supabase.from("financial_accounts").select("*").eq("store_id", store.id).order("created_at"),
        supabase.from("financial_categories").select("*").eq("store_id", store.id).order("name"),
        supabase.from("financial_entries").select("*, clients(name), financial_accounts(name)").eq("store_id", store.id).order("created_at", { ascending: false }),
        supabase.from("credit_contracts").select("*, clients(name, whatsapp), sales(receipt_number)").eq("store_id", store.id).order("created_at", { ascending: false }),
        supabase.from("credit_installments").select("*").eq("store_id", store.id).order("due_date"),
        supabase.from("store_card_settings").select("*").eq("store_id", store.id),
      ]);
      for (const q of [accounts, categories, entries, contracts, installments, cardSettings]) if (q.error) throw q.error;
      return {
        accounts: (accounts.data ?? []) as FinancialAccount[],
        categories: (categories.data ?? []) as FinancialCategory[],
        entries: (entries.data ?? []) as EntryRow[],
        contracts: (contracts.data ?? []) as ContractRow[],
        installments: (installments.data ?? []) as CreditInstallment[],
        cardSettings: cardSettings.data ?? [],
      };
    },
  });
}

function Financeiro() {
  const { perms } = useStore();
  const { data, isLoading, error } = useFinanceData();
  if (!perms.viewFinance)
    return <div className="mx-auto max-w-4xl"><PageHeader title="Financeiro" /><p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Você não tem permissão para consultar o financeiro. Peça ao proprietário para liberar o acesso.</p></div>;
  if (isLoading) return <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="text-destructive">Erro ao carregar o financeiro.</p>;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Financeiro" subtitle="Contas, lançamentos, recebíveis e crediário próprio." />
      <Tabs defaultValue="visao">
        <TabsList className="flex-wrap">
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
          <TabsTrigger value="crediario">Crediário</TabsTrigger>
          <TabsTrigger value="contas">Contas e categorias</TabsTrigger>
        </TabsList>
        <TabsContent value="visao" className="mt-4"><VisaoGeral data={data} /></TabsContent>
        <TabsContent value="lancamentos" className="mt-4"><Lancamentos data={data} /></TabsContent>
        <TabsContent value="crediario" className="mt-4"><Crediario data={data} /></TabsContent>
        <TabsContent value="contas" className="mt-4"><Contas data={data} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- Visão geral ---------------- */

function VisaoGeral({ data }: { data: NonNullable<ReturnType<typeof useFinanceData>["data"]> }) {
  const today = todayISO();
  const open = data.entries.filter((e) => e.status === "pendente" || e.status === "parcial");
  const receber = open.filter((e) => e.kind === "entrada").reduce((a, e) => a + toCents(e.amount) - toCents(e.paid_amount), 0);
  const pagar = open.filter((e) => e.kind === "saida").reduce((a, e) => a + toCents(e.amount) - toCents(e.paid_amount), 0);
  const vencido = open.filter((e) => e.due_date && e.due_date < today).reduce((a, e) => a + toCents(e.amount) - toCents(e.paid_amount), 0);
  const saldoTotal = data.accounts.filter((a) => a.active).reduce((acc, a) => acc + accountBalanceCents(a, data.entries, a.id, toCents), 0);
  const openInstallments = data.installments.filter((i) => ["aberto", "parcial"].includes(i.status) && data.contracts.find((c) => c.id === i.contract_id)?.status === "ativo");
  const credVencido = openInstallments.filter((i) => i.due_date < today).reduce((a, i) => a + toCents(i.amount) - toCents(i.paid_amount), 0);
  const proximos = [...open.filter((e) => e.due_date), ...openInstallments.map((i) => ({ id: i.id, kind: "entrada" as const, description: `Parcela ${i.number} — crediário`, amount: i.amount, paid_amount: i.paid_amount, due_date: i.due_date, status: i.status, clients: null, financial_accounts: null }))]
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")).slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Saldo disponível" value={formatCents(saldoTotal)} highlight />
        <Kpi label="A receber" value={formatCents(receber)} />
        <Kpi label="A pagar" value={formatCents(pagar)} />
        <Kpi label="Vencido (contas + crediário)" value={formatCents(vencido + credVencido)} danger={vencido + credVencido > 0} />
      </div>
      <section className="rounded-xl border bg-card p-5">
        <h3 className="mb-3 font-semibold">Saldo por conta</h3>
        <ul className="divide-y text-sm">
          {data.accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2">
              <span>{a.name} <span className="text-xs text-muted-foreground">· {ACCOUNT_TYPE_LABEL[a.type]}</span>{!a.active && <Badge variant="outline" className="ml-2 text-[10px]">Inativa</Badge>}</span>
              <span className="font-medium">{formatCents(accountBalanceCents(a, data.entries, a.id, toCents))}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h3 className="mb-3 font-semibold">Próximos vencimentos</h3>
        {proximos.length === 0 ? <p className="text-sm text-muted-foreground">Nada a vencer.</p> : (
          <ul className="divide-y text-sm">
            {proximos.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate">{e.description}</span>
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span className={e.due_date && e.due_date < today ? "text-destructive" : "text-muted-foreground"}>{e.due_date ? formatDate(e.due_date) : "—"}</span>
                  <span className={e.kind === "entrada" ? "font-medium text-success" : "font-medium text-destructive"}>{e.kind === "entrada" ? "+" : "-"}{formatCents(toCents(e.amount) - toCents(e.paid_amount))}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------------- Lançamentos ---------------- */

function Lancamentos({ data }: { data: NonNullable<ReturnType<typeof useFinanceData>["data"]> }) {
  const { perms } = useStore();
  const qc = useQueryClient();
  const [fStatus, setFStatus] = useState("todas");
  const [fAccount, setFAccount] = useState("todas");
  const [fKind, setFKind] = useState("todas");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fText, setFText] = useState("");
  const [entryOpen, setEntryOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [baixaEntry, setBaixaEntry] = useState<EntryRow | null>(null);
  const [reverseEntry, setReverseEntry] = useState<EntryRow | null>(null);

  const filtered = data.entries.filter((e) => {
    if (fStatus !== "todas" && e.status !== fStatus) return false;
    if (fAccount !== "todas" && e.account_id !== fAccount) return false;
    if (fKind !== "todas" && e.kind !== fKind) return false;
    const ref = e.competence_date ?? e.due_date ?? e.created_at.slice(0, 10);
    if (fFrom && ref < fFrom) return false;
    if (fTo && ref > fTo) return false;
    if (fText && !`${e.description} ${e.clients?.name ?? ""}`.toLowerCase().includes(fText.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Buscar por descrição ou cliente" className="w-64" value={fText} onChange={(e) => setFText(e.target.value)} />
        <Select value={fKind} onValueChange={setFKind}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todas">Todas</SelectItem><SelectItem value="entrada">Entradas</SelectItem><SelectItem value="saida">Saídas</SelectItem></SelectContent></Select>
        <Select value={fStatus} onValueChange={setFStatus}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todas">Todas situações</SelectItem>{Object.entries(ENTRY_STATUS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
        <Select value={fAccount} onValueChange={setFAccount}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todas">Todas contas</SelectItem>{data.accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
        <Input type="date" className="w-36" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        <Input type="date" className="w-36" value={fTo} onChange={(e) => setFTo(e.target.value)} />
        {perms.registerPayments && (
          <span className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setTransferOpen(true)}><ArrowLeftRight className="mr-1 h-4 w-4" />Transferência</Button>
            <Button onClick={() => setEntryOpen(true)}><Plus className="mr-1 h-4 w-4" />Novo lançamento</Button>
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="p-3">Descrição</th><th className="p-3">Conta</th><th className="p-3">Vencimento</th><th className="p-3">Situação</th><th className="p-3 text-right">Valor</th><th className="p-3" /></tr></thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-b last:border-0">
                <td className="p-3">
                  <p className="font-medium">{e.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {[e.clients?.name, e.is_transfer ? "Transferência" : null, e.is_equity ? "Aporte/retirada de sócios" : null, e.is_refund ? "Reembolso" : null, e.sale_id ? "Vinculado a venda" : null].filter(Boolean).join(" · ")}
                  </p>
                </td>
                <td className="p-3 text-muted-foreground">{e.financial_accounts?.name ?? (e.status === "pendente" ? "A definir" : "—")}</td>
                <td className="p-3 text-muted-foreground">{e.due_date ? formatDate(e.due_date) : "—"}</td>
                <td className="p-3"><Badge variant="secondary" className={e.status === "pago" ? "bg-success/15 text-success" : e.status === "estornado" || e.status === "cancelado" ? "bg-destructive/10 text-destructive" : ""}>{ENTRY_STATUS_LABEL[e.status]}</Badge></td>
                <td className={`p-3 text-right font-medium ${e.kind === "entrada" ? "text-success" : "text-destructive"}`}>{e.kind === "entrada" ? "+" : "-"}{formatBRL(e.amount)}</td>
                <td className="p-3 text-right">
                  {(e.status === "pendente" || e.status === "parcial") && perms.registerPayments && <Button size="sm" variant="outline" onClick={() => setBaixaEntry(e)}>Baixar</Button>}
                  {e.status === "pago" && e.kind === "entrada" && !e.reversal_of && perms.reversePayments && <Button size="sm" variant="ghost" title="Estornar" onClick={() => setReverseEntry(e)}><Undo2 className="h-4 w-4" /></Button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Nenhum lançamento encontrado.</td></tr>}
          </tbody>
        </table>
      </div>

      <EntryDialog open={entryOpen} onClose={() => setEntryOpen(false)} accounts={data.accounts} categories={data.categories} onSaved={() => qc.invalidateQueries({ queryKey: ["finance"] })} />
      <TransferDialog open={transferOpen} onClose={() => setTransferOpen(false)} accounts={data.accounts} onSaved={() => qc.invalidateQueries({ queryKey: ["finance"] })} />
      <BaixaDialog entry={baixaEntry} onClose={() => setBaixaEntry(null)} accounts={data.accounts} onSaved={() => qc.invalidateQueries({ queryKey: ["finance"] })} />
      <ReverseDialog entry={reverseEntry} onClose={() => setReverseEntry(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["finance"] })} />
    </div>
  );
}

function EntryDialog({ open, onClose, accounts, categories, onSaved }: { open: boolean; onClose: () => void; accounts: FinancialAccount[]; categories: FinancialCategory[]; onSaved: () => void }) {
  const { store } = useStore();
  const [kind, setKind] = useState<"entrada" | "saida">("saida");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState(todayISO());
  const [competence, setCompetence] = useState(todayISO());
  const [paidNow, setPaidNow] = useState(true);
  const [paidAt, setPaidAt] = useState(todayISO());
  const [equity, setEquity] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cents = parseBRLToCents(amount) ?? 0;
    if (cents <= 0) { toast.error("Informe um valor válido."); return; }
    if (paidNow && !accountId) { toast.error("Escolha a conta."); return; }
    setBusy(true);
    let attachment: string | null = null;
    if (file) {
      const path = `${store.id}/finance/${crypto.randomUUID()}-${file.name}`;
      const up = await supabase.storage.from(BUCKET).upload(path, file);
      if (up.error) { setBusy(false); toast.error(up.error.message); return; }
      attachment = path;
    }
    const { error } = await supabase.from("financial_entries").insert({
      store_id: store.id, account_id: paidNow ? accountId : null, category_id: categoryId || null,
      kind, amount: cents / 100, paid_amount: paidNow ? cents / 100 : 0, description: description.trim(),
      status: paidNow ? "pago" : "pendente", due_date: due || null, competence_date: competence || null,
      paid_at: paidNow ? paidAt : null, is_equity: equity, attachment_path: attachment,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Lançamento registrado.");
    onSaved(); onClose();
  }

  const cats = categories.filter((c) => c.kind === (kind === "entrada" ? "receita" : "despesa"));
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Novo lançamento</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Fld label="Tipo"><Select value={kind} onValueChange={(v) => setKind(v as "entrada" | "saida")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="entrada">Entrada</SelectItem><SelectItem value="saida">Saída</SelectItem></SelectContent></Select></Fld>
            <Fld label="Valor (R$)"><Input required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" /></Fld>
          </div>
          <Fld label="Descrição"><Input required value={description} onChange={(e) => setDescription(e.target.value)} /></Fld>
          <div className="grid grid-cols-2 gap-3">
            <Fld label="Vencimento"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Fld>
            <Fld label="Competência"><Input type="date" value={competence} onChange={(e) => setCompetence(e.target.value)} /></Fld>
          </div>
          <Fld label="Categoria"><Select value={categoryId} onValueChange={setCategoryId}><SelectTrigger><SelectValue placeholder="Sem categoria" /></SelectTrigger><SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></Fld>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={paidNow} onCheckedChange={(v) => setPaidNow(v === true)} />Já foi {kind === "entrada" ? "recebido" : "pago"}</label>
          {paidNow && (
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Conta"><Select value={accountId} onValueChange={setAccountId}><SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent>{accounts.filter((a) => a.active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></Fld>
              <Fld label="Data efetiva"><Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Fld>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={equity} onCheckedChange={(v) => setEquity(v === true)} />Aporte ou retirada de sócios (não compõe o lucro operacional)</label>
          <Fld label="Comprovante (opcional)"><Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Fld>
          <DialogFooter><Button variant="outline" type="button" onClick={onClose}>Cancelar</Button><Button disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ open, onClose, accounts, onSaved }: { open: boolean; onClose: () => void; accounts: FinancialAccount[]; onSaved: () => void }) {
  const { store } = useStore();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cents = parseBRLToCents(amount) ?? 0;
    if (cents <= 0 || !from || !to || from === to) { toast.error("Informe valor e contas diferentes."); return; }
    setBusy(true);
    const group = crypto.randomUUID();
    const fromName = accounts.find((a) => a.id === from)?.name;
    const toName = accounts.find((a) => a.id === to)?.name;
    const { error } = await supabase.from("financial_entries").insert([
      { store_id: store.id, account_id: from, kind: "saida", amount: cents / 100, paid_amount: cents / 100, description: `Transferência para ${toName}`, status: "pago", due_date: date, competence_date: date, paid_at: date, is_transfer: true, transfer_group: group },
      { store_id: store.id, account_id: to, kind: "entrada", amount: cents / 100, paid_amount: cents / 100, description: `Transferência de ${fromName}`, status: "pago", due_date: date, competence_date: date, paid_at: date, is_transfer: true, transfer_group: group },
    ]);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Transferência registrada. Ela não gera receita nem despesa.");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Transferência entre contas</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <Fld label="De"><Select value={from} onValueChange={setFrom}><SelectTrigger><SelectValue placeholder="Conta de origem" /></SelectTrigger><SelectContent>{accounts.filter((a) => a.active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></Fld>
          <Fld label="Para"><Select value={to} onValueChange={setTo}><SelectTrigger><SelectValue placeholder="Conta de destino" /></SelectTrigger><SelectContent>{accounts.filter((a) => a.active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></Fld>
          <div className="grid grid-cols-2 gap-3">
            <Fld label="Valor (R$)"><Input required value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Fld>
            <Fld label="Data"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Fld>
          </div>
          <DialogFooter><Button variant="outline" type="button" onClick={onClose}>Cancelar</Button><Button disabled={busy}>{busy ? "Salvando…" : "Transferir"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BaixaDialog({ entry, onClose, accounts, onSaved }: { entry: EntryRow | null; onClose: () => void; accounts: FinancialAccount[]; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const remaining = entry ? toCents(entry.amount) - toCents(entry.paid_amount) : 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!entry || busy) return;
    const cents = parseBRLToCents(amount) ?? 0;
    if (cents <= 0 || cents > remaining) { toast.error(`Valor deve ser entre 0,01 e ${formatCents(remaining)}.`); return; }
    const acc = accountId || entry.account_id;
    if (!acc) { toast.error("Escolha a conta de destino."); return; }
    setBusy(true);
    const newPaid = toCents(entry.paid_amount) + cents;
    const { error } = await supabase.from("financial_entries").update({
      account_id: acc, paid_amount: newPaid / 100, paid_at: date, status: newPaid >= toCents(entry.amount) ? "pago" : "parcial", updated_at: new Date().toISOString(),
    }).eq("id", entry.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Baixa registrada.");
    onSaved(); onClose();
  }

  return (
    <Dialog open={!!entry} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Baixar lançamento</DialogTitle></DialogHeader>
        {entry && (
          <form onSubmit={save} className="space-y-3">
            <p className="text-sm text-muted-foreground">{entry.description} · restante {formatCents(remaining)}</p>
            <Fld label="Valor recebido/pago agora (R$)"><Input required value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={formatCents(remaining)} /></Fld>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Conta"><Select value={accountId || entry.account_id || ""} onValueChange={setAccountId}><SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent>{accounts.filter((a) => a.active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></Fld>
              <Fld label="Data efetiva"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Fld>
            </div>
            <DialogFooter><Button variant="outline" type="button" onClick={onClose}>Cancelar</Button><Button disabled={busy}>{busy ? "Salvando…" : "Confirmar baixa"}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReverseDialog({ entry, onClose, onSaved }: { entry: EntryRow | null; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!entry || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("reverse_receipt", { _entry_id: entry.id, _reason: reason });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Estorno registrado com movimento reverso.");
    onSaved(); onClose();
  }

  return (
    <Dialog open={!!entry} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Estornar recebimento</DialogTitle></DialogHeader>
        {entry && (
          <form onSubmit={save} className="space-y-3">
            <p className="text-sm text-muted-foreground">{entry.description} · {formatBRL(entry.amount)}. O lançamento original é preservado e um movimento reverso é criado.</p>
            <Fld label="Motivo do estorno"><Input required value={reason} onChange={(e) => setReason(e.target.value)} /></Fld>
            <DialogFooter><Button variant="outline" type="button" onClick={onClose}>Voltar</Button><Button variant="destructive" disabled={busy || !reason.trim()}>{busy ? "Estornando…" : "Confirmar estorno"}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Crediário ---------------- */

function Crediario({ data }: { data: NonNullable<ReturnType<typeof useFinanceData>["data"]> }) {
  const { perms } = useStore();
  const qc = useQueryClient();
  const today = todayISO();
  const [selected, setSelected] = useState<ContractRow | null>(null);

  const active = data.contracts.filter((c) => c.status === "ativo");
  const instOf = (id: string) => data.installments.filter((i) => i.contract_id === id);
  const totalReceber = active.reduce((a, c) => a + instOf(c.id).filter((i) => ["aberto", "parcial"].includes(i.status)).reduce((x, i) => x + toCents(i.amount) - toCents(i.paid_amount), 0), 0);
  const vencido = active.reduce((a, c) => a + instOf(c.id).filter((i) => installmentStatus(i, today) === "vencido").reduce((x, i) => x + toCents(i.amount) - toCents(i.paid_amount), 0), 0);
  const previstoMes = active.reduce((a, c) => a + instOf(c.id).filter((i) => ["aberto", "parcial"].includes(i.status) && i.due_date.slice(0, 7) === today.slice(0, 7)).reduce((x, i) => x + toCents(i.amount) - toCents(i.paid_amount), 0), 0);
  const recebidoMes = data.entries.filter((e) => e.contract_id && e.status === "pago" && e.paid_at?.slice(0, 7) === today.slice(0, 7)).reduce((a, e) => a + toCents(e.paid_amount), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Saldo total a receber" value={formatCents(totalReceber)} highlight />
        <Kpi label="Previsto neste mês" value={formatCents(previstoMes)} />
        <Kpi label="Recebido neste mês" value={formatCents(recebidoMes)} />
        <Kpi label="Saldo vencido" value={formatCents(vencido)} danger={vencido > 0} />
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="p-3">Cliente</th><th className="p-3">Venda</th><th className="p-3">Financiado</th><th className="p-3">Parcelas</th><th className="p-3">Situação</th><th className="p-3" /></tr></thead>
          <tbody>
            {data.contracts.map((c) => {
              const insts = instOf(c.id);
              const late = insts.filter((i) => installmentStatus(i, today) === "vencido").length;
              return (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">{c.clients?.name ?? "—"}</td>
                  <td className="p-3 text-muted-foreground">{c.sales?.receipt_number ? <Link to="/app/vendas/$id" params={{ id: c.sale_id }} className="hover:underline">Recibo nº {c.sales.receipt_number}</Link> : "—"}</td>
                  <td className="p-3">{formatBRL(c.principal)}</td>
                  <td className="p-3 text-muted-foreground">{insts.filter((i) => i.status === "pago").length}/{c.installments_count} pagas{late > 0 && <span className="text-destructive"> · {late} vencida(s)</span>}</td>
                  <td className="p-3"><Badge variant="secondary" className={c.status === "quitado" ? "bg-success/15 text-success" : c.status === "cancelado" ? "bg-destructive/10 text-destructive" : ""}>{CONTRACT_STATUS_LABEL[c.status]}</Badge></td>
                  <td className="p-3 text-right"><Button size="sm" variant="outline" onClick={() => setSelected(c)}>Abrir</Button></td>
                </tr>
              );
            })}
            {data.contracts.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Nenhum contrato de crediário. Ele é criado a partir de uma venda com pagamento em crediário.</td></tr>}
          </tbody>
        </table>
      </div>

      <ContractDialog contract={selected} installments={selected ? instOf(selected.id) : []} accounts={data.accounts} canReceive={perms.registerPayments} onClose={() => setSelected(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["finance"] })} />
    </div>
  );
}

function ContractDialog({ contract, installments, accounts, canReceive, onClose, onSaved }: { contract: ContractRow | null; installments: CreditInstallment[]; accounts: FinancialAccount[]; canReceive: boolean; onClose: () => void; onSaved: () => void }) {
  const today = todayISO();
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState("pix");
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const remaining = installments.filter((i) => ["aberto", "parcial"].includes(i.status)).reduce((a, i) => a + toCents(i.amount) - toCents(i.paid_amount), 0);

  function whatsappReminder() {
    if (!contract?.clients?.whatsapp) { toast.error("Cliente sem WhatsApp cadastrado."); return; }
    const next = installments.filter((i) => ["aberto", "parcial"].includes(i.status)).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
    const text = encodeURIComponent(`Olá ${contract.clients?.name}! Passando para lembrar da parcela ${next?.number ?? ""} do seu crediário, vencimento ${next ? formatDate(next.due_date) : ""}, valor ${next ? formatBRL(next.amount) : ""}. Qualquer dúvida, estamos à disposição.`);
    window.open(`https://wa.me/55${contract.clients.whatsapp.replace(/\D/g, "")}?text=${text}`, "_blank", "noopener");
  }

  async function receive(e: FormEvent) {
    e.preventDefault();
    if (!contract || busy) return;
    const cents = parseBRLToCents(amount) ?? 0;
    if (cents <= 0 || !accountId) { toast.error("Informe valor e conta de destino."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("receive_installments", {
      _contract_id: contract.id, _amount: cents / 100, _account_id: accountId, _method: method, _received_at: date, _note: "", _client_token: crypto.randomUUID(),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Recebimento registrado e parcelas atualizadas.");
    setReceiveOpen(false); setAmount("");
    onSaved();
  }

  return (
    <Dialog open={!!contract} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Crediário — {contract?.clients?.name}</DialogTitle></DialogHeader>
        {contract && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">Entrada</p><p className="font-medium">{formatBRL(contract.down_payment)}</p></div>
              <div><p className="text-xs text-muted-foreground">Principal financiado</p><p className="font-medium">{formatBRL(contract.principal)}</p></div>
              <div><p className="text-xs text-muted-foreground">Total a prazo</p><p className="font-medium">{formatBRL(contract.principal)} <span className="text-xs text-muted-foreground">(sem juros)</span></p></div>
              <div><p className="text-xs text-muted-foreground">Saldo</p><p className="font-medium">{formatCents(remaining)}</p></div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canReceive && contract.status === "ativo" && <Button size="sm" onClick={() => setReceiveOpen(true)}>Receber parcela</Button>}
              <Button size="sm" variant="outline" onClick={whatsappReminder}><MessageCircle className="mr-1 h-4 w-4" />Lembrar no WhatsApp</Button>
              <Button size="sm" variant="outline" disabled title="Disponível quando o cálculo de redução de juros estiver implementado e verificado">Quitação antecipada (em preparação)</Button>
              <Button size="sm" variant="outline" disabled title="Disponível na próxima etapa, vinculada ao contrato original">Renegociar (em preparação)</Button>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">Nº</th><th>Vencimento</th><th>Valor</th><th>Pago</th><th>Situação</th></tr></thead>
              <tbody>
                {installments.map((i) => {
                  const st = installmentStatus(i, today);
                  return (
                    <tr key={i.id} className="border-b last:border-0">
                      <td className="py-2">{i.number}</td>
                      <td>{formatDate(i.due_date)}</td>
                      <td>{formatBRL(i.amount)}</td>
                      <td>{formatBRL(i.paid_amount)}</td>
                      <td><Badge variant="secondary" className={st === "pago" ? "bg-success/15 text-success" : st === "vencido" ? "bg-destructive/10 text-destructive" : ""}>{INSTALLMENT_STATUS_LABEL[st]}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">Juros e encargos só são aplicados com condições cadastradas e pactuadas. Este contrato é sem juros; operações com juros serão habilitadas após verificação do método de cálculo.</p>
          </div>
        )}

        <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Receber parcela</DialogTitle></DialogHeader>
            <form onSubmit={receive} className="space-y-3">
              <p className="text-sm text-muted-foreground">Saldo do contrato: {formatCents(remaining)}. O valor é aplicado da parcela mais antiga para a mais nova e não gera novo faturamento.</p>
              <Fld label="Valor (R$)"><Input required value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Fld>
              <div className="grid grid-cols-2 gap-3">
                <Fld label="Conta de destino"><Select value={accountId} onValueChange={setAccountId}><SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent>{accounts.filter((a) => a.active).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></Fld>
                <Fld label="Meio"><Select value={method} onValueChange={setMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PAYMENT_LABEL).filter(([k]) => k !== "crediario").map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Fld>
              </div>
              <Fld label="Data"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Fld>
              <DialogFooter><Button variant="outline" type="button" onClick={() => setReceiveOpen(false)}>Cancelar</Button><Button disabled={busy}>{busy ? "Registrando…" : "Confirmar recebimento"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Contas e categorias ---------------- */

function Contas({ data }: { data: NonNullable<ReturnType<typeof useFinanceData>["data"]> }) {
  const { store, perms } = useStore();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState("banco");
  const [initial, setInitial] = useState("");
  const [initialDate, setInitialDate] = useState(todayISO());
  const [catName, setCatName] = useState("");
  const [catKind, setCatKind] = useState("despesa");
  const [busy, setBusy] = useState(false);

  async function addAccount(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.from("financial_accounts").insert({ store_id: store.id, name: name.trim(), type, initial_balance: (parseBRLToCents(initial) ?? 0) / 100, initial_balance_date: initialDate });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Conta criada."); setName(""); setInitial("");
    qc.invalidateQueries({ queryKey: ["finance"] });
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.from("financial_categories").insert({ store_id: store.id, name: catName.trim(), kind: catKind });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Categoria criada."); setCatName("");
    qc.invalidateQueries({ queryKey: ["finance"] });
  }

  async function saveCard(method: string, fee: string, days: string) {
    const { error } = await supabase.from("store_card_settings").upsert({ store_id: store.id, method, fee_pct: Number(fee.replace(",", ".")) || 0, receive_days: Number(days) || 0 });
    if (error) { toast.error(error.message); return; }
    toast.success("Condições de cartão salvas.");
    qc.invalidateQueries({ queryKey: ["finance"] });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border bg-card p-5">
        <h3 className="mb-3 flex items-center gap-2 font-semibold"><Landmark className="h-4 w-4 text-gold" />Contas financeiras</h3>
        <ul className="mb-4 divide-y text-sm">
          {data.accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2">
              <span>{a.name} <span className="text-xs text-muted-foreground">· {ACCOUNT_TYPE_LABEL[a.type]} · saldo inicial {formatBRL(a.initial_balance)} em {formatDate(a.initial_balance_date)}</span></span>
              <span className="font-medium">{formatCents(accountBalanceCents(a, data.entries, a.id, toCents))}</span>
            </li>
          ))}
        </ul>
        {perms.registerPayments && (
          <form onSubmit={addAccount} className="space-y-2 border-t pt-3">
            <div className="grid grid-cols-2 gap-2">
              <Input required placeholder="Nome da conta" value={name} onChange={(e) => setName(e.target.value)} />
              <Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ACCOUNT_TYPE_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
              <Input placeholder="Saldo inicial (R$)" value={initial} onChange={(e) => setInitial(e.target.value)} inputMode="decimal" />
              <Input type="date" title="Data de referência do saldo inicial" value={initialDate} onChange={(e) => setInitialDate(e.target.value)} />
            </div>
            <Button size="sm" disabled={busy}>Adicionar conta</Button>
          </form>
        )}
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h3 className="mb-3 font-semibold">Categorias</h3>
        <ul className="mb-4 divide-y text-sm">
          {data.categories.map((c) => <li key={c.id} className="flex justify-between py-2"><span>{c.name}</span><Badge variant="outline">{c.kind === "receita" ? "Receita" : "Despesa"}</Badge></li>)}
          {data.categories.length === 0 && <li className="py-2 text-muted-foreground">Nenhuma categoria cadastrada.</li>}
        </ul>
        {perms.registerPayments && (
          <form onSubmit={addCategory} className="flex gap-2 border-t pt-3">
            <Input required placeholder="Nova categoria" value={catName} onChange={(e) => setCatName(e.target.value)} />
            <Select value={catKind} onValueChange={setCatKind}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="receita">Receita</SelectItem><SelectItem value="despesa">Despesa</SelectItem></SelectContent></Select>
            <Button size="sm" disabled={busy}>Adicionar</Button>
          </form>
        )}
      </section>

      <section className="rounded-xl border bg-card p-5 lg:col-span-2">
        <h3 className="mb-1 font-semibold">Condições de cartão</h3>
        <p className="mb-3 text-xs text-muted-foreground">Vendas no cartão viram recebíveis da operadora conforme estas condições — não entram como dinheiro disponível na hora.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["cartao_credito", "cartao_debito"] as const).map((m) => {
            const s = data.cardSettings.find((x) => x.method === m);
            return <CardSettingRow key={m} method={m} fee={s?.fee_pct != null ? String(s.fee_pct).replace(".", ",") : ""} days={s?.receive_days != null ? String(s.receive_days) : ""} onSave={saveCard} disabled={!perms.registerPayments} />;
          })}
        </div>
      </section>
    </div>
  );
}

function CardSettingRow({ method, fee, days, onSave, disabled }: { method: string; fee: string; days: string; onSave: (m: string, fee: string, days: string) => void; disabled: boolean }) {
  const [f, setF] = useState(fee);
  const [d, setD] = useState(days);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
      <p className="w-full text-sm font-medium">{PAYMENT_LABEL[method as keyof typeof PAYMENT_LABEL]}</p>
      <Fld label="Taxa (%)"><Input className="w-24" value={f} onChange={(e) => setF(e.target.value)} inputMode="decimal" disabled={disabled} /></Fld>
      <Fld label="Recebe em (dias)"><Input className="w-24" value={d} onChange={(e) => setD(e.target.value)} inputMode="numeric" disabled={disabled} /></Fld>
      {!disabled && <Button size="sm" variant="outline" onClick={() => onSave(method, f, d)}>Salvar</Button>}
    </div>
  );
}

/* ---------------- compartilhados ---------------- */

function Kpi({ label, value, note, highlight, danger }: { label: string; value: string; note?: string; highlight?: boolean; danger?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-gold/40 bg-gold-soft" : "bg-card"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-xl font-semibold ${danger ? "text-destructive" : ""}`}>{value}</p>
      {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
