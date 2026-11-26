import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ExternalLink, FileText, Loader2, Printer, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";
import { BUCKET, signedUrls } from "@/lib/storage";
import { CONTRACT_TYPE_LABEL, DOC_STATUS_LABEL, type Contract, type ContractTemplate } from "@/lib/finance";
import { formatBRL } from "@/lib/money";
import { formatDate, formatDateTime, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SaleDocuments } from "@/components/app/SaleDocuments";

export const Route = createFileRoute("/_authenticated/app/documentos")({
  head: () => ({ meta: [{ title: "Documentos — MLI Gestão" }, { name: "description", content: "Recibos numerados, notas fiscais anexadas e contratos da loja." }, { property: "og:title", content: "Documentos — MLI Gestão" }, { property: "og:description", content: "Recibos, notas fiscais anexadas e contratos vinculados às vendas." },{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"}] }),
  component: Documentos,
});

type ContractRow = Contract & { clients?: { name: string } | null; sales?: { receipt_number: number | null } | null };

const VARIABLES = ["{{loja.nome}}", "{{loja.documento}}", "{{loja.endereco}}", "{{cliente.nome}}", "{{cliente.documento}}", "{{aparelho.modelo}}", "{{aparelho.imei}}", "{{venda.total}}", "{{venda.entrada}}", "{{venda.parcelas}}", "{{venda.vencimentos}}", "{{data_emissao}}"];

function Documentos() {
  const { store, perms } = useStore();
  const qc = useQueryClient();
  const [tplOpen, setTplOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<ContractRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["contracts", store.id],
    enabled: perms.viewContracts,
    queryFn: async () => {
      const [contracts, templates, sales] = await Promise.all([
        supabase.from("contracts").select("*, clients(name), sales(receipt_number)").eq("store_id", store.id).order("created_at", { ascending: false }),
        supabase.from("contract_templates").select("*").eq("store_id", store.id).order("type"),
        supabase.from("sales").select("id, receipt_number, total, created_at, clients(name)").eq("store_id", store.id).order("created_at", { ascending: false }).limit(100),
      ]);
      for (const q of [contracts, templates, sales]) if (q.error) throw q.error;
      return { contracts: (contracts.data ?? []) as ContractRow[], templates: (templates.data ?? []) as ContractTemplate[], sales: sales.data ?? [] };
    },
  });

  if (!perms.viewContracts)
    return <div className="mx-auto max-w-4xl"><PageHeader title="Documentos" /><p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Você não tem permissão para consultar contratos. Peça ao proprietário para liberar o acesso.</p></div>;
  if (isLoading || !data) return <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const tplByType = new Map(data.templates.filter((t) => t.active).map((t) => [t.type, t]));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Documentos e contratos" subtitle="Contratos vinculados às vendas, com emissão, assinatura externa e arquivo assinado preservado." />
      <SaleDocuments />

      <section className="grid gap-3 sm:grid-cols-2">
        {Object.entries(CONTRACT_TYPE_LABEL).map(([type, label]) => {
          const tpl = tplByType.get(type);
          return (
            <div key={type} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{label}</p>
                {tpl ? <Badge variant="secondary" className="bg-success/15 text-success">Modelo v{tpl.version}</Badge> : <Badge variant="secondary" className="bg-warning/15 text-warning-foreground">Modelo pendente de configuração</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{tpl ? `Modelo "${tpl.name}" cadastrado.` : "Cadastre o modelo jurídico fornecido pelo seu advogado para habilitar a emissão."}</p>
            </div>
          );
        })}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setNewOpen(true)}><FileText className="mr-1 h-4 w-4" />Novo contrato ou termo</Button>
        <Button variant="outline" onClick={() => setTplOpen(true)}>Gerenciar modelos</Button>
      </div>

      <section className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="p-3">Documento</th><th className="p-3">Cliente</th><th className="p-3">Venda</th><th className="p-3">Emitido em</th><th className="p-3">Situação</th><th className="p-3" /></tr></thead>
          <tbody>
            {data.contracts.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="p-3 font-medium">{CONTRACT_TYPE_LABEL[c.type]}</td>
                <td className="p-3 text-muted-foreground">{c.clients?.name ?? "—"}</td>
                <td className="p-3 text-muted-foreground">{c.sales?.receipt_number ? `Recibo nº ${c.sales.receipt_number}` : "—"}</td>
                <td className="p-3 text-muted-foreground">{formatDate(c.created_at)}</td>
                <td className="p-3"><Badge variant="secondary" className={c.status === "verificado" ? "bg-success/15 text-success" : c.status === "modelo_pendente" ? "bg-warning/15 text-warning-foreground" : ""}>{DOC_STATUS_LABEL[c.status]}</Badge></td>
                <td className="p-3 text-right"><Button size="sm" variant="outline" onClick={() => setSelected(c)}>Abrir</Button></td>
              </tr>
            ))}
            {data.contracts.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Nenhum documento emitido ainda.</td></tr>}
          </tbody>
        </table>
      </section>

      <TemplateDialog open={tplOpen} onClose={() => setTplOpen(false)} templates={data.templates} onSaved={() => qc.invalidateQueries({ queryKey: ["contracts"] })} />
      <NewContractDialog open={newOpen} onClose={() => setNewOpen(false)} templates={data.templates} sales={data.sales} onSaved={() => qc.invalidateQueries({ queryKey: ["contracts"] })} />
      <ContractDetail contract={selected} onClose={() => setSelected(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["contracts"] })} />
    </div>
  );
}

