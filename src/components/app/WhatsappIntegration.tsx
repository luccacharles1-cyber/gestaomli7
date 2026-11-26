import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";
import { connectWhatsapp } from "@/lib/whatsapp.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function WhatsappIntegration() {
  const { store, member } = useStore();
  const isOwner = member.role === "owner";
  const qc = useQueryClient();
  const connect = useServerFn(connectWhatsapp);
  const [busy, setBusy] = useState(false);
  const key = ["wa-conn-full", store.id];
  const { data: conn } = useQuery({ queryKey: key, queryFn: async () => (await supabase.from("whatsapp_connections").select("*").eq("store_id", store.id).maybeSingle()).data });
  async function run() {
    setBusy(true);
    try { await connect({ data: { storeId: store.id } }); toast.success("WhatsApp verificado nesta loja."); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["wa-conn", store.id] }); }
  }
  const d = (conn?.details ?? {}) as Record<string, string | boolean>;
  return (
    <div className="space-y-3 rounded-xl border bg-card p-5 text-sm">
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">WhatsApp Business (oficial da Meta)</h3>
        {conn ? <Badge variant={conn.last_error ? "destructive" : "secondary"}>{conn.last_error ? "Com erro" : "Conectado"}</Badge> : <Badge variant="outline">Não conectado</Badge>}</div>
      {conn ? (
        <dl className="grid gap-1 sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Número</dt><dd>{conn.display_phone}</dd></div>
          <div><dt className="text-muted-foreground">Nome exibido</dt><dd>{conn.verified_name ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Ambiente</dt><dd>{conn.mode === "producao" ? "Pronto para uso real" : "Teste / em ativação na Meta"}</dd></div>
          <div><dt className="text-muted-foreground">Também no app do celular</dt><dd>{d["is_on_biz_app"] ? "Sim (coexistência)" : "Não"}</dd></div>
          <div><dt className="text-muted-foreground">Última verificação</dt><dd>{conn.checked_at ? new Date(conn.checked_at).toLocaleString("pt-BR") : "—"}</dd></div>
          {conn.last_error && <div className="sm:col-span-2 text-destructive">Erro: {conn.last_error}</div>}
        </dl>
      ) : <p className="text-muted-foreground">O número conectado ao MLI Gestão ainda não foi vinculado a esta loja.</p>}
      {isOwner ? <Button onClick={run} disabled={busy}>{busy ? "Verificando…" : conn ? "Verificar estado" : "Vincular WhatsApp a esta loja"}</Button>
        : <p className="text-xs text-muted-foreground">Somente o proprietário gerencia a integração.</p>}
      <p className="text-xs text-muted-foreground">Instagram Direct: em breve nesta mesma área.</p>
    </div>
  );
}
