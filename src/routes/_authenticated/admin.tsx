import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ACCESS_LABEL, BILLING_LABEL } from "@/lib/platform";
import { formatBRL, parseBRLToCents } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountMenu } from "@/components/app/AccountMenu";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Administração da plataforma — MLI Gestão" },
      { name: "description", content: "Lojas, planos, testes, cortesias e suspensões da plataforma MLI Gestão." },
      { property: "og:title", content: "Administração da plataforma — MLI Gestão" },
      { property: "og:description", content: "Lojas, planos, testes, cortesias e suspensões da plataforma MLI Gestão." },
      { name: "robots", content: "noindex" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPage,
});

function AdminDenied() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return (
    <div className="relative grid min-h-screen place-items-center p-6 text-center">
      <div className="absolute right-4 top-4"><AccountMenu /></div>
      <div>
        <p className="font-semibold">Acesso restrito ao administrador da plataforma.</p>
        <p className="mt-2 text-sm text-muted-foreground">Sua conta de loja não tem autorização para esta área.</p>
        <div className="mt-4 flex justify-center gap-3">
          <Link to="/app" className="mt-2 inline-block text-sm underline">Voltar para a loja</Link>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await qc.cancelQueries();
              qc.clear();
              await supabase.auth.signOut();
              navigate({ to: "/auth", search: { redirect: "/admin" }, replace: true });
            }}
          >
            Sair e trocar de conta
          </Button>
        </div>
      </div>
    </div>
  );
}

type StoreRow = {
  id: string; name: string; email: string | null; phone: string | null; created_at: string; owners: string[]; users: number; user_limit: number | null;
  plan: string | null; contracted_price: number | null; billing_status: string; access_status: string; access_until: string | null; renewal_canceled: boolean; access_ok: boolean;
};

function AdminPage() {
  const { user } = Route.useRouteContext();
  const { data: isAdmin, isLoading } = useQuery({
    queryKey: ["is-platform-admin"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin");
      return (data ?? []).length > 0;
    },
  });
  if (isLoading) return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!isAdmin) return <AdminDenied />;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">Administração da plataforma</h1><p className="text-sm text-muted-foreground">Sem acesso a estoque, clientes ou financeiro das lojas.</p></div>
        <div className="ml-auto flex items-center gap-3"><Link to="/app" className="text-sm underline">Ir para a gestão da loja</Link><AccountMenu email={user.email ?? null} /></div>
      </div>
      <Tabs defaultValue="geral">
        <TabsList><TabsTrigger value="geral">Visão geral</TabsTrigger><TabsTrigger value="lojas">Lojas</TabsTrigger><TabsTrigger value="planos">Planos</TabsTrigger></TabsList>
        <TabsContent value="geral" className="mt-4"><Overview /></TabsContent>
        <TabsContent value="lojas" className="mt-4"><Stores /></TabsContent>
        <TabsContent value="planos" className="mt-4"><Plans /></TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string | undefined }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p>{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</div>;
}

type Overview = { total: number; legacy: number; trial: number; trial_expired: number; paid: number; courtesy: number; past_due: number; suspended: number; renewal_canceled: number; mrr_stores: number; mrr: number };

function Overview() {
  const { data, error } = useQuery({ queryKey: ["admin-overview"], queryFn: async () => { const r = await supabase.rpc("admin_overview"); if (r.error) throw r.error; return r.data as unknown as Overview; } });
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  if (!data) return null;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Lojas" value={data.total} />
        <Stat label="Em teste" value={data.trial} hint={data.trial_expired ? `${data.trial_expired} com teste vencido` : undefined} />
        <Stat label="Assinatura paga vigente" value={data.paid} />
        <Stat label="Cortesia" value={data.courtesy} hint="Não é pagamento confirmado" />
        <Stat label="Pagamento atrasado" value={data.past_due} />
        <Stat label="Suspensas" value={data.suspended} />
        <Stat label="Renovação cancelada" value={data.renewal_canceled} />
        <Stat label="Acesso legado" value={data.legacy} hint="Lojas anteriores às assinaturas, mantidas liberadas" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Receita recorrente contratada" value={data.mrr_stores > 0 ? formatBRL(data.mrr) : "Sem dados"} hint="Só assinaturas pagas com renovação ativa e valor contratado. Exclui testes e cortesias." />
        <Stat label="Recebimentos" value="Integração pendente" />
        <Stat label="Taxas" value="Integração pendente" />
        <Stat label="Líquido" value="Integração pendente" />
      </div>
    </div>
  );
}

