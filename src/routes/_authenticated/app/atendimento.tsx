import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Check, CheckCheck, Clock, AlertTriangle, ImagePlus, RotateCw, Send, Search } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MSG_STATUS_LABEL, SUPPORTED_TYPES, normalizePhone, templateVarCount, windowOpen } from "@/lib/whatsapp";
import { listTemplates, mediaUrl, retryMessage, sendMessage } from "@/lib/whatsapp.functions";

export const Route = createFileRoute("/_authenticated/app/atendimento")({
  head: () => ({ meta: [{ title: "Atendimento — MLI Gestão" }, { name: "description", content: "Conversas do WhatsApp integradas ao CRM da loja." }, { property: "og:title", content: "Atendimento — MLI Gestão" }, { property: "og:description", content: "Conversas do WhatsApp integradas ao CRM da loja." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Atendimento,
});

function Atendimento() {
  const { store, perms } = useStore();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const convKey = ["conversations", store.id];
  const { data: conn } = useQuery({ queryKey: ["wa-conn", store.id], queryFn: async () => (await supabase.from("whatsapp_connections").select("display_phone,mode,last_error").eq("store_id", store.id).maybeSingle()).data });
  const { data: convs = [] } = useQuery({
    queryKey: convKey, enabled: perms.attendChats,
    queryFn: async () => (await supabase.from("conversations").select("*").eq("store_id", store.id).order("last_message_at", { ascending: false, nullsFirst: false }).limit(300)).data ?? [],
  });
  useEffect(() => {
    if (!perms.attendChats) return;
    const ch = supabase.channel(`wa-${store.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `store_id=eq.${store.id}` }, () => qc.invalidateQueries({ queryKey: convKey }))
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `store_id=eq.${store.id}` }, () => qc.invalidateQueries({ queryKey: ["messages"] }))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [store.id, perms.attendChats]);

  if (!perms.attendChats) return <div className="mx-auto max-w-3xl"><PageHeader title="Atendimento" /><p className="text-sm text-muted-foreground">Você não tem permissão para atender conversas. Peça ao proprietário em Configurações → Equipe.</p></div>;

  const term = q.trim().toLowerCase();
  const list = convs.filter((c) => !term || (c.contact_name ?? "").toLowerCase().includes(term) || c.phone.includes(term.replace(/\D/g, "") || "§"));
  const current = convs.find((c) => c.id === sel) ?? null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Atendimento" />
      {!conn ? <p className="mb-3 rounded-lg border p-3 text-sm">WhatsApp ainda não conectado nesta loja. {perms.manageTeam && <Link to="/app/configuracoes" className="underline">Conectar em Configurações → Integrações</Link>}</p>
        : <p className="mb-3 text-xs text-muted-foreground">WhatsApp {conn.display_phone} · {conn.mode === "producao" ? "uso real" : "ambiente de teste"}{conn.last_error && <span className="text-destructive"> · {conn.last_error}</span>}</p>}
      <div className="grid gap-3 md:grid-cols-[320px_1fr]">
        <div className={`rounded-xl border bg-card ${current ? "hidden md:block" : ""}`}>
          <div className="relative border-b p-2"><Search className="absolute left-4 top-4 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Buscar nome ou número" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <ul className="max-h-[70vh] divide-y overflow-y-auto">
            {list.map((c) => (
              <li key={c.id}><button className={`w-full p-3 text-left hover:bg-muted ${sel === c.id ? "bg-muted" : ""}`} onClick={() => setSel(c.id)}>
                <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{c.contact_name ?? `+${c.phone}`}</span>{c.unread_count > 0 && <Badge>{c.unread_count}</Badge>}</div>
                <p className="truncate text-xs text-muted-foreground">{c.last_message_preview ?? "—"}</p>
              </button></li>
            ))}
            {!list.length && <li className="p-4 text-sm text-muted-foreground">Nenhuma conversa ainda. Elas aparecem quando um cliente envia mensagem ao número conectado.</li>}
          </ul>
        </div>
        {current ? <Chat key={current.id} conv={current} onBack={() => setSel(null)} /> : <div className="hidden place-items-center rounded-xl border p-8 text-sm text-muted-foreground md:grid">Selecione uma conversa.</div>}
      </div>
    </div>
  );
}

type Conv = { id: string; phone: string; contact_name: string | null; client_id: string | null; opportunity_id: string | null; assigned_to: string | null; unread_count: number; last_inbound_at: string | null };

function Chat({ conv, onBack }: { conv: Conv; onBack: () => void }) {
  const { store } = useStore();
  const qc = useQueryClient();
  const send = useServerFn(sendMessage), retry = useServerFn(retryMessage), getTemplates = useServerFn(listTemplates);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const key = ["messages", conv.id];
  const { data: msgs = [] } = useQuery({ queryKey: key, queryFn: async () => (await supabase.from("messages").select("*").eq("conversation_id", conv.id).order("created_at").limit(500)).data ?? [] });
  const open = windowOpen(conv.last_inbound_at);
  useEffect(() => { bottom.current?.scrollIntoView(); }, [msgs.length]);
  useEffect(() => { if (conv.unread_count > 0) void supabase.from("conversations").update({ unread_count: 0 }).eq("id", conv.id).then(() => qc.invalidateQueries({ queryKey: ["conversations", store.id] })); }, [conv.id, conv.unread_count]);

  async function run(payload: Parameters<typeof send>[0]["data"]) {
    setBusy(true);
    try { await send({ data: payload }); setText(""); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["conversations", store.id] }); }
  }
  function submit(e: FormEvent) { e.preventDefault(); if (text.trim()) void run({ storeId: store.id, conversationId: conv.id, clientToken: crypto.randomUUID(), text: text.trim() }); }
  async function sendImage(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) { toast.error("Envie JPG ou PNG."); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Imagem acima de 5 MB."); return; }
    const buf = new Uint8Array(await file.arrayBuffer()); let bin = ""; for (const b of buf) bin += String.fromCharCode(b);
    await run({ storeId: store.id, conversationId: conv.id, clientToken: crypto.randomUUID(), image: { base64: btoa(bin), mime: file.type as "image/jpeg" | "image/png", ...(text.trim() ? { caption: text.trim() } : {}) } });
  }
  async function doRetry(id: string, uncertain: boolean) {
    if (uncertain && !window.confirm("Não sabemos se a Meta recebeu esta mensagem. Reenviar pode duplicá-la para o cliente. Reenviar mesmo assim?")) return;
    try { await retry({ data: { storeId: store.id, messageId: id, confirmUncertain: uncertain } }); } catch (e) { toast.error((e as Error).message); }
    qc.invalidateQueries({ queryKey: key });
  }

  return (
    <div className="flex min-h-[70vh] flex-col rounded-xl border bg-card">
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center gap-2"><Button size="sm" variant="ghost" className="md:hidden" onClick={onBack}>←</Button><p className="font-semibold">{conv.contact_name ?? "Contato"}</p><span className="text-xs text-muted-foreground">+{conv.phone}</span></div>
        <CrmLinks conv={conv} />
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3" style={{ maxHeight: "55vh" }}>
        {msgs.map((m) => (
          <div key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.direction === "out" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}>
            {m.type === "image" && <MediaImage messageId={m.id} />}
            {!SUPPORTED_TYPES.includes(m.type) && m.type !== "template" && <p className="italic opacity-80">[{m.type}] Formato ainda não exibido no app — abra no celular.</p>}
            {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
            <p className="mt-1 flex items-center gap-1 text-[10px] opacity-75">
              {new Date(m.created_at).toLocaleString("pt-BR")}
              {m.direction === "out" && <><StatusIcon s={m.status} /> {MSG_STATUS_LABEL[m.status]}</>}
            </p>
            {m.direction === "out" && (m.status === "failed" || m.status === "unknown") && (
              <div className="mt-1 text-[11px]">{m.error && <p>{m.error}</p>}<button className="underline" onClick={() => doRetry(m.id, m.status === "unknown")}><RotateCw className="mr-1 inline h-3 w-3" />Tentar novamente</button></div>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {open ? (
        <form onSubmit={submit} className="flex items-end gap-2 border-t p-2">
          <label className="cursor-pointer p-2" aria-label="Enviar imagem"><ImagePlus className="h-5 w-5" /><input type="file" accept="image/jpeg,image/png" className="hidden" disabled={busy} onChange={(e) => { void sendImage(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <Textarea rows={2} className="flex-1" placeholder="Escreva a resposta" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) submit(e); }} />
          <Button disabled={busy || !text.trim()} aria-label="Enviar"><Send className="h-4 w-4" /></Button>
        </form>
      ) : <TemplateComposer busy={busy} getTemplates={getTemplates} onSend={(t) => run({ storeId: store.id, conversationId: conv.id, clientToken: crypto.randomUUID(), template: t })} />}
    </div>
  );
}

function StatusIcon({ s }: { s: string }) {
  if (s === "read") return <CheckCheck className="h-3 w-3" />;
  if (s === "delivered") return <CheckCheck className="h-3 w-3" />;
  if (s === "sent" || s === "accepted") return <Check className="h-3 w-3" />;
  if (s === "failed" || s === "unknown") return <AlertTriangle className="h-3 w-3" />;
  return <Clock className="h-3 w-3" />;
}

function MediaImage({ messageId }: { messageId: string }) {
  const { store } = useStore();
  const get = useServerFn(mediaUrl);
  const { data, error } = useQuery({ queryKey: ["wa-media", messageId], staleTime: 5 * 60_000, retry: 1, queryFn: async () => (await get({ data: { storeId: store.id, messageId } })).url });
  if (error) return <p className="text-xs italic">Imagem indisponível no momento.</p>;
  return data ? <a href={data} target="_blank" rel="noreferrer"><img src={data} alt="Imagem da conversa" className="mb-1 max-h-60 rounded" /></a> : <p className="text-xs italic">Carregando imagem…</p>;
}

type Tpl = { name: string; language: string; body: string };
function TemplateComposer({ busy, getTemplates, onSend }: { busy: boolean; getTemplates: (a: { data: { storeId: string } }) => Promise<Tpl[]>; onSend: (t: { name: string; language: string; params: string[] }) => void }) {
  const { store } = useStore();
  const { data: tpls = [], error, isLoading } = useQuery({ queryKey: ["wa-templates", store.id], queryFn: () => getTemplates({ data: { storeId: store.id } }) });
  const [name, setName] = useState("");
  const tpl = tpls.find((t) => `${t.name}|${t.language}` === name);
  const n = templateVarCount(tpl?.body);
  const [params, setParams] = useState<string[]>([]);
  return (
    <div className="space-y-2 border-t bg-muted/40 p-3 text-sm">
      <p className="font-medium">Já se passaram 24 horas desde a última mensagem do cliente.</p>
      <p className="text-xs text-muted-foreground">Pelas regras da Meta, só é possível retomar a conversa com um modelo de mensagem aprovado. Quando o cliente responder, o envio livre volta a funcionar.</p>
      {isLoading ? <p className="text-xs">Carregando modelos…</p> : error ? <p className="text-xs text-destructive">{(error as Error).message}</p> : !tpls.length ? <p className="text-xs">Nenhum modelo aprovado. Crie e aguarde a aprovação da Meta (até 48 horas).</p> : (
        <>
          <Select value={name} onValueChange={(v) => { setName(v); setParams([]); }}><SelectTrigger><SelectValue placeholder="Escolha um modelo aprovado" /></SelectTrigger>
            <SelectContent>{tpls.map((t) => <SelectItem key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language})</SelectItem>)}</SelectContent></Select>
          {tpl && <p className="rounded border bg-card p-2 text-xs">{tpl.body}</p>}
          {Array.from({ length: n }, (_, i) => <Input key={i} placeholder={`Valor para {{${i + 1}}}`} value={params[i] ?? ""} onChange={(e) => { const p = [...params]; p[i] = e.target.value; setParams(p); }} />)}
          <Button size="sm" disabled={busy || !tpl || params.filter((p) => p?.trim()).length < n} onClick={() => tpl && onSend({ name: tpl.name, language: tpl.language, params: params.slice(0, n).map((p) => p.trim()) })}>Enviar modelo</Button>
        </>
      )}
    </div>
  );
}

function CrmLinks({ conv }: { conv: Conv }) {
  const { store, userId } = useStore();
  const qc = useQueryClient();
  const phone = normalizePhone(conv.phone);
  const { data } = useQuery({
    queryKey: ["conv-crm", conv.id, conv.client_id],
    queryFn: async () => {
      const [clients, team, opps] = await Promise.all([
        supabase.from("clients").select("id,name,whatsapp").eq("store_id", store.id).not("whatsapp", "is", null).limit(2000),
        supabase.from("store_members").select("user_id,email,role,can_attend_chats").eq("store_id", store.id),
        conv.client_id ? supabase.from("opportunities").select("id,desired_model,stage").eq("store_id", store.id).eq("client_id", conv.client_id).order("created_at", { ascending: false }) : Promise.resolve({ data: [] as { id: string; desired_model: string | null; stage: string }[] }),
      ]);
      return {
        matches: (clients.data ?? []).filter((c) => normalizePhone(c.whatsapp) === phone),
        team: (team.data ?? []).filter((m) => m.role === "owner" || m.can_attend_chats),
        opps: opps.data ?? [],
      };
    },
  });
  const linked = useMemo(() => data?.matches.find((c) => c.id === conv.client_id), [data, conv.client_id]);
  async function update(patch: Partial<Pick<Conv, "client_id" | "opportunity_id" | "assigned_to">>) {
    const { error } = await supabase.from("conversations").update(patch).eq("id", conv.id);
    if (error) toast.error(error.message); else { qc.invalidateQueries({ queryKey: ["conversations", store.id] }); qc.invalidateQueries({ queryKey: ["conv-crm", conv.id] }); }
  }
  async function createClient() {
    const { data: c, error } = await supabase.from("clients").insert({ store_id: store.id, name: conv.contact_name ?? `+${conv.phone}`, whatsapp: `+${conv.phone}`, origin: "WhatsApp" }).select("id").single();
    if (error) { toast.error(error.message); return; }
    await update({ client_id: c.id }); toast.success("Cliente cadastrado e vinculado.");
  }
  async function createOpp() {
    if (!conv.client_id) return;
    const { data: o, error } = await supabase.from("opportunities").insert({ store_id: store.id, client_id: conv.client_id, owner_id: conv.assigned_to ?? userId, notes: "Criada a partir do Atendimento (WhatsApp)" }).select("id").single();
    if (error) { toast.error(error.message); return; }
    await update({ opportunity_id: o.id }); toast.success("Oportunidade criada no funil.");
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Select value={conv.assigned_to ?? "none"} onValueChange={(v) => update({ assigned_to: v === "none" ? null : v })}>
        <SelectTrigger className="h-8 w-48"><SelectValue placeholder="Responsável" /></SelectTrigger>
        <SelectContent><SelectItem value="none">Sem responsável</SelectItem>{data?.team.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.email ?? "Membro"}</SelectItem>)}</SelectContent>
      </Select>
      {conv.client_id ? <Badge variant="secondary">Cliente: {linked?.name ?? "vinculado"}</Badge> : data?.matches.length ? (
        <>
          <span>Cadastro com este WhatsApp — confira:</span>
          {data.matches.map((c) => <Button key={c.id} size="sm" variant="outline" onClick={() => update({ client_id: c.id })}>Vincular {c.name}</Button>)}
          <Button size="sm" variant="ghost" onClick={createClient}>É outra pessoa: cadastrar</Button>
        </>
      ) : <Button size="sm" variant="outline" onClick={createClient}>Cadastrar cliente</Button>}
      {conv.client_id && (
        <Select value={conv.opportunity_id ?? "none"} onValueChange={(v) => v === "new" ? void createOpp() : update({ opportunity_id: v === "none" ? null : v })}>
          <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Oportunidade" /></SelectTrigger>
          <SelectContent><SelectItem value="none">Sem oportunidade</SelectItem>{data?.opps.map((o) => <SelectItem key={o.id} value={o.id}>{o.desired_model ?? "Oportunidade"} · {o.stage}</SelectItem>)}<SelectItem value="new">+ Criar oportunidade</SelectItem></SelectContent>
        </Select>
      )}
    </div>
  );
}
