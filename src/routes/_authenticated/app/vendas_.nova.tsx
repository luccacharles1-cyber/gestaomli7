import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";
import { normalizeImei, validateImeiPair } from "@/lib/imei";
import { centsToDecimal, centsToInput, formatCents, parseBRLToCents, toCents } from "@/lib/money";
import { PAYMENT_LABEL, saleTotals, validateSaleTotals, type PaymentMethod } from "@/lib/sales";
import type { Database } from "@/integrations/supabase/types";
import { validateProductQuantity } from "@/lib/sales";
import { STATUS_LABEL, STORAGE_OPTIONS, type Device } from "@/lib/devices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/app/vendas_/nova")({
  validateSearch: (s: Record<string, unknown>) => ({ device: typeof s["device"] === "string" ? s["device"] : undefined }),
  head: () => ({ meta: [{ title: "Nova venda — MLI Gestão" }, { name: "description", content: "Registrar venda com troca e pagamentos combinados." }, { property: "og:title", content: "Nova venda — MLI Gestão" }, { property: "og:description", content: "Registrar venda com troca e pagamentos combinados." },{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"}] }),
  component: NovaVenda,
});

type Client = { id: string; name: string; whatsapp: string | null };
type Item = { device: Device; priceCents: number };
type Product = Database["public"]["Tables"]["accessories"]["Row"];
type ProductItem = { product: Product; quantity: string; priceCents: number };
type Payment = { method: PaymentMethod; amount: string; installments: string };

function NovaVenda() {
  const { store, perms } = useStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { device: preselect } = Route.useSearch();
  // Idempotency token: generated once per form mount; the server returns the
  // original sale if the same token is submitted twice (double click / retry).
  const [clientToken] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);

  const [clientId, setClientId] = useState<string>("");
  const [newClient, setNewClient] = useState({ name: "", whatsapp: "" });
  const [creatingClient, setCreatingClient] = useState(false);

  const [itemSearch, setItemSearch] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");

  const [hasTradeIn, setHasTradeIn] = useState(false);
  const [trade, setTrade] = useState({
    model: "", storage: "", color: "", imei1: "", imei2: "", serial_number: "",
    condition: "seminovo", conservation: "", battery_health: "", defects: "", value: "",
  });

  const [evaluationId, setEvaluationId] = useState("");
  const [imeiError,setImeiError]=useState<string|null>(null);
  function pickEvaluation(id: string) {
    const e = data?.evaluations.find((x) => x.id === id);
    if (!e) return;
    setEvaluationId(id);
    setTrade((t) => ({ ...t, model: e.model, storage: e.storage, value: centsToInput(toCents(e.offered_value)) }));
  }

  const [payments, setPayments] = useState<Payment[]>([{ method: "pix", amount: "", installments: "" }]);

  const { data, error: searchError } = useQuery({
    queryKey: ["sale-form-data", store.id],
    queryFn: async () => {
      const [c, d, ev, a] = await Promise.all([
        supabase.from("clients").select("id, name, whatsapp").eq("store_id", store.id).order("name"),
        supabase.from("devices").select("*").eq("store_id", store.id).in("status", ["disponivel", "reservado"]).order("model"),
        supabase.from("evaluations").select("id, model, storage, offered_value, client_id").eq("store_id", store.id).is("sale_id", null).eq("archived", false).neq("status", "utilizada").order("created_at", { ascending: false }),
        supabase.from("accessories").select("*").eq("store_id", store.id).eq("archived",false).gt("quantity", 0).order("name"),
      ]);
      if (a.error) throw a.error;
      if (ev.error) throw ev.error;
      if (c.error) throw c.error;
      if (d.error) throw d.error;
      return { clients: (c.data ?? []) as Client[], devices: (d.data ?? []) as Device[], evaluations: ev.data ?? [], products: a.data ?? [] };
    },
  });
  const clientEvaluations = (data?.evaluations ?? []).filter((e) => clientId && e.client_id === clientId);

  // Preselect device coming from the stock page (?device=<id>)
  const [preselected, setPreselected] = useState(false);
  if (!preselected && preselect && data?.devices) {
    const dev = data.devices.find((d) => d.id === preselect);
    if (dev) setItems([{ device: dev, priceCents: toCents(dev.sale_price) }]);
    setPreselected(true);
  }

  const available = useMemo(() => {
    const term = itemSearch.trim().toLowerCase();
    const chosen = new Set(items.map((i) => i.device.id));
    return (data?.devices ?? [])
      .filter((d) => !chosen.has(d.id))
      .filter((d) => !term || [d.model, d.storage, d.color, d.imei1, d.internal_code].filter(Boolean).join(" ").toLowerCase().includes(term))
      .slice(0, 8);
  }, [data, itemSearch, items]);

  const availableProducts = useMemo(() => {
    const term = itemSearch.trim().toLowerCase();
    return (data?.products ?? []).filter(p => !products.some(i => i.product.id === p.id))
      .filter(p => !term || [p.name, p.sku, p.category, p.description].filter(Boolean).join(" ").toLowerCase().includes(term)).slice(0, 8);
  }, [data, itemSearch, products]);
  const productError = products.map(p => validateProductQuantity(Number(p.quantity), p.product.quantity)).find(Boolean);
  const paymentCents = payments.map((p) => parseBRLToCents(p.amount) ?? 0);
  const totals = saleTotals(
    [...items.map((i) => i.priceCents), ...products.map(p => p.priceCents * (Number(p.quantity) || 0))],
    parseBRLToCents(discount) ?? 0,
    hasTradeIn ? (parseBRLToCents(trade.value) ?? 0) : 0,
    paymentCents,
  );

  function addPayment() {
    setPayments((p) => [...p, { method: "dinheiro", amount: "", installments: "" }]);
  }

  async function submit() {
    if (busy) return;
    if (productError) { toast.error(productError); return; }
    const err = validateSaleTotals(totals);
    if (err) { toast.error(err); return; }
    if (items.some((i) => i.priceCents <= 0) || products.some(p => p.priceCents <= 0)) { toast.error("Informe o preço de cada item."); return; }
    if (totals.discountCents > 0 && !perms.giveDiscounts) { toast.error("Você não tem permissão para conceder desconto."); return; }
    if (payments.some((p) => p.amount.trim() && parseBRLToCents(p.amount) == null)) { toast.error("Valor de pagamento inválido."); return; }

    let finalClientId = clientId || null;

    if (hasTradeIn) {
      const imei1 = normalizeImei(trade.imei1);
      const imei2 = normalizeImei(trade.imei2);
      const imeiErr = validateImeiPair(imei1, imei2);
      if (imeiErr) { setImeiError(imeiErr); return; }
      setImeiError(null);
      
      if (!trade.model.trim()) { toast.error("Informe o modelo do usado."); return; }
      if ((parseBRLToCents(trade.value) ?? 0) <= 0) { toast.error("Informe o valor acordado do usado."); return; }
      if (!finalClientId && !newClient.name.trim()) { toast.error("Venda com usado na troca exige cliente identificado."); return; }
    }

    setBusy(true);
    try {
      if (!finalClientId && newClient.name.trim()) {
        const { data: c, error } = await supabase
          .from("clients")
          .insert({ store_id: store.id, name: newClient.name.trim(), whatsapp: newClient.whatsapp.trim() || null })
          .select("id")
          .single();
        if (error) throw error;
        finalClientId = c.id;
      }

      const battery = trade.battery_health ? Number(trade.battery_health) : null;
      const { data: saleId, error } = await supabase.rpc("complete_sale_evaluated", {
        _evaluation_id: (hasTradeIn && evaluationId ? evaluationId : null) as unknown as string,
        _store_id: store.id,
        _client_id: finalClientId as string,
        _items: [...items.map((i) => ({ device_id: i.device.id, price: centsToDecimal(i.priceCents) })), ...products.map(p => ({ accessory_id: p.product.id, quantity: Number(p.quantity), price: centsToDecimal(p.priceCents) }))],
        _discount: totals.discountCents / 100,
        _payments: payments
          .filter((p) => (parseBRLToCents(p.amount) ?? 0) > 0)
          .map((p) => ({
            method: p.method,
            amount: centsToDecimal((parseBRLToCents(p.amount) ?? 0)),
            installments: p.installments ? Number(p.installments) : null,
          })),
        _trade_in: hasTradeIn
          ? {
              model: trade.model.trim(),
              storage: trade.storage || null,
              color: trade.color || null,
              imei1: normalizeImei(trade.imei1),
              imei2: normalizeImei(trade.imei2),
              serial_number: trade.serial_number || null,
              condition: trade.condition,
              conservation: trade.conservation || null,
              battery_health: battery,
              defects: trade.defects || null,
              agreed_value: centsToDecimal((parseBRLToCents(trade.value) ?? 0)),
            }
          : null,
        _notes: (notes.trim() || null) as string,
        _client_token: clientToken,
      });
      if (error) throw error;
      await qc.invalidateQueries();
      toast.success("Venda registrada.");
      navigate({ to: "/app/vendas/$id", params: { id: saleId as string } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao registrar a venda.");
      setBusy(false);
    }
  }

  if (!perms.registerSales)
    return <p className="text-sm text-muted-foreground">Você não tem permissão para registrar vendas.</p>;

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/app/vendas" className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />Vendas</Link>
      <h1 className="mb-6 text-2xl font-semibold">Nova venda</h1>

      <div className="space-y-6">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Cliente</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Cliente cadastrado</Label>
              <Select value={clientId} onValueChange={(v) => { setClientId(v === "none" ? "" : v); setEvaluationId(""); if (v !== "none") setNewClient({ name: "", whatsapp: "" }); }}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem cliente / avulso</SelectItem>
                  {(data?.clients ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.whatsapp ? ` · ${c.whatsapp}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {!clientId && (
              <div className="space-y-1.5">
                <Label>Ou cadastrar agora</Label>
                <div className="flex gap-2">
                  <Input placeholder="Nome" value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} />
                  <Input placeholder="WhatsApp" className="w-36" value={newClient.whatsapp} onChange={(e) => setNewClient({ ...newClient, whatsapp: e.target.value })} />
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Itens da venda</h2>
          {items.length > 0 && (
            <ul className="mb-4 space-y-2">
              {items.map((i) => (
                <li key={i.device.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{i.device.model} {i.device.storage}</p>
                    <p className="text-xs text-muted-foreground">{[i.device.color, i.device.imei1 ? `IMEI ${i.device.imei1}` : null, STATUS_LABEL[i.device.status]].filter(Boolean).join(" · ")}</p>
                    {i.device.min_price != null && perms.viewCosts === false && perms.giveDiscounts === false && (
                      <p className="text-xs text-muted-foreground">Mínimo autorizado: {formatCents(toCents(i.device.min_price))}</p>
                    )}
                  </div>
                  <Input
                    className="w-32"
                    inputMode="decimal"
                    value={centsToInput(i.priceCents)}
                    onChange={(e) => setItems((p) => p.map((x) => x.device.id === i.device.id ? { ...x, priceCents: parseBRLToCents(e.target.value) ?? 0 } : x))}
                    aria-label={`Preço de ${i.device.model}`}
                  />
                  <Button type="button" size="icon" variant="ghost" onClick={() => setItems((p) => p.filter((x) => x.device.id !== i.device.id))} aria-label="Remover"><Trash2 className="h-4 w-4" /></Button>
                </li>
              ))}
            </ul>
          )}
          {products.length > 0 && <ul className="mb-4 space-y-2">{products.map(p => <li key={p.product.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0 basis-full sm:flex-1 sm:basis-0"><p className="break-words font-medium">{p.product.name}</p><p className="text-xs text-muted-foreground">Saldo disponível: {p.product.quantity} · Unitário: {formatCents(p.priceCents)}</p></div>
            <div className="space-y-1"><Label htmlFor={`qty-${p.product.id}`}>Quantidade</Label><Input id={`qty-${p.product.id}`} className="w-24" type="number" min="1" max={p.product.quantity} step="1" value={p.quantity} onChange={e => setProducts(prev => prev.map(i => i.product.id === p.product.id ? {...i, quantity: e.target.value} : i))} /></div>
            <span className="text-sm font-medium">Subtotal: {formatCents(p.priceCents * (Number(p.quantity) || 0))}</span>
            <Button type="button" size="icon" variant="ghost" aria-label={`Remover ${p.product.name}`} onClick={() => setProducts(prev => prev.filter(i => i.product.id !== p.product.id))}><Trash2 className="h-4 w-4" /></Button>
          </li>)}</ul>}
          {productError && <p role="alert" className="mb-3 text-sm text-destructive">{productError}</p>}
          {searchError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar os itens do estoque.</p>}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Buscar aparelho ou produto por nome, modelo, IMEI ou código" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} />
          </div>
          {itemSearch.trim() && (
            <ul className="mt-2 divide-y rounded-lg border">
              {available.length === 0 && availableProducts.length === 0 && <li className="p-3 text-sm text-muted-foreground">Nenhum item com saldo disponível encontrado.</li>}
              {availableProducts.map(p => <li key={p.id}><Button type="button" variant="ghost" className="flex h-auto w-full justify-between gap-2 whitespace-normal rounded-none p-3 text-left" onClick={() => {setProducts(prev => [...prev, {product:p, quantity:"1", priceCents:toCents(p.sale_price)}]); setItemSearch("");}} disabled={p.sale_price == null || p.sale_price <= 0}><span className="min-w-0 break-words">{p.name}<span className="block text-xs text-muted-foreground">Saldo disponível: {p.quantity}</span></span><span className="shrink-0">{p.sale_price != null ? formatCents(toCents(p.sale_price)) : "Sem preço de venda"}</span></Button></li>)}
              {available.map((d) => (
                <li key={d.id}>
                  <Button variant="ghost" type="button" className="flex h-auto w-full items-center justify-between gap-2 whitespace-normal rounded-none p-3 text-left text-sm" onClick={() => { setItems((p) => [...p, { device: d, priceCents: toCents(d.sale_price) }]); setItemSearch(""); }}>
                    <span>{d.model} {d.storage} {d.color && `· ${d.color}`} <Badge variant="secondary" className="ml-1">{STATUS_LABEL[d.status]}</Badge></span>
                    <span className="font-medium">{d.sale_price != null ? formatCents(toCents(d.sale_price)) : "Sem preço"}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border bg-card p-5">
          <label className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <Checkbox checked={hasTradeIn} onCheckedChange={(v) => setHasTradeIn(v === true)} />Usado recebido na troca
          </label>
          {hasTradeIn && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2"><Label>Usar dados de uma avaliação (opcional)</Label>
                <Select value={evaluationId} onValueChange={pickEvaluation}>
                  <SelectTrigger><SelectValue placeholder={!clientId ? "Selecione o cliente primeiro" : clientEvaluations.length ? "Escolha a avaliação" : "Nenhuma avaliação para este cliente"} /></SelectTrigger>
                  <SelectContent>{clientEvaluations.map((e) => <SelectItem key={e.id} value={e.id}>{e.model} {e.storage} — {formatCents(toCents(e.offered_value))}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Modelo *</Label><Input value={trade.model} onChange={(e) => setTrade({ ...trade, model: e.target.value })} placeholder="iPhone 11" /></div>
              <div className="space-y-1.5"><Label>Armazenamento</Label>
                <Select value={trade.storage} onValueChange={(v) => setTrade({ ...trade, storage: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{STORAGE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Cor</Label><Input value={trade.color} onChange={(e) => setTrade({ ...trade, color: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Valor acordado (R$) *</Label><Input inputMode="decimal" value={trade.value} onChange={(e)=>setTrade({...trade,value:e.target.value})} aria-label="Valor acordado (R$)" /></div>
              <div className="space-y-1.5"><Label htmlFor="trade-imei1">IMEI 1</Label><Input id="trade-imei1" aria-invalid={!!imeiError} aria-describedby="trade-imei-error" inputMode="numeric" maxLength={15} value={trade.imei1} onChange={(e) => setTrade({ ...trade, imei1: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="trade-imei2">IMEI 2</Label><Input id="trade-imei2" aria-invalid={!!imeiError} aria-describedby="trade-imei-error" inputMode="numeric" maxLength={15} value={trade.imei2} onChange={(e) => setTrade({ ...trade, imei2: e.target.value })} /></div>
              {imeiError && <p id="trade-imei-error" role="alert" className="text-sm text-destructive sm:col-span-2">{imeiError}</p>}
              <div className="space-y-1.5"><Label>Número de série</Label><Input value={trade.serial_number} onChange={(e) => setTrade({ ...trade, serial_number: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Bateria (%)</Label><Input inputMode="numeric" value={trade.battery_health} onChange={(e) => setTrade({ ...trade, battery_health: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Conservação</Label><Input value={trade.conservation} onChange={(e) => setTrade({ ...trade, conservation: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Defeitos</Label><Input value={trade.defects} onChange={(e) => setTrade({ ...trade, defects: e.target.value })} /></div>
              <p className="text-xs text-muted-foreground sm:col-span-2">O usado entra no estoque como “Em conferência”, vinculado ao cliente e a esta venda, com o valor acordado como custo de aquisição.</p>
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Pagamentos</h2>
          <div className="space-y-2">
            {payments.map((p, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-2">
                <Select value={p.method} onValueChange={(v) => setPayments((prev) => prev.map((x, i) => i === idx ? { ...x, method: v as PaymentMethod } : x))}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(PAYMENT_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="w-36" inputMode="decimal" placeholder="Valor (R$)" value={p.amount} onChange={(e) => setPayments((prev) => prev.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))} />
                {(p.method === "cartao_credito" || p.method === "crediario") && (
                  <Input className="w-28" inputMode="numeric" placeholder="Parcelas" value={p.installments} onChange={(e) => setPayments((prev) => prev.map((x, i) => i === idx ? { ...x, installments: e.target.value } : x))} />
                )}
                {payments.length > 1 && <Button type="button" size="icon" variant="ghost" onClick={() => setPayments((prev) => prev.filter((_, i) => i !== idx))} aria-label="Remover pagamento"><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={addPayment}><Plus className="mr-1 h-4 w-4" />Adicionar meio de pagamento</Button>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Desconto (R$){!perms.giveDiscounts && " — sem permissão"}</Label>
              <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} disabled={!perms.giveDiscounts} />
            </div>
            <div className="space-y-1.5"><Label>Observações</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Resumo</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt>Itens da venda</dt><dd>{formatCents(totals.itemsCents)}</dd></div>
            {totals.discountCents > 0 && <div className="flex justify-between"><dt>Desconto</dt><dd>-{formatCents(totals.discountCents)}</dd></div>}
            <div className="flex justify-between font-semibold"><dt>Total da venda (faturamento)</dt><dd>{formatCents(totals.totalCents)}</dd></div>
            {totals.tradeInCents > 0 && <div className="flex justify-between"><dt>Usado na troca (aquisição, não é desconto)</dt><dd>-{formatCents(totals.tradeInCents)}</dd></div>}
            <div className="flex justify-between"><dt>Recebido agora (dinheiro, Pix, cartão…)</dt><dd>-{formatCents(totals.receivedCents)}</dd></div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>{totals.balanceCents > 0 ? "Saldo pendente" : "Saldo"}</dt>
              <dd className={totals.balanceCents > 0 ? "text-warning-foreground" : ""}>{formatCents(Math.max(0, totals.balanceCents))}</dd>
            </div>
          </dl>
          <div className="sticky bottom-16 mt-6 flex justify-end lg:bottom-0">
            <Button size="lg" onClick={submit} disabled={busy || (items.length === 0 && products.length === 0) || !!productError}>
              {busy ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Registrando…</> : "Confirmar venda"}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