function TemplateDialog({ open, onClose, templates, onSaved }: { open: boolean; onClose: () => void; templates: ContractTemplate[]; onSaved: () => void }) {
  const { store } = useStore();
  const [type, setType] = useState("venda_prazo");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const prev = templates.filter((t) => t.type === type);
    const version = (prev[0]?.version ?? 0) + 1;
    await supabase.from("contract_templates").update({ active: false }).eq("store_id", store.id).eq("type", type);
    const { error } = await supabase.from("contract_templates").insert({ store_id: store.id, type, name: name.trim() || (CONTRACT_TYPE_LABEL[type] ?? type), body, version });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Modelo salvo como versão ${version}. A versão anterior foi arquivada.`);
    setName(""); setBody("");
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Modelos de documento</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Cole aqui o modelo jurídico fornecido pelo seu advogado. O sistema não inventa cláusulas: sem modelo cadastrado, o documento fica como "Modelo pendente de configuração". Cada alteração gera uma nova versão.</p>
        <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          <p className="mb-1 font-semibold">Variáveis disponíveis</p>
          <p className="font-mono">{VARIABLES.join("  ")}</p>
        </div>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Fld label="Tipo de documento"><Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CONTRACT_TYPE_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Fld>
            <Fld label="Nome do modelo"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={CONTRACT_TYPE_LABEL[type]} /></Fld>
          </div>
          <Fld label="Texto do modelo"><Textarea rows={10} required value={body} onChange={(e) => setBody(e.target.value)} placeholder="Cole o texto do modelo com as variáveis…" /></Fld>
          <DialogFooter><Button variant="outline" type="button" onClick={onClose}>Fechar</Button><Button disabled={busy}>{busy ? "Salvando…" : "Salvar nova versão"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewContractDialog({ open, onClose, templates, sales, onSaved }: { open: boolean; onClose: () => void; templates: ContractTemplate[]; sales: Array<{ id: string; receipt_number: number | null; total: number | string; created_at: string; clients?: { name: string } | null }>; onSaved: () => void }) {
  const { store } = useStore();
  const [type, setType] = useState("venda_prazo");
  const [saleId, setSaleId] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || !saleId) { if (!saleId) toast.error("Selecione a venda."); return; }
    setBusy(true);
    const { data: sale } = await supabase.from("sales").select("*, clients(name, document, whatsapp, address)").eq("id", saleId).single();
    if (!sale) { setBusy(false); toast.error("Venda não encontrada."); return; }
    const { data: items } = await supabase.from("sale_items").select("*, devices(model, storage, imei1)").eq("sale_id", saleId);
    const { data: contract } = await supabase.from("credit_contracts").select("*, credit_installments(*)").eq("sale_id", saleId).maybeSingle();
    const tpl = templates.find((t) => t.type === type && t.active);
    const first = items?.[0]?.devices;
    const variables = {
      "loja.nome": store.name, "loja.documento": store.document ?? "", "loja.endereco": store.address ?? "",
      "cliente.nome": sale.clients?.name ?? "", "cliente.documento": sale.clients?.document ?? "",
      "aparelho.modelo": first ? `${first.model} ${first.storage ?? ""}`.trim() : "", "aparelho.imei": first?.imei1 ?? "",
      "venda.total": formatBRL(sale.total), "venda.entrada": formatBRL(contract?.down_payment ?? sale.amount_received),
      "venda.parcelas": contract ? `${contract.installments_count}x de ${formatBRL(contract.credit_installments?.[0]?.amount ?? 0)}` : "—",
      "venda.vencimentos": contract?.credit_installments?.map((i: { due_date: string }) => formatDate(i.due_date)).join(", ") ?? "—",
      "data_emissao": formatDate(todayISO()),
    };
    let content: string | null = null;
    let status = "modelo_pendente";
    if (tpl) {
      content = tpl.body;
      for (const [k, v] of Object.entries(variables)) content = content.split(`{{${k}}}`).join(String(v));
      status = "gerado";
    }
    const { error } = await supabase.from("contracts").insert({
      store_id: store.id, type, template_id: tpl?.id ?? null, template_version: tpl?.version ?? null,
      sale_id: saleId, client_id: sale.client_id, device_id: items?.[0]?.device_id ?? null,
      status, variables, content,
      signatories: [{ name: store.name, role: "loja", signed: false }, { name: sale.clients?.name ?? "Cliente", role: "cliente", signed: false }],
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(tpl ? "Documento gerado a partir do modelo." : "Documento criado como “Modelo pendente de configuração”.");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo documento</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <Fld label="Tipo"><Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CONTRACT_TYPE_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Fld>
          <Fld label="Venda vinculada">
            <Select value={saleId} onValueChange={setSaleId}><SelectTrigger><SelectValue placeholder="Selecionar venda" /></SelectTrigger><SelectContent>{sales.map((s) => <SelectItem key={s.id} value={s.id}>Recibo nº {s.receipt_number} · {s.clients?.name ?? "Sem cliente"} · {formatBRL(s.total)}</SelectItem>)}</SelectContent></Select>
          </Fld>
          <DialogFooter><Button variant="outline" type="button" onClick={onClose}>Cancelar</Button><Button disabled={busy}>{busy ? "Gerando…" : "Criar documento"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContractDetail({ contract, onClose, onSaved }: { contract: ContractRow | null; onClose: () => void; onSaved: () => void }) {
  const { store } = useStore();
  const [busy, setBusy] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  async function setStatus(status: string) {
    if (!contract || busy) return;
    setBusy(true);
    const { error } = await supabase.from("contracts").update({ status, updated_at: new Date().toISOString() }).eq("id", contract.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    onSaved();
  }

  async function attachSigned(file?: File) {
    if (!file || !contract || busy) return;
    if (file.type !== "application/pdf") { toast.error("Envie o PDF assinado."); return; }
    setBusy(true);
    const path = `${store.id}/contracts/${contract.id}/assinado-${crypto.randomUUID()}.pdf`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: "application/pdf" });
    if (up.error) { setBusy(false); toast.error(up.error.message); return; }
    const { error } = await supabase.from("contracts").update({ signed_path: path, status: "assinado_anexado", updated_at: new Date().toISOString() }).eq("id", contract.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("PDF assinado anexado e preservado sem alterações. A verificação das assinaturas é uma etapa manual separada.");
    onSaved();
  }

  async function viewSigned() {
    if (!contract?.signed_path) return;
    const urls = await signedUrls([contract.signed_path]);
    const url = urls[contract.signed_path];
    if (url) { setSignedUrl(url); window.open(url, "_blank", "noopener"); }
  }

  async function toggleSignatory(idx: number) {
    if (!contract) return;
    const sigs = [...(contract.signatories as Array<{ name: string; role: string; signed: boolean }>)];
    sigs[idx] = { ...sigs[idx]!, signed: !sigs[idx]!.signed };
    const { error } = await supabase.from("contracts").update({ signatories: sigs, updated_at: new Date().toISOString() }).eq("id", contract.id);
    if (error) { toast.error(error.message); return; }
    onSaved();
  }

  const sigs = (contract?.signatories ?? []) as Array<{ name: string; role: string; signed: boolean }>;

  return (
    <Dialog open={!!contract} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{contract ? CONTRACT_TYPE_LABEL[contract.type] : ""}</DialogTitle></DialogHeader>
        {contract && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{DOC_STATUS_LABEL[contract.status]}</Badge>
              {contract.template_version && <span className="text-xs text-muted-foreground">Modelo versão {contract.template_version}</span>}
            </div>

            {contract.status === "modelo_pendente" ? (
              <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">Modelo pendente de configuração. Cadastre o modelo jurídico em “Gerenciar modelos” e gere o documento novamente. Isso não impede o funcionamento do financeiro.</p>
            ) : (
              <>
                <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-4 font-mono text-xs">{contract.content}</div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Imprimir / baixar PDF</Button>
                  <Button size="sm" variant="outline" asChild><a href="https://assinador.iti.br/" target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-4 w-4" />Abrir assinador GOV.BR</a></Button>
                  {contract.status === "gerado" && <Button size="sm" variant="outline" onClick={() => setStatus("aguardando_assinatura")}>Marcar como aguardando assinatura</Button>}
                </div>
              </>
            )}

            <section className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-semibold">Signatários esperados</p>
              <ul className="space-y-1 text-sm">
                {sigs.map((s, idx) => (
                  <li key={idx} className="flex items-center justify-between">
                    <span>{s.name} <span className="text-xs text-muted-foreground">({s.role === "loja" ? "loja" : "cliente"})</span></span>
                    <Button size="sm" variant="ghost" onClick={() => toggleSignatory(idx)}>{s.signed ? "✓ Assinado" : "Pendente"}</Button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-semibold">Arquivo assinado</p>
              {contract.signed_path ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={viewSigned}>Ver PDF assinado</Button>
                  {contract.status !== "verificado" && <Button size="sm" onClick={() => setStatus("verificado")}>Confirmar verificação das assinaturas</Button>}
                </div>
              ) : (
                <Label className="inline-flex cursor-pointer items-center gap-1 text-sm underline">
                  <Upload className="h-4 w-4" />Anexar PDF assinado original
                  <input type="file" accept="application/pdf" className="hidden" onChange={(e) => attachSigned(e.target.files?.[0])} />
                </Label>
              )}
              <p className="mt-2 text-xs text-muted-foreground">O anexo não valida a assinatura: a conferência é manual e registrada acima. Não há integração automática com o GOV.BR.</p>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
