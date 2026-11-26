import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore, ROLE_LABEL } from "@/lib/store-context";
import { BUCKET, signedUrls } from "@/lib/storage";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WhatsappIntegration } from "@/components/app/WhatsappIntegration";
import { buildInviteLink, isRestrictedPreview } from "@/lib/invite-link";

export const Route = createFileRoute("/_authenticated/app/configuracoes")({
  head: () => ({ meta: [{ title: "Configurações — MLI Gestão" }, { name: "description", content: "Dados da loja, equipe e permissões." }, { property: "og:title", content: "Configurações — MLI Gestão" }, { property: "og:description", content: "Dados da loja, equipe e permissões." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Settings,
});

const PERMS = [
  ["can_view_costs", "Ver custos e margens"],
  ["can_view_finance", "Ver financeiro"],
  ["can_give_discounts", "Conceder descontos"],
  ["can_approve_evaluations", "Aprovar avaliações acima do limite"],
  ["can_manage_inventory", "Cadastrar e editar estoque"],
  ["can_manage_team", "Gerenciar equipe"],
  ["can_register_sales", "Registrar vendas"],
  ["can_cancel_sales", "Cancelar vendas"],
  ["can_register_payments", "Registrar recebimentos e pagamentos"],
  ["can_reverse_payments", "Estornar recebimentos"],
  ["can_approve_credit", "Aprovar crediário"],
  ["can_renegotiate", "Renegociar contratos"],
  ["can_view_contracts", "Consultar contratos e documentos"],
  ["can_attend_chats", "Atender conversas do WhatsApp"],
] as const;
type PermKey = (typeof PERMS)[number][0];

function Settings() {
  const { member } = useStore();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Configurações" />
      <Tabs defaultValue="loja">
        <TabsList><TabsTrigger value="loja">Loja</TabsTrigger><TabsTrigger value="equipe">Equipe</TabsTrigger><TabsTrigger value="integracoes">Integrações</TabsTrigger></TabsList>
        <TabsContent value="loja" className="mt-4">{member.role === "owner" ? <StoreForm /> : <p className="text-sm text-muted-foreground">Somente o proprietário altera os dados da loja.</p>}</TabsContent>
        <TabsContent value="equipe" className="mt-4"><Team /></TabsContent>
        <TabsContent value="integracoes" className="mt-4"><WhatsappIntegration /></TabsContent>
      </Tabs>
    </div>
  );
}

function StoreForm() {
  const { store } = useStore();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: store.name, legal_name: store.legal_name ?? "", document: store.document ?? "", phone: store.phone ?? "",
    email: store.email ?? "", address: store.address ?? "", warranty_text: store.warranty_text ?? "",
  });
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (store.logo_path) signedUrls([store.logo_path]).then((u) => setLogoUrl(u[store.logo_path!] ?? null));
  }, [store.logo_path]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("stores").update({ ...f, name: f.name.trim() }).eq("id", store.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Dados da loja salvos.");
    qc.invalidateQueries({ queryKey: ["session-bootstrap"] });
  }

  async function uploadLogo(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Envie uma imagem."); return; }
    const path = `${store.id}/logo/${crypto.randomUUID()}.${file.name.split(".").pop() || "png"}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (up.error) { toast.error(up.error.message); return; }
    const { error } = await supabase.from("stores").update({ logo_path: path }).eq("id", store.id);
    if (error) { toast.error(error.message); return; }
    if (store.logo_path) await supabase.storage.from(BUCKET).remove([store.logo_path]);
    toast.success("Logo atualizada.");
    qc.invalidateQueries({ queryKey: ["session-bootstrap"] });
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <form onSubmit={save} className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex items-center gap-4">
        <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-lg border bg-muted text-xs text-muted-foreground">
          {logoUrl ? <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" /> : "Logo"}
        </div>
        <Label className="cursor-pointer text-sm underline">Enviar logo<input type="file" accept="image/*" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} /></Label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Fld label="Nome da loja"><Input required value={f.name} onChange={set("name")} /></Fld>
        <Fld label="Razão social"><Input value={f.legal_name} onChange={set("legal_name")} /></Fld>
        <Fld label="CNPJ ou CPF"><Input value={f.document} onChange={set("document")} /></Fld>
        <Fld label="Telefone / WhatsApp"><Input value={f.phone} onChange={set("phone")} /></Fld>
        <Fld label="E-mail"><Input type="email" value={f.email} onChange={set("email")} /></Fld>
        <Fld label="Endereço"><Input value={f.address} onChange={set("address")} /></Fld>
      </div>
      <Fld label="Condições de garantia (aparecerão nos recibos)"><Textarea rows={4} value={f.warranty_text} onChange={set("warranty_text")} /></Fld>
      <div className="flex justify-end"><Button disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button></div>
    </form>
  );
}

function Team() {
  const { store, perms, userId, member: me } = useStore();
  const isOwner = me.role === "owner";
  const qc = useQueryClient();
  const key = ["team", store.id];
  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [m, i] = await Promise.all([
        supabase.from("store_members").select("*").eq("store_id", store.id).order("created_at"),
        perms.manageTeam ? supabase.from("store_invites").select("*").eq("store_id", store.id).is("accepted_at", null) : Promise.resolve({ data: [] }),
      ]);
      return { members: m.data ?? [], invites: i.data ?? [] };
    },
  });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "manager" | "seller">("seller");
  const [newPerms, setNewPerms] = useState<Record<PermKey, boolean>>({
    can_view_costs: false, can_view_finance: false, can_give_discounts: false, can_approve_evaluations: false, can_manage_inventory: false, can_manage_team: false,
    can_register_sales: true, can_cancel_sales: false,
    can_register_payments: false, can_reverse_payments: false, can_approve_credit: false, can_renegotiate: false, can_view_contracts: false, can_attend_chats: false,
  });

  const [lastLink, setLastLink] = useState<string | null>(null);

  function inviteLink(token: string) {
    return buildInviteLink(token, window.location.origin, import.meta.env["VITE_PUBLIC_APP_URL"]);
  }

  async function copyLink(token: string) {
    const link = inviteLink(token);
    setLastLink(link);
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copiado.");
    } catch { toast.info("Copie o endereço exibido abaixo."); }
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    const { data: created, error } = await supabase.rpc("create_store_invite", {
      _store_id: store.id, _email: email.trim().toLowerCase(), _role: role, _perms: newPerms,
    });
    if (error) { toast.error(error.message); return; }
    const token = (created as { token?: string } | null)?.token;
    if (token) await copyLink(token);
    toast.success("Convite criado. O e-mail NÃO foi enviado — envie o link manualmente.");
    setEmail("");
    qc.invalidateQueries({ queryKey: key });
  }

  async function resend(inviteId: string) {
    const { data, error } = await supabase.rpc("resend_store_invite", { _invite_id: inviteId });
    if (error) { toast.error(error.message); return; }
    const token = (data as { token?: string } | null)?.token;
    if (token) await copyLink(token);
    toast.success("Convite renovado. O e-mail NÃO foi enviado — envie o link manualmente.");
    qc.invalidateQueries({ queryKey: key });
  }

  async function revoke(inviteId: string) {
    const { error } = await supabase.rpc("revoke_store_invite", { _invite_id: inviteId });
    if (error) { toast.error(error.message); return; }
    toast.success("Convite revogado.");
    qc.invalidateQueries({ queryKey: key });
  }

  async function ownerAction(kind: "grant" | "revoke" | "remove", m: { id: string; email: string | null }) {
    const label = { grant: "dar perfil de proprietário a", revoke: "retirar o perfil de proprietário de", remove: "remover da loja o proprietário" }[kind];
    if (!window.confirm(`Confirmar: ${label} ${m.email ?? "este usuário"}?`)) return;
    const reason = window.prompt("Motivo (fica registrado no histórico):") ?? "";
    const { error } = kind === "remove"
      ? await supabase.rpc("remove_owner", { _member_id: m.id, _reason: reason })
      : await supabase.rpc("set_member_role", { _member_id: m.id, _role: kind === "grant" ? "owner" : "manager", _reason: reason });
    if (error) { toast.error(error.message); return; }
    toast.success("Alteração registrada.");
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["session-bootstrap"] });
  }

  async function togglePerm(memberId: string, k: PermKey, v: boolean) {
    const { error } = await supabase.from("store_members").update({ [k]: v } as Partial<Record<PermKey, boolean>>).eq("id", memberId);
    if (error) { toast.error("Sem permissão para alterar."); return; }
    qc.invalidateQueries({ queryKey: key });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {data?.members.map((m) => {
          const editable = perms.manageTeam && m.role !== "owner" && m.user_id !== userId;
          return (
            <div key={m.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{m.email ?? "Usuário"}{m.user_id === userId && " (você)"}</p>
                  <Badge variant="secondary">{ROLE_LABEL[m.role]}</Badge>
                </div>
                {isOwner && (
                  <div className="flex flex-wrap gap-1">
                    {m.role !== "owner" && <Button size="sm" variant="outline" onClick={() => ownerAction("grant", m)}>Tornar sócio</Button>}
                    {m.role === "owner" && <Button size="sm" variant="outline" onClick={() => ownerAction("revoke", m)}>Retirar perfil de proprietário</Button>}
                    {m.role === "owner" && m.user_id !== userId && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => ownerAction("remove", m)}><Trash2 className="mr-1 h-4 w-4" />Remover sócio</Button>}
                  </div>
                )}
                {editable && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                    const { error } = await supabase.from("store_members").delete().eq("id", m.id);
                    if (error) toast.error(error.message); else qc.invalidateQueries({ queryKey: key });
                  }}><Trash2 className="mr-1 h-4 w-4" />Remover</Button>
                )}
              </div>
              {m.role !== "owner" && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {PERMS.map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={m[k]} disabled={!editable} onCheckedChange={(v) => togglePerm(m.id, k, v === true)} />{l}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {perms.manageTeam && (
        <form onSubmit={invite} className="space-y-3 rounded-xl border bg-card p-5">
          <h3 className="font-semibold">Convidar membro</h3>
          <div className="flex flex-wrap gap-2">
            <Input required type="email" placeholder="E-mail" className="flex-1" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Select value={role} onValueChange={(v) => setRole(v as "owner" | "manager" | "seller")}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{isOwner && <SelectItem value="owner">Sócio (proprietário)</SelectItem>}<SelectItem value="manager">Gerente</SelectItem><SelectItem value="seller">Vendedor</SelectItem></SelectContent>
            </Select>
          </div>
          {role === "owner" ? <p className="text-sm text-muted-foreground">Sócio tem acesso completo à loja, com login próprio. Ele entra ao aceitar o convite com o e-mail convidado. Ser sócio não dá acesso à administração da plataforma.</p> : <div className="grid gap-2 sm:grid-cols-2">
            {PERMS.map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><Checkbox checked={newPerms[k]} onCheckedChange={(v) => setNewPerms({ ...newPerms, [k]: v === true })} />{l}</label>
            ))}
          </div>}
          <Button>Criar convite</Button>
          <p className="text-xs text-muted-foreground">
            O envio de e-mail ainda não está configurado: <strong>nenhum e-mail é enviado</strong>. Copie o link do convite e envie manualmente (WhatsApp, etc.).
            O convite vale por 7 dias, só pode ser usado uma vez e exige que a pessoa entre com o e-mail convidado.
          </p>
          {lastLink && (
            <div className="rounded-lg border border-gold/40 bg-gold-soft p-3 text-sm">
              <p className="font-medium">Link do convite (e-mail não enviado):</p>
              <p className="mt-1 break-all text-xs">{lastLink}</p>
              {isRestrictedPreview(lastLink) && <p className="mt-2 text-xs">Este endereço é uma prévia restrita do Lovable. Convidados sem acesso ao projeto não conseguem abri-lo. Publique o aplicativo e copie o convite pelo site publicado.</p>}
            </div>
          )}
          {!!data?.invites.length && (
            <ul className="divide-y border-t pt-2 text-sm">
              {data.invites.map((i) => {
                const status = i.revoked_at ? "revogado" : i.expires_at && new Date(i.expires_at) < new Date() ? "vencido" : "pendente";
                return (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{i.email} · {ROLE_LABEL[i.role]} · <Badge variant={status === "pendente" ? "secondary" : "outline"}>{status}</Badge></span>
                    <div className="flex gap-1">
                      {status !== "revogado" && i.token && <Button type="button" size="sm" variant="outline" onClick={() => { if (i.token) void copyLink(i.token); }}>Copiar link</Button>}
                      {status !== "revogado" && <Button type="button" size="sm" variant="outline" onClick={() => resend(i.id)}>Reenviar</Button>}
                      {status !== "revogado" && <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => revoke(i.id)}>Revogar</Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </form>
      )}
    </div>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
