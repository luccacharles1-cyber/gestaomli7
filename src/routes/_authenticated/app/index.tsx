import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ShoppingCart, Smartphone, UserPlus, Receipt, CheckCircle2, Circle, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";
import { stockCapitalCents } from "@/lib/devices";
import { accountBalanceCents, installmentStatus, type FinancialAccount, type FinancialEntry } from "@/lib/finance";
import { formatCents, toCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({ meta: [{ title: "Início — MLI Gestão" }, { name: "description", content: "Resumo da sua loja." }, { property: "og:title", content: "Início — MLI Gestão" }, { property: "og:description", content: "Resumo da sua loja." },{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"}] }),
  component: Dashboard,
});

function Dashboard() {
  const { store, perms } = useStore();
  const [period, setPeriod] = useState("mes");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [finView, setFinView] = useState<"competencia" | "caixa">("competencia");

  const range = useMemo(() => {
    const today = todayISO();
    let f = from, t = to;
    if (period === "hoje") { f = today; t = today; }
    else if (period === "7d") { f = new Date(Date.now() - 6 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); t = today; }
    else if (period === "mes") { f = `${today.slice(0, 7)}-01`; t = today; }
    return { gte: `${f}T00:00:00-03:00`, lte: `${t}T23:59:59.999-03:00` };
  }, [period, from, to]);

  const { data } = useQuery({
    queryKey: ["dashboard", store.id, perms.viewCosts, range.gte, range.lte],
    queryFn: async () => {
      const [devices, photos, costs, accessories, accCosts, members, highlights, sales, soldItems, finAccounts, finEntries, finInstallments, soldProducts] = await Promise.all([
        supabase.from("devices").select("id, status").eq("store_id", store.id),
        supabase.from("device_photos").select("device_id").eq("store_id", store.id),
        perms.viewCosts ? supabase.from("device_costs").select("device_id, total_cost").eq("store_id", store.id) : Promise.resolve({ data: [] }),
        supabase.from("accessories").select("id, quantity").eq("store_id", store.id),
        perms.viewCosts ? supabase.from("accessory_costs").select("accessory_id, unit_cost").eq("store_id", store.id) : Promise.resolve({ data: [] }),
        supabase.from("store_members").select("id").eq("store_id", store.id),
        supabase.from("highlights").select("*").eq("active", true).order("position"),
        supabase.from("sales").select("id, total, created_at, clients(name)").eq("store_id", store.id).eq("status", "concluida").gte("created_at", range.gte).lte("created_at", range.lte).order("created_at", { ascending: false }),
        perms.viewCosts
          ? supabase.from("sale_items").select("sale_id, device_id, sales!inner(store_id, status, created_at)").eq("sales.store_id", store.id).eq("sales.status", "concluida").gte("sales.created_at", range.gte).lte("sales.created_at", range.lte)
          : Promise.resolve({ data: [] }),
        perms.viewFinance ? supabase.from("financial_accounts").select("*").eq("store_id", store.id) : Promise.resolve({ data: [] }),
        perms.viewFinance ? supabase.from("financial_entries").select("kind, status, amount, paid_amount, account_id, due_date, competence_date, paid_at, is_transfer, is_equity, contract_id").eq("store_id", store.id) : Promise.resolve({ data: [] }),
        perms.viewFinance ? supabase.from("credit_installments").select("amount, paid_amount, due_date, status, credit_contracts!inner(store_id, status)").eq("store_id", store.id).eq("credit_contracts.status", "ativo") : Promise.resolve({ data: [] }),
        perms.viewCosts ? supabase.from("sale_product_items").select("quantity, sale_product_costs(unit_cost), sales!inner(status,created_at)").eq("store_id",store.id).eq("sales.status","concluida").gte("sales.created_at",range.gte).lte("sales.created_at",range.lte) : Promise.resolve({data:[]}),
      ]);
      const costMap = new Map((costs.data ?? []).map((c) => [c.device_id, c.total_cost]));
      const accMap = new Map((accCosts.data ?? []).map((c) => [c.accessory_id, c.unit_cost]));
      const devs = devices.data ?? [];
      const withPhoto = new Set((photos.data ?? []).map((p) => p.device_id));
      return {
        capital: perms.viewCosts
          ? stockCapitalCents(
              devs.map((d) => ({ status: d.status, total_cost: costMap.get(d.id) ?? null })),
              (accessories.data ?? []).map((a) => ({ quantity: a.quantity, unit_cost: accMap.get(a.id) ?? null })),
            )
          : null,
        available: devs.filter((d) => d.status === "disponivel").length,
        inReview: devs.filter((d) => d.status === "em_conferencia").length,
        noPhoto: devs.filter((d) => !["vendido", "devolvido_fornecedor"].includes(d.status) && !withPhoto.has(d.id)).length,
        noCost: perms.viewCosts ? devs.filter((d) => !costMap.has(d.id)).length : 0,
        totalDevices: devs.length,
        members: members.data?.length ?? 1,
        highlights: highlights.data ?? [],
        sales: sales.data ?? [],
        grossProfit: perms.viewCosts
          ? (sales.data ?? []).reduce((acc, s) => acc + toCents(s.total), 0) -
            (soldItems.data ?? []).reduce((acc, i) => acc + toCents(costMap.get(i.device_id) ?? null), 0) -
            (soldProducts.data ?? []).reduce((acc, i) => acc + toCents(i.sale_product_costs?.unit_cost ?? null) * i.quantity, 0)
          : null,
        finAccounts: (finAccounts.data ?? []) as FinancialAccount[],
        finEntries: (finEntries.data ?? []) as FinancialEntry[],
        finInstallments: (finInstallments.data ?? []) as Array<{ amount: number | string; paid_amount: number | string; due_date: string; status: string }>,
      };
    },
  });

  const revenueCents = (data?.sales ?? []).reduce((acc, s) => acc + toCents(s.total), 0);
  const salesCount = data?.sales.length ?? 0;

  const fin = useMemo(() => {
    if (!perms.viewFinance || !data) return null;
    const today = todayISO();
    const entries = data.finEntries;
    const saldo = data.finAccounts.filter((a) => a.active).reduce((acc, a) => acc + accountBalanceCents(a, entries, a.id, toCents), 0);
    const open = entries.filter((e) => e.status === "pendente" || e.status === "parcial");
    const aReceber = open.filter((e) => e.kind === "entrada").reduce((a, e) => a + toCents(e.amount) - toCents(e.paid_amount), 0);
    const aPagar = open.filter((e) => e.kind === "saida").reduce((a, e) => a + toCents(e.amount) - toCents(e.paid_amount), 0);
    const credAtraso = data.finInstallments.filter((i) => installmentStatus(i, today) === "vencido").reduce((a, i) => a + toCents(i.amount) - toCents(i.paid_amount), 0);
    const inPeriod = (d: string | null) => !!d && d >= range.gte.slice(0, 10) && d <= range.lte.slice(0, 10);
    const operational = entries.filter((e) => !e.is_transfer && !e.is_equity && e.status !== "cancelado" && e.status !== "estornado");
    const netComp = operational.filter((e) => inPeriod(e.competence_date)).reduce((a, e) => a + (e.kind === "entrada" ? toCents(e.amount) : -toCents(e.amount)), 0);
    const netCaixa = operational.filter((e) => e.status === "pago" && inPeriod(e.paid_at)).reduce((a, e) => a + (e.kind === "entrada" ? toCents(e.paid_amount) : -toCents(e.paid_amount)), 0);
    return { saldo, aReceber, aPagar, credAtraso, netComp, netCaixa };
  }, [data, perms.viewFinance, range]);

  const checklist = [
    { done: !!(store.document && store.phone && store.address), label: "Completar dados da loja", to: "/app/configuracoes" as const },
    { done: !!store.logo_path, label: "Enviar logo da loja", to: "/app/configuracoes" as const },
    { done: !!store.warranty_text, label: "Cadastrar condições de garantia", to: "/app/configuracoes" as const },
    { done: (data?.totalDevices ?? 0) > 0, label: "Cadastrar o primeiro aparelho", to: "/app/estoque/novo" as const },
    { done: (data?.members ?? 1) > 1, label: "Convidar a equipe", to: "/app/configuracoes" as const },
  ];
  const showChecklist = checklist.some((c) => !c.done);

  const pending = [
    data?.inReview ? { text: `${data.inReview} aparelho(s) em conferência`, to: "/app/estoque" as const } : null,
    data?.noPhoto ? { text: `${data.noPhoto} aparelho(s) em estoque sem fotos`, to: "/app/estoque" as const } : null,
    data?.noCost ? { text: `${data.noCost} aparelho(s) sem custo informado`, to: "/app/estoque" as const } : null,
  ].filter(Boolean) as Array<{ text: string; to: "/app/estoque" }>;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="text-2xl font-semibold">{store.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" value={period} onValueChange={(v) => v && setPeriod(v)} variant="outline" size="sm">
            <ToggleGroupItem value="hoje">Hoje</ToggleGroupItem>
            <ToggleGroupItem value="7d">7 dias</ToggleGroupItem>
            <ToggleGroupItem value="mes">Este mês</ToggleGroupItem>
            <ToggleGroupItem value="custom">Período</ToggleGroupItem>
          </ToggleGroup>
          {period === "custom" && (
            <div className="flex gap-1">
              <Input type="date" className="h-8 w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input type="date" className="h-8 w-36" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <QuickAction icon={ShoppingCart} label="Nova venda" to="/app/vendas/nova" disabled={!perms.registerSales} />
        <QuickAction icon={Smartphone} label="Cadastrar aparelho" to="/app/estoque/novo" disabled={!perms.manageInventory} />
        <QuickAction icon={UserPlus} label="Novo contato" disabled />
        <QuickAction icon={Receipt} label="Lançar despesa" disabled />
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Indicadores do período</h2>
          <Badge variant="outline" className="text-xs">Vendas por data da venda</Badge>
          {perms.viewFinance && (
            <ToggleGroup type="single" value={finView} onValueChange={(v) => v && setFinView(v as "competencia" | "caixa")} variant="outline" size="sm">
              <ToggleGroupItem value="competencia" className="text-xs">Competência</ToggleGroupItem>
              <ToggleGroupItem value="caixa" className="text-xs">Caixa</ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Faturamento" value={formatCents(revenueCents)} />
          {perms.viewCosts && <Kpi label="Lucro bruto das vendas" value={data?.grossProfit != null ? formatCents(data.grossProfit) : "…"} />}
          {perms.viewFinance && <Kpi label="Resultado líquido gerencial" value={fin ? formatCents(finView === "competencia" ? fin.netComp : fin.netCaixa) : "…"} note={finView === "competencia" ? "Por competência: entradas menos saídas operacionais do período" : "Fluxo de caixa: só o que entrou e saiu de fato"} />}
          {perms.viewCosts && <Kpi label="Margem bruta" value={revenueCents > 0 && data?.grossProfit != null ? `${((data.grossProfit / revenueCents) * 100).toFixed(1).replace(".", ",")}%` : "—"} />}
          <Kpi label="Quantidade de vendas" value={String(salesCount)} />
          <Kpi label="Ticket médio" value={salesCount > 0 ? formatCents(Math.round(revenueCents / salesCount)) : "—"} />
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Resultado líquido gerencial = entradas operacionais menos saídas operacionais (taxas, despesas, comissões). Transferências entre contas e aportes/retiradas de sócios não entram no cálculo, e o custo do aparelho vendido já está no lucro bruto — não é descontado de novo.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Posição atual</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {perms.viewCosts && <Kpi label="Capital em estoque" value={data?.capital != null ? formatCents(data.capital) : "…"} highlight />}
          <Kpi label="Aparelhos disponíveis" value={String(data?.available ?? "…")} />
          {perms.viewFinance && <Kpi label="Saldo disponível" value={fin ? formatCents(fin.saldo) : "…"} />}
          {perms.viewFinance && <Kpi label="A receber / a pagar" value={fin ? `${formatCents(fin.aReceber)} / ${formatCents(fin.aPagar)}` : "…"} />}
          {perms.viewFinance && <Kpi label="Crediário em atraso" value={fin ? formatCents(fin.credAtraso) : "…"} />}
        </div>
      </section>

      {!!data?.highlights.length && (
        <section className="flex snap-x gap-3 overflow-x-auto pb-1">
          {data.highlights.map((h) => (
            <div key={h.id} className="flex min-w-[280px] snap-start items-center gap-3 rounded-xl border bg-card p-3">
              {h.image_url && <img src={h.image_url} alt="" className="h-14 w-14 rounded-md object-cover" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-semibold">{h.title}</p>
                  {h.sponsored && <Badge variant="outline" className="text-[10px]">Patrocinado</Badge>}
                </div>
                {h.body && <p className="line-clamp-2 text-xs text-muted-foreground">{h.body}</p>}
              </div>
              {h.cta_url && <Button asChild size="sm" variant="outline"><a href={h.cta_url} target="_blank" rel="noopener noreferrer">{h.cta_label || "Ver"}</a></Button>}
            </div>
          ))}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">{showChecklist ? "Configure sua loja" : "Pendências"}</h2>
          {showChecklist && (
            <ul className="mb-4 space-y-2">
              {checklist.map((c) => (
                <li key={c.label}>
                  <Link to={c.to} className="flex items-center gap-2 text-sm hover:underline">
                    {c.done ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                    <span className={c.done ? "text-muted-foreground line-through" : ""}>{c.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {pending.length ? (
            <ul className="space-y-2">{pending.map((p) => <li key={p.text}><Link to={p.to} className="text-sm hover:underline">• {p.text}</Link></li>)}</ul>
          ) : !showChecklist && <p className="text-sm text-muted-foreground">Nenhuma pendência no momento.</p>}
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Vendas recentes</h2>
          {data?.sales.length ? (
            <ul className="space-y-2">
              {data.sales.slice(0, 5).map((s) => (
                <li key={s.id}>
                  <Link to="/app/vendas/$id" params={{ id: s.id }} className="flex items-center justify-between gap-2 text-sm hover:underline">
                    <span className="truncate">{s.clients?.name ?? "Cliente não identificado"}</span>
                    <span className="font-medium">{formatCents(toCents(s.total))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma venda no período. As oportunidades do CRM aparecem aqui quando o módulo for liberado.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, note, highlight }: { label: string; value: string; note?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-gold/40 bg-gold-soft" : "bg-card"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold">{value}</p>
      {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function QuickAction({ icon: Icon, label, to, disabled }: { icon: typeof Smartphone; label: string; to?: "/app/estoque/novo" | "/app/vendas/nova"; disabled?: boolean }) {
  const inner = (
    <>
      <Icon className={`h-5 w-5 ${disabled ? "" : "text-gold"}`} />
      <span className="text-sm font-medium">{label}</span>
      {disabled && !to && <span className="text-[10px] text-muted-foreground">Em desenvolvimento</span>}
    </>
  );
  const cls = "flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left";
  if (to && !disabled) return <Link to={to} className={`${cls} hover:shadow-md`}>{inner}</Link>;
  return <div className={`${cls} cursor-not-allowed opacity-60`} aria-disabled>{inner}</div>;
}
