import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { MessageCircle, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";
import { STAGES, STAGE_LABEL, whatsappUrl, type Stage } from "@/lib/crm";
import { centsToDecimal, formatBRL, parseBRLToCents } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/app/clientes")({
  head: () => ({ meta: [{ title: "Clientes e CRM — MLI Gestão" }, { name: "description", content: "Clientes, funil de oportunidades, tarefas de retorno e histórico de compras." }, { property: "og:title", content: "Clientes e CRM — MLI Gestão" }, { property: "og:description", content: "Clientes, funil de oportunidades, tarefas de retorno e histórico de compras." }] }),
  component: Clientes,
});

function WhatsButton({ phone }: { phone: string | null }) {
  const url = whatsappUrl(phone);
  if (!url) return null;
  return (
    <Button asChild size="sm" variant="outline"><a href={url} target="_blank" rel="noreferrer"><MessageCircle className="mr-1 h-4 w-4" />WhatsApp</a></Button>
  );
}

function Clientes() {
  const { store, userId, perms } = useStore();
  const qc = useQueryClient();
  const key = ["crm", store.id];
  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [c, o, t, m, s] = await Promise.all([
        supabase.from("clients").select("id, name, whatsapp, email").eq("store_id", store.id).order("name"),
        supabase.from("opportunities").select("*").eq("store_id", store.id).order("updated_at", { ascending: false }),
        supabase.from("crm_tasks").select("*").eq("store_id", store.id).order("due_at"),
        supabase.from("store_members").select("user_id, email").eq("store_id", store.id),
        supabase.from("sales").select("id, client_id, receipt_number, total, status, created_at").eq("store_id", store.id).order("created_at", { ascending: false }),
      ]);
      for (const r of [c, o, t, m, s]) if (r.error) throw r.error;
      return { clients: c.data!, opps: o.data!, tasks: t.data!, members: m.data!, sales: s.data! };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const clients = data?.clients ?? [];
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name ?? "—";
  const memberName = (id: string) => data?.members.find((m) => m.user_id === id)?.email ?? "—";
  const canEdit = (owner: string) => owner === userId || perms.manageTeam;

  const [oppOpen, setOppOpen] = useState(false);
  const [opp, setOpp] = useState({ client_id: "", owner_id: userId, desired_model: "", budget: "", notes: "" });
  const [taskOpen, setTaskOpen] = useState(false);
  const [task, setTask] = useState({ title: "", due_at: "", client_id: "", opportunity_id: "" });
  const [newClient, setNewClient] = useState({ name: "", whatsapp: "" });
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState(false);
  const [dupCheck, setDupCheck] = useState<{ id: string; name: string; whatsapp: string | null; email: string | null } | null>(null);

  async function run(p: PromiseLike<{ error: { message: string } | null }>, ok: string) {
    const { error } = await p;
    if (error) { toast.error(error.message); return false; }
    toast.success(ok); refresh(); return true;
  }

  async function saveOpp() {
    if (!opp.client_id) { toast.error("Escolha um cliente existente."); return; }
    const budget = opp.budget.trim() ? parseBRLToCents(opp.budget) : null;
    if (opp.budget.trim() && budget == null) { toast.error("Orçamento inválido."); return; }
    if (await run(supabase.from("opportunities").insert({
      store_id: store.id, client_id: opp.client_id, owner_id: opp.owner_id, desired_model: opp.desired_model || null,
      budget: budget == null ? null : budget / 100, notes: opp.notes || null,
    }), "Oportunidade criada.")) { setOppOpen(false); setOpp({ client_id: "", owner_id: userId, desired_model: "", budget: "", notes: "" }); }
  }

  async function saveTask() {
    if (!task.title.trim() || !task.due_at) { toast.error("Informe título e data do retorno."); return; }
    if (await run(supabase.from("crm_tasks").insert({
      store_id: store.id, title: task.title.trim(), due_at: new Date(task.due_at).toISOString(),
      client_id: task.client_id || null, opportunity_id: task.opportunity_id || null,
    }), "Lembrete criado.")) { setTaskOpen(false); setTask({ title: "", due_at: "", client_id: "", opportunity_id: "" }); }
  }

  async function addClient() {
    const name = newClient.name.trim();
    if (!name) return;
    const digits = newClient.whatsapp.replace(/\D/g, "");
    const phoneDup = digits ? clients.find((c) => (c.whatsapp ?? "").replace(/\D/g, "") === digits) : undefined;
    if (phoneDup) { setHistoryFor(null); setDupCheck(phoneDup); return; }
    const nameDup = clients.some((c) => c.name.trim().toLowerCase() === name.toLowerCase());
    if (nameDup && !confirmName) { setConfirmName(true); return; }
    setConfirmName(false);
    if (await run(supabase.from("clients").insert({ store_id: store.id, name, whatsapp: newClient.whatsapp.trim() || null }), "Cliente cadastrado.")) setNewClient({ name: "", whatsapp: "" });
  }

  const now = Date.now();
  return (
    <div>
      <PageHeader title="Clientes e CRM" subtitle="Mudar a etapa do funil não gera faturamento nem movimenta estoque." actions={<>
        <Button variant="outline" onClick={() => setTaskOpen(true)}><Plus className="mr-1 h-4 w-4" />Lembrete</Button>
        <Button onClick={() => setOppOpen(true)}><Plus className="mr-1 h-4 w-4" />Oportunidade</Button>
      </>} />
      <Tabs defaultValue="funil">
        <TabsList><TabsTrigger value="funil">Funil</TabsTrigger><TabsTrigger value="tarefas">Tarefas</TabsTrigger><TabsTrigger value="clientes">Clientes</TabsTrigger></TabsList>

        <TabsContent value="funil" className="mt-4">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {STAGES.map((st) => (
              <div key={st} className="rounded-xl border bg-card p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{STAGE_LABEL[st]}</h3>
                <ul className="space-y-2">
                  {(data?.opps ?? []).filter((o) => o.stage === st).map((o) => {
                    const c = clients.find((x) => x.id === o.client_id);
                    const sales = (data?.sales ?? []).filter((s) => s.client_id === o.client_id && s.status === "concluida");
                    return (
                      <li key={o.id} className="space-y-1.5 rounded-lg border p-2 text-sm">
                        <p className="font-medium">{c?.name}</p>
                        {o.desired_model && <p className="text-muted-foreground">{o.desired_model}</p>}
                        {o.budget != null && <p>{formatBRL(o.budget)}</p>}
                        {o.notes && <p className="text-xs text-muted-foreground">{o.notes}</p>}
                        <p className="text-xs text-muted-foreground">Resp.: {memberName(o.owner_id)}</p>
                        {canEdit(o.owner_id) ? (<>
                          <Select value={o.stage} onValueChange={(v) => run(supabase.from("opportunities").update({ stage: v as Stage }).eq("id", o.id), "Etapa atualizada.")}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>)}</SelectContent>
                          </Select>
                          <Select value={o.sale_id ?? "none"} onValueChange={(v) => run(supabase.from("opportunities").update({ sale_id: v === "none" ? null : v }).eq("id", o.id), "Vínculo atualizado.")}>
                            <SelectTrigger className="h-8"><SelectValue placeholder="Vincular venda" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Sem venda vinculada</SelectItem>
                              {sales.map((s) => <SelectItem key={s.id} value={s.id}>Venda nº {s.receipt_number} — {formatBRL(s.total)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </>) : o.sale_id && <p className="text-xs">Venda vinculada</p>}
                        {o.sale_id && <Link to="/app/vendas/$id" params={{ id: o.sale_id }} className="text-xs underline">Ver venda</Link>}
                        <WhatsButton phone={c?.whatsapp ?? null} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="tarefas" className="mt-4">
          <ul className="divide-y rounded-xl border bg-card">
            {(data?.tasks ?? []).length === 0 && <li className="p-4 text-sm text-muted-foreground">Nenhum lembrete.</li>}
            {(data?.tasks ?? []).map((t) => {
              const late = !t.done_at && new Date(t.due_at).getTime() < now;
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <Checkbox checked={!!t.done_at} disabled={!canEdit(t.assigned_to)}
                    onCheckedChange={(v) => run(supabase.from("crm_tasks").update({ done_at: v === true ? new Date().toISOString() : null }).eq("id", t.id), "Lembrete atualizado.")} />
                  <div className="flex-1">
                    <p className={t.done_at ? "line-through text-muted-foreground" : "font-medium"}>{t.title}</p>
                    <p className={`text-xs ${late ? "text-destructive" : "text-muted-foreground"}`}>{formatDateTime(t.due_at)}{late ? " • atrasado" : ""} • {clientName(t.client_id)} • {memberName(t.assigned_to)}</p>
                  </div>
                  <WhatsButton phone={clients.find((c) => c.id === t.client_id)?.whatsapp ?? null} />
                </li>
              );
            })}
          </ul>
        </TabsContent>

        <TabsContent value="clientes" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-xs" placeholder="Nome" value={newClient.name} onChange={(e) => { setConfirmName(false); setNewClient({ ...newClient, name: e.target.value }); }} />
            <Input className="max-w-xs" placeholder="WhatsApp" value={newClient.whatsapp} onChange={(e) => setNewClient({ ...newClient, whatsapp: e.target.value })} />
            <Button variant="outline" onClick={addClient}>{confirmName ? "Cadastrar mesmo assim" : "Cadastrar cliente"}</Button>
          </div>
          {confirmName && <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">Já existe cliente com este nome. Confira na lista abaixo; se for outra pessoa, clique em “Cadastrar mesmo assim”.</p>}
          <ul className="divide-y rounded-xl border bg-card">
            {clients.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <div className="flex-1"><p className="font-medium">{c.name}</p><p className="text-xs text-muted-foreground">{c.whatsapp ?? "Sem WhatsApp"}</p></div>
                <Button size="sm" variant="ghost" onClick={() => setHistoryFor(c.id)}>Compras</Button>
                <WhatsButton phone={c.whatsapp} />
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>

      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Compras de {clientName(historyFor)}</DialogTitle></DialogHeader>
          <ul className="divide-y text-sm">
            {(data?.sales ?? []).filter((s) => s.client_id === historyFor).map((s) => (
              <li key={s.id} className="flex justify-between py-2">
                <Link to="/app/vendas/$id" params={{ id: s.id }} className="underline">Nº {s.receipt_number} • {formatDate(s.created_at)}</Link>
                <span>{formatBRL(s.total)}{s.status === "cancelada" ? " (cancelada)" : ""}</span>
              </li>
            ))}
            {!(data?.sales ?? []).some((s) => s.client_id === historyFor) && <li className="py-2 text-muted-foreground">Nenhuma compra.</li>}
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dupCheck} onOpenChange={(o) => !o && setDupCheck(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>WhatsApp já cadastrado</DialogTitle></DialogHeader>
          <div className="space-y-1 text-sm">
            <p>Este número pertence a um cliente existente. Confira antes de continuar:</p>
            <p className="font-medium">{dupCheck?.name}</p>
            <p className="text-muted-foreground">{dupCheck?.whatsapp}{dupCheck?.email ? ` • ${dupCheck.email}` : ""}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { const id = dupCheck?.id ?? null; setDupCheck(null); setHistoryFor(id); }}>Ver compras</Button>
            <Button onClick={() => { setDupCheck(null); setNewClient({ name: "", whatsapp: "" }); }}>Usar cadastro existente</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={oppOpen} onOpenChange={setOppOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova oportunidade</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Cliente *</Label>
              <Select value={opp.client_id} onValueChange={(v) => setOpp({ ...opp, client_id: v })}>
                <SelectTrigger><SelectValue placeholder="Cliente cadastrado" /></SelectTrigger>
                <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select></div>
            {perms.manageTeam && <div className="space-y-1.5"><Label>Responsável</Label>
              <Select value={opp.owner_id} onValueChange={(v) => setOpp({ ...opp, owner_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(data?.members ?? []).map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.email ?? m.user_id}</SelectItem>)}</SelectContent>
              </Select></div>}
            <div className="space-y-1.5"><Label>Modelo desejado</Label><Input value={opp.desired_model} onChange={(e) => setOpp({ ...opp, desired_model: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Orçamento (R$)</Label><Input inputMode="decimal" value={opp.budget} onChange={(e) => setOpp({ ...opp, budget: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Observações</Label><Textarea value={opp.notes} onChange={(e) => setOpp({ ...opp, notes: e.target.value })} /></div>
            <Button className="w-full" onClick={saveOpp}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo lembrete de retorno</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Título *</Label><Input value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Quando *</Label><Input type="datetime-local" value={task.due_at} onChange={(e) => setTask({ ...task, due_at: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Cliente</Label>
              <Select value={task.client_id} onValueChange={(v) => setTask({ ...task, client_id: v })}>
                <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select></div>
            <Button className="w-full" onClick={saveTask}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