function Stores() {
  const { data = [] } = useQuery({ queryKey: ["admin-stores"], queryFn: async () => { const r = await supabase.rpc("admin_stores"); if (r.error) throw r.error; return r.data as unknown as StoreRow[]; } });
  const [q, setQ] = useState("");
  const [billing, setBilling] = useState("all");
  const [access, setAccess] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => data.filter((s) => {
    const t = q.trim().toLowerCase();
    const match = !t || [s.name, s.email, s.phone, ...s.owners].some((v) => (v ?? "").toLowerCase().includes(t));
    return match && (billing === "all" || s.billing_status === billing) && (access === "all" || s.access_status === access);
  }), [data, q, billing, access]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Buscar loja, responsável ou contato" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={billing} onValueChange={setBilling}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Toda cobrança</SelectItem>{Object.entries(BILLING_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
        <Select value={access} onValueChange={setAccess}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todo acesso</SelectItem>{Object.entries(ACCESS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground"><tr className="border-b">
            <th className="p-3">Loja</th><th className="p-3">Responsável</th><th className="p-3">Contato</th><th className="p-3">Cadastro</th><th className="p-3">Plano</th><th className="p-3">Cobrança</th><th className="p-3">Acesso</th><th className="p-3">Acesso até</th><th className="p-3">Usuários</th>
          </tr></thead>
          <tbody className="divide-y">
            {list.map((s) => (
              <tr key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen(s.id)}>
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3">{s.owners.join(", ") || "—"}</td>
                <td className="p-3">{[s.email, s.phone].filter(Boolean).join(" · ") || "—"}</td>
                <td className="p-3">{formatDate(s.created_at)}</td>
                <td className="p-3">{s.plan ?? "—"}</td>
                <td className="p-3">{BILLING_LABEL[s.billing_status] ?? s.billing_status}{s.renewal_canceled ? " · renovação cancelada" : ""}</td>
                <td className="p-3"><Badge variant={s.access_ok ? "secondary" : "destructive"}>{s.access_ok ? ACCESS_LABEL[s.access_status] : s.access_status === "suspended" ? "Suspenso" : "Vencido"}</Badge></td>
                <td className="p-3">{s.access_until ? formatDate(s.access_until) : "—"}</td>
                <td className="p-3">{s.users}{s.user_limit ? ` / ${s.user_limit}` : " / sem limite"}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={9} className="p-4 text-muted-foreground">Nenhuma loja.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <StoreDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

const ACTIONS = { trial: "Conceder teste", courtesy: "Conceder cortesia", extend: "Estender acesso", suspend: "Suspender", reactivate: "Reativar" } as const;
type Action = keyof typeof ACTIONS;

function StoreDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-store", id], queryFn: async () => { const r = await supabase.rpc("admin_store_detail", { _store_id: id }); if (r.error) throw r.error; return r.data as any; } });
  const { data: plans = [] } = useQuery({ queryKey: ["admin-plans"], queryFn: async () => (await supabase.from("plans").select("*").order("name")).data ?? [] });
  const [action, setAction] = useState<Action | "plan" | null>(null);
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [planId, setPlanId] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!action || busy) return;
    if (!reason.trim()) { toast.error("Informe o motivo."); return; }
    const label = action === "plan" ? "Alterar plano" : ACTIONS[action];
    if (!window.confirm(`Confirmar "${label}" para ${data?.store.name}?`)) return;
    setBusy(true);
    const r = action === "plan"
      ? await supabase.rpc("admin_assign_plan", { _store_id: id, _plan_id: planId, _reason: reason })
      : await supabase.rpc("admin_set_access", { _store_id: id, _action: action, _until: until ? new Date(`${until}T23:59:59-03:00`).toISOString() : (null as unknown as string), _reason: reason });
    setBusy(false);
    if (r.error) { toast.error(r.error.message); return; }
    toast.success("Registrado no histórico.");
    setAction(null); setReason(""); setUntil("");
    for (const k of [["admin-store", id], ["admin-stores"], ["admin-overview"]]) qc.invalidateQueries({ queryKey: k });
  }

  const sub = data?.subscription;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{data?.store.name ?? "Loja"}</DialogTitle></DialogHeader>
        {data && (
          <div className="space-y-5 text-sm">
            <div className="grid gap-1 sm:grid-cols-2">
              <p>Razão social: {data.store.legal_name ?? "—"}</p><p>Documento: {data.store.document ?? "—"}</p>
              <p>E-mail: {data.store.email ?? "—"}</p><p>Telefone: {data.store.phone ?? "—"}</p>
              <p>Endereço: {data.store.address ?? "—"}</p><p>Cadastro: {formatDate(data.store.created_at)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p>Cobrança: <b>{BILLING_LABEL[sub?.billing_status ?? "none"]}</b>{sub?.renewal_canceled ? " · renovação cancelada" : ""}</p>
              <p>Acesso: <b>{ACCESS_LABEL[sub?.access_status ?? "active"]}</b>{sub?.access_until ? ` · até ${formatDate(sub.access_until)}` : ""}</p>
              <p>Valor contratado: {sub?.contracted_price != null ? formatBRL(sub.contracted_price) : "—"} · Limite de usuários: {sub?.user_limit ?? "sem limite"}</p>
              <p>Provedor: {sub?.provider ?? "Integração pendente"} · Próximo vencimento: {formatDate(sub?.next_due_date)}</p>
            </div>
            <div>
              <p className="mb-1 font-medium">Usuários</p>
              <ul className="text-muted-foreground">{data.members.map((m: any, i: number) => <li key={i}>{m.email} · {m.role === "owner" ? "Proprietário" : m.role === "manager" ? "Gerente" : "Vendedor"}</li>)}</ul>
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ACTIONS) as Action[]).filter((a) => a === "reactivate" ? sub?.access_status === "suspended" : a === "suspend" ? sub?.access_status !== "suspended" : true)
                .map((a) => <Button key={a} size="sm" variant={a === "suspend" ? "destructive" : "outline"} onClick={() => setAction(a)}>{ACTIONS[a]}</Button>)}
              <Button size="sm" variant="outline" onClick={() => setAction("plan")}>Alterar plano</Button>
            </div>
            {action && (
              <form onSubmit={submit} className="space-y-2 rounded-lg border p-3">
                <p className="font-medium">{action === "plan" ? "Alterar plano" : ACTIONS[action]}</p>
                {action === "plan" && (
                  <Select value={planId} onValueChange={setPlanId}><SelectTrigger><SelectValue placeholder="Plano ativo" /></SelectTrigger>
                    <SelectContent>{plans.filter((p) => p.active).map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {formatBRL(p.monthly_price)}</SelectItem>)}</SelectContent></Select>
                )}
                {(action === "trial" || action === "courtesy" || action === "extend") && <div className="space-y-1"><Label>Válido até</Label><Input type="date" required value={until} onChange={(e) => setUntil(e.target.value)} /></div>}
                <div className="space-y-1"><Label>Motivo *</Label><Textarea required value={reason} onChange={(e) => setReason(e.target.value)} /></div>
                <div className="flex gap-2"><Button disabled={busy}>Confirmar</Button><Button type="button" variant="ghost" onClick={() => setAction(null)}>Cancelar</Button></div>
              </form>
            )}
            <div>
              <p className="mb-1 font-medium">Histórico administrativo</p>
              <ul className="divide-y">
                {data.history.length === 0 && <li className="py-2 text-muted-foreground">Sem registros.</li>}
                {data.history.map((h: any, i: number) => (
                  <li key={i} className="py-2">
                    <p><b>{h.action}</b> · {formatDateTime(h.created_at)} · {h.actor ?? "—"}</p>
                    {h.reason && <p className="text-muted-foreground">Motivo: {h.reason}</p>}
                    {(h.before || h.after) && <p className="break-all text-xs text-muted-foreground">{JSON.stringify(h.before)} → {JSON.stringify(h.after)}</p>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Plans() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["admin-plans"], queryFn: async () => (await supabase.from("plans").select("*").order("name")).data ?? [] });
  const [f, setF] = useState({ name: "", description: "", price: "", limit: "" });
  const reload = () => qc.invalidateQueries({ queryKey: ["admin-plans"] });

  async function add(e: FormEvent) {
    e.preventDefault();
    const cents = parseBRLToCents(f.price);
    if (cents == null) { toast.error("Informe o valor mensal."); return; }
    const { error } = await supabase.from("plans").insert({ name: f.name.trim(), description: f.description || null, monthly_price: cents / 100, user_limit: f.limit ? Number(f.limit) : null });
    if (error) { toast.error(error.message); return; }
    setF({ name: "", description: "", price: "", limit: "" }); reload();
  }
  async function update(id: string, patch: { monthly_price?: number; user_limit?: number | null; active?: boolean }) {
    const { error } = await supabase.from("plans").update(patch).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Plano atualizado. Assinantes atuais mantêm o valor contratado."); reload(); }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="grid gap-2 rounded-xl border bg-card p-4 md:grid-cols-5">
        <Input required placeholder="Nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input placeholder="Descrição" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <Input required inputMode="decimal" placeholder="Valor mensal (R$)" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        <Input inputMode="numeric" placeholder="Limite de usuários" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} />
        <Button>Criar plano</Button>
      </form>
      <ul className="divide-y rounded-xl border bg-card">
        {data.length === 0 && <li className="p-4 text-sm text-muted-foreground">Nenhum plano cadastrado. Nenhum preço foi definido automaticamente.</li>}
        {data.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <div className="flex-1"><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.description ?? "—"}</p></div>
            <span>{formatBRL(p.monthly_price)}/mês</span>
            <span>{p.user_limit ?? "sem limite"} usuários</span>
            <Button size="sm" variant="outline" onClick={() => {
              const v = window.prompt("Novo valor mensal para NOVAS adesões (R$):", String(p.monthly_price));
              const c = v == null ? null : parseBRLToCents(v);
              if (c != null) update(p.id, { monthly_price: c / 100 });
            }}>Alterar valor</Button>
            <Button size="sm" variant="outline" onClick={() => {
              const v = window.prompt("Limite de usuários (vazio = sem limite):", p.user_limit?.toString() ?? "");
              if (v != null) update(p.id, { user_limit: v.trim() ? Number(v) : null });
            }}>Alterar limite</Button>
            <label className="flex items-center gap-2">Ativo<Switch checked={p.active} onCheckedChange={(v) => update(p.id, { active: v })} /></label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Mudanças de valor ou limite valem para novas adesões; lojas já vinculadas mantêm o valor e o limite contratados. Plano inativo não aceita novas adesões.</p>
    </div>
  );
}
