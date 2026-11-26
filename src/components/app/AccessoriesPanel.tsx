import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";
import { formatBRL, parseBRLToCents } from "@/lib/money";
import { ProductActions } from "./ProductActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AccessoriesPanel() {
  const { store, perms } = useStore();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["accessories", store.id, perms.viewCosts],
    queryFn: async () => {
      const { data, error } = await supabase.from("accessories").select("*").eq("store_id", store.id).order("name");
      if (error) throw error;
      const [costs, movements, sales] = await Promise.all([
        perms.viewCosts ? supabase.from("accessory_costs").select("accessory_id,unit_cost").eq("store_id",store.id) : Promise.resolve({data:[],error:null}),
        supabase.from("accessory_movements").select("accessory_id").eq("store_id",store.id),
        supabase.from("sale_product_items").select("accessory_id").eq("store_id",store.id),
      ]);
      if(costs.error) throw costs.error;
      if(movements.error) throw movements.error;
      if(sales.error) throw sales.error;
      return (data ?? []).map(p=>({...p,unitCost:costs.data?.find(c=>c.accessory_id===p.id)?.unit_cost ?? null,hasHistory:[...(movements.data ?? []),...(sales.data ?? [])].some(m=>m.accessory_id===p.id)}));
    },
  });

  async function add(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const q = Number(qty);
    if (!Number.isInteger(q) || q < 0) { toast.error("Quantidade inválida."); return; }
    const p = price ? parseBRLToCents(price) : null;
    if (price && p == null) { toast.error("Preço inválido."); return; }
    if(cost && parseBRLToCents(cost)==null) {toast.error("Custo inválido."); return;}
    setBusy(true);
    const { data: acc, error } = await supabase
      .from("accessories")
      .insert({ store_id: store.id, name: name.trim(), quantity: q, sale_price: p != null ? p / 100 : null })
      .select("id").single();
    if (!error && perms.viewCosts && cost) {
      const c = parseBRLToCents(cost);
      if (c != null) await supabase.from("accessory_costs").insert({ accessory_id: acc.id, store_id: store.id, unit_cost: c / 100 });
    }
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setName(""); setQty("1"); setPrice(""); setCost("");
    qc.invalidateQueries({ queryKey: ["accessories", store.id] });
  }

  return (
    <div className="space-y-4">
      {perms.manageInventory && (
        <form onSubmit={add} className="grid gap-2 rounded-xl border bg-card p-4 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
          <Input required placeholder="Nome (ex.: Capa MagSafe 13)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input inputMode="numeric" placeholder="Qtd." value={qty} onChange={(e) => setQty(e.target.value)} />
          <Input inputMode="decimal" placeholder="Preço R$" value={price} onChange={(e) => setPrice(e.target.value)} />
          {perms.viewCosts ? <Input inputMode="decimal" placeholder="Custo unit. R$" value={cost} onChange={(e) => setCost(e.target.value)} /> : <div />}
          <Button disabled={busy}>Adicionar</Button>
        </form>
      )}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)} />Mostrar arquivados</label>
      {isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : !data?.filter(a=>showArchived || !a.archived).length ? (
        <p className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">Nenhum acessório cadastrado.</p>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {data.filter(a=>showArchived || !a.archived).map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="break-words font-medium">{a.name}{a.archived ? " · Arquivado" : ""}</p>
                {a.category && <p className="text-xs text-muted-foreground">{a.category}</p>}
                <p className="text-xs text-muted-foreground">{a.sale_price != null ? formatBRL(a.sale_price) : "Sem preço"}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 text-center font-semibold">{a.quantity}</span>
                <ProductActions product={a} unitCost={a.unitCost} hasHistory={a.hasHistory} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
