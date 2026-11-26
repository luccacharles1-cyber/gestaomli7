import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";
import { normalizeImei, validateImeiPair } from "@/lib/imei";
import { centsToDecimal, centsToInput, formatCents, parseBRLToCents, toCents } from "@/lib/money";
import { STATUS_LABEL, STATUS_ORDER, STORAGE_OPTIONS, TEST_CHECKLIST, type Device, type DeviceStatus } from "@/lib/devices";
import { todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Costs = { purchase_cost: string | number; freight_cost: string | number; other_costs: string | number } | null;

export function DeviceForm({ device, costs, onSaved }: { device?: Device; costs?: Costs; onSaved: (id: string) => void }) {
  const { store, perms } = useStore();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    internal_code: device?.internal_code ?? "",
    category: device?.category ?? "iPhone",
    brand: device?.brand ?? "Apple",
    model: device?.model ?? "",
    storage: device?.storage ?? "",
    color: device?.color ?? "",
    imei1: device?.imei1 ?? "",
    imei2: device?.imei2 ?? "",
    serial_number: device?.serial_number ?? "",
    condition: device?.condition ?? "seminovo",
    conservation: device?.conservation ?? "",
    battery_health: device?.battery_health?.toString() ?? "",
    replaced_parts: device?.replaced_parts ?? "",
    defects: device?.defects ?? "",
    notes: device?.notes ?? "",
    origin_name: device?.origin_name ?? "",
    acquired_at: device?.acquired_at ?? todayISO(),
    sale_price: device?.sale_price != null ? centsToInput(toCents(device.sale_price)) : "",
    min_price: device?.min_price != null ? centsToInput(toCents(device.min_price)) : "",
    location: device?.location ?? "",
    status: (device?.status ?? "em_conferencia") as DeviceStatus,
    purchase_cost: costs ? centsToInput(toCents(costs.purchase_cost)) : "",
    freight_cost: costs ? centsToInput(toCents(costs.freight_cost)) : "",
    other_costs: costs ? centsToInput(toCents(costs.other_costs)) : "",
  });
  const [checklist, setChecklist] = useState<Record<string, boolean>>(
    (device?.test_checklist as Record<string, boolean>) ?? {},
  );
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const totalCost =
    (parseBRLToCents(f.purchase_cost) ?? 0) + (parseBRLToCents(f.freight_cost) ?? 0) + (parseBRLToCents(f.other_costs) ?? 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const imei1 = normalizeImei(f.imei1);
    const imei2 = normalizeImei(f.imei2);
    const imeiErr = validateImeiPair(imei1, imei2);
    if (imeiErr) { toast.error(imeiErr); return; }
    const battery = f.battery_health ? Number(f.battery_health) : null;
    if (battery != null && (!Number.isInteger(battery) || battery < 0 || battery > 100)) { toast.error("Saúde da bateria deve ser entre 0 e 100."); return; }
    const money = (s: string, label: string) => {
      if (!s.trim()) return { ok: true as const, v: null };
      const c = parseBRLToCents(s);
      if (c == null) { toast.error(`Valor inválido em ${label}.`); return { ok: false as const }; }
      return { ok: true as const, v: c / 100 };
    };
    const sp = money(f.sale_price, "Preço de venda"); if (!sp.ok) return;
    const mp = money(f.min_price, "Preço mínimo"); if (!mp.ok) return;
    if (sp.v && mp.v && mp.v > sp.v) { toast.error("O preço mínimo não pode ser maior que o preço de venda."); return; }

    const payload = {
      store_id: store.id,
      internal_code: f.internal_code || null,
      category: f.category || "iPhone",
      brand: f.brand || "Apple",
      model: f.model.trim(),
      storage: f.storage || null,
      color: f.color || null,
      imei1, imei2,
      serial_number: f.serial_number || null,
      condition: f.condition as "novo" | "seminovo",
      conservation: f.conservation || null,
      battery_health: battery,
      replaced_parts: f.replaced_parts || null,
      defects: f.defects || null,
      notes: f.notes || null,
      test_checklist: checklist,
      origin_name: f.origin_name || null,
      acquired_at: f.acquired_at || null,
      sale_price: sp.v,
      min_price: mp.v,
      location: f.location || null,
      status: f.status,
    };

    setBusy(true);
    try {
      const res = device
        ? await supabase.from("devices").update(payload).eq("id", device.id).select("id").single()
        : await supabase.from("devices").insert(payload).select("id").single();
      if (res.error) {
        if (res.error.code === "23505" || /IMEI/.test(res.error.message)) throw new Error("Este IMEI já está cadastrado em outro aparelho da loja.");
        throw new Error(res.error.message);
      }
      const id = res.data.id;
      if (perms.viewCosts && perms.manageInventory) {
        const c = (s: string) => (parseBRLToCents(s) ?? 0) / 100;
        const { error } = await supabase.from("device_costs").upsert({
          device_id: id, store_id: store.id,
          purchase_cost: c(f.purchase_cost), freight_cost: c(f.freight_cost), other_costs: c(f.other_costs),
        });
        if (error) throw new Error("Aparelho salvo, mas os custos não: " + error.message);
      }
      toast.success(device ? "Aparelho atualizado." : "Aparelho cadastrado.");
      onSaved(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Section title="Identificação">
        <F label="Modelo *"><Input required value={f.model} onChange={(e) => set("model")(e.target.value)} placeholder="iPhone 13 Pro" /></F>
        <F label="Armazenamento">
          <Select value={f.storage} onValueChange={set("storage")}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{STORAGE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </F>
        <F label="Cor"><Input value={f.color} onChange={(e) => set("color")(e.target.value)} /></F>
        <F label="Código interno"><Input value={f.internal_code} onChange={(e) => set("internal_code")(e.target.value)} /></F>
        <F label="IMEI 1"><Input inputMode="numeric" maxLength={15} value={f.imei1} onChange={(e) => set("imei1")(e.target.value)} /></F>
        <F label="IMEI 2"><Input inputMode="numeric" maxLength={15} value={f.imei2} onChange={(e) => set("imei2")(e.target.value)} /></F>
        <F label="Número de série"><Input value={f.serial_number} onChange={(e) => set("serial_number")(e.target.value)} /></F>
        <F label="Categoria / Marca">
          <div className="flex gap-2">
            <Input value={f.category} onChange={(e) => set("category")(e.target.value)} />
            <Input value={f.brand} onChange={(e) => set("brand")(e.target.value)} />
          </div>
        </F>
      </Section>

      <Section title="Condição">
        <F label="Novo ou seminovo">
          <Select value={f.condition} onValueChange={set("condition")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="novo">Novo</SelectItem><SelectItem value="seminovo">Seminovo</SelectItem></SelectContent>
          </Select>
        </F>
        <F label="Estado de conservação"><Input value={f.conservation} onChange={(e) => set("conservation")(e.target.value)} placeholder="Ex.: Excelente, marcas leves" /></F>
        <F label="Saúde da bateria (%)"><Input inputMode="numeric" value={f.battery_health} onChange={(e) => set("battery_health")(e.target.value)} /></F>
        <F label="Peças substituídas"><Input value={f.replaced_parts} onChange={(e) => set("replaced_parts")(e.target.value)} /></F>
        <F label="Defeitos" wide><Textarea rows={2} value={f.defects} onChange={(e) => set("defects")(e.target.value)} /></F>
        <div className="sm:col-span-2">
          <Label>Checklist de testes</Label>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
            {TEST_CHECKLIST.map((t) => (
              <label key={t} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                <Checkbox checked={!!checklist[t]} onCheckedChange={(v) => setChecklist((p) => ({ ...p, [t]: v === true }))} />
                {t}
              </label>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Origem e custos">
        <F label="Fornecedor ou cliente de origem"><Input value={f.origin_name} onChange={(e) => set("origin_name")(e.target.value)} /></F>
        <F label="Data de aquisição"><Input type="date" value={f.acquired_at} onChange={(e) => set("acquired_at")(e.target.value)} /></F>
        {perms.viewCosts ? (
          <>
            <F label="Custo de compra (R$)"><Input inputMode="decimal" value={f.purchase_cost} onChange={(e) => set("purchase_cost")(e.target.value)} /></F>
            <F label="Frete (R$)"><Input inputMode="decimal" value={f.freight_cost} onChange={(e) => set("freight_cost")(e.target.value)} /></F>
            <F label="Outros custos (R$)"><Input inputMode="decimal" value={f.other_costs} onChange={(e) => set("other_costs")(e.target.value)} /></F>
            <div className="flex items-end"><p className="text-sm">Custo total: <strong>{formatCents(totalCost)}</strong></p></div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground sm:col-span-2">Você não tem permissão para ver custos.</p>
        )}
      </Section>

      <Section title="Comercial">
        <F label="Preço de venda (R$)"><Input inputMode="decimal" value={f.sale_price} onChange={(e) => set("sale_price")(e.target.value)} /></F>
        <F label="Preço mínimo autorizado (R$)"><Input inputMode="decimal" value={f.min_price} onChange={(e) => set("min_price")(e.target.value)} /></F>
        <F label="Status">
          <Select value={f.status} onValueChange={(v) => set("status")(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUS_ORDER.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
          </Select>
        </F>
        <F label="Localização"><Input value={f.location} onChange={(e) => set("location")(e.target.value)} placeholder="Ex.: Vitrine 2" /></F>
        <F label="Observações internas" wide><Textarea rows={2} value={f.notes} onChange={(e) => set("notes")(e.target.value)} /></F>
      </Section>

      <div className="sticky bottom-16 flex justify-end gap-2 lg:bottom-0">
        <Button type="submit" size="lg" disabled={busy}>{busy ? "Salvando…" : device ? "Salvar alterações" : "Cadastrar aparelho"}</Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function F({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
