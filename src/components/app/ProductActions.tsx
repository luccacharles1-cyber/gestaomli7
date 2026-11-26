import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Archive, RotateCcw, History, Trash2, ListPlus } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";
import { centsToInput, parseBRLToCents, toCents } from "@/lib/money";
import { canDeleteProduct, stockAdjustment } from "@/lib/product-stock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

type Product = Database["public"]["Tables"]["accessories"]["Row"];
export function ProductActions({ product, unitCost, hasHistory }: { product: Product; unitCost: number | null; hasHistory: boolean }) {
  const { store, perms } = useStore();
  const qc = useQueryClient();
  const [action,setAction] = useState("");
  const [busy,setBusy] = useState(false);
  const [form,setForm] = useState({name:"",category:"",description:"",cost:"",price:"",quantity:"",reason:""});
  function open(value:string) {
    setForm({name:product.name,category:product.category ?? "",description:product.description ?? "",cost:unitCost == null ? "" : centsToInput(toCents(unitCost)),price:product.sale_price == null ? "" : centsToInput(toCents(product.sale_price)),quantity:String(product.quantity),reason:""});
    setAction(value);
  }
  const history = useQuery({queryKey:["product-history",store.id,product.id],enabled:action==="history",queryFn:async()=>{
    const [movements,members]=await Promise.all([
      supabase.from("accessory_movements").select("*").eq("store_id",store.id).eq("accessory_id",product.id).order("created_at",{ascending:false}),
      supabase.from("store_members").select("user_id,email").eq("store_id",store.id),
    ]);
    if(movements.error) throw movements.error;
    if(members.error) throw members.error;
    return (movements.data ?? []).map(m=>({...m,delta:m.new_quantity-m.previous_quantity,actorLabel:members.data?.find(u=>u.user_id===m.actor)?.email ?? m.actor ?? "Sistema"}));
  }});
  async function save(e:FormEvent) {
    e.preventDefault(); if(busy) return;
    try {
      let values: Record<string,string|number> = {};
      if(action==="edit") {
        const price=form.price.trim() ? parseBRLToCents(form.price) : null;
        if(form.price.trim() && price==null) throw new Error("Preço inválido.");
        values={name:form.name,category:form.category,description:form.description,sale_price:price==null ? "" : price/100};
        if(perms.viewCosts && form.cost.trim()) {
          const cost=parseBRLToCents(form.cost); if(cost==null) throw new Error("Custo inválido.");
          values["unit_cost"]=cost/100;
        }
      } else if(action==="adjust") values=stockAdjustment(product.quantity,Number(form.quantity),form.reason);
      setBusy(true);
      const result=await supabase.rpc("manage_accessory",{_store_id:store.id,_id:product.id,_action:action,_values:values});
      if(result.error) throw result.error;
      toast.success(result.data); setAction("");
      await Promise.all(["accessories","sale-form-data","dashboard","sales-report","product-history"].map(key=>qc.invalidateQueries({queryKey:[key]})));
    } catch(error) {toast.error(error instanceof Error ? error.message : String((error as {message?:string}).message ?? "Não foi possível salvar."));}
    finally {setBusy(false);}
  }
  const blocked=(action==="archive" || action==="delete") && product.quantity>0;
  return <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Ações de ${product.name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {perms.manageInventory && <>
          <DropdownMenuItem onSelect={()=>open("edit")}><Pencil />Editar produto</DropdownMenuItem>
          {product.archived ? <DropdownMenuItem onSelect={()=>open("reactivate")}><RotateCcw />Reativar produto</DropdownMenuItem> : <>
            <DropdownMenuItem onSelect={()=>open("adjust")}><ListPlus />Ajustar quantidade</DropdownMenuItem>
            {canDeleteProduct(product.quantity,hasHistory) ? <DropdownMenuItem onSelect={()=>open("delete")}><Trash2 />Excluir produto</DropdownMenuItem> : <DropdownMenuItem onSelect={()=>open("archive")}><Archive />Arquivar produto</DropdownMenuItem>}
          </>}
        </>}
        <DropdownMenuItem onSelect={()=>open("history")}><History />Histórico de movimentações</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={!!action} onOpenChange={v=>{if(!v && !busy)setAction("");}}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{({edit:"Editar produto",adjust:"Ajustar quantidade",delete:"Excluir produto",archive:"Arquivar produto",reactivate:"Reativar produto",history:"Histórico de movimentações"} as Record<string,string>)[action]}</DialogTitle></DialogHeader>
      {action==="history" ? <div className="space-y-3"><p className="font-medium">{product.name} · Saldo: {product.quantity}</p>{history.isPending ? <p>Carregando…</p> : history.error ? <p className="text-destructive">Não foi possível carregar o histórico.</p> : !history.data?.length ? <p className="text-muted-foreground">Nenhuma movimentação registrada.</p> : history.data.map(m=><div key={m.id} className="border-b pb-3 text-sm"><p className="font-medium">{m.delta>0 ? "Entrada" : "Saída"} de {Math.abs(m.delta)} · {m.previous_quantity} → {m.new_quantity}</p><p>{m.reason}</p><p className="break-all text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString("pt-BR")} · {m.actorLabel}</p></div>)}</div> : <form onSubmit={save} className="space-y-4">
        {action==="edit" ? <>
          <div className="space-y-1"><Label htmlFor="product-name">Nome</Label><Input id="product-name" required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></div>
          <div className="space-y-1"><Label htmlFor="product-category">Categoria</Label><Input id="product-category" value={form.category} onChange={e=>setForm({...form,category:e.target.value})} /></div>
          <div className="space-y-1"><Label htmlFor="product-description">Descrição</Label><Textarea id="product-description" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} /></div>
          {perms.viewCosts && <div className="space-y-1"><Label htmlFor="product-cost">Custo unitário (R$)</Label><Input id="product-cost" inputMode="decimal" value={form.cost} onChange={e=>setForm({...form,cost:e.target.value})} /></div>}
          <div className="space-y-1"><Label htmlFor="product-price">Preço de venda (R$)</Label><Input id="product-price" inputMode="decimal" value={form.price} onChange={e=>setForm({...form,price:e.target.value})} /></div>
        </> : action==="adjust" ? <>
          <p>{product.name} · Saldo atual: <strong>{product.quantity}</strong></p>
          <div className="space-y-1"><Label htmlFor="product-quantity">Quantidade correta</Label><Input id="product-quantity" type="number" min="0" step="1" required value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})} /></div>
          <div className="space-y-1"><Label htmlFor="product-reason">Motivo</Label><Textarea id="product-reason" required value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} /></div>
        </> : <><p>{product.name}</p><p className="text-sm">{blocked ? `Saldo: ${product.quantity} unidades. Resolva esse saldo antes de arquivar ou excluir.` : action==="delete" ? "Confirma a exclusão definitiva deste produto sem saldo e sem histórico?" : action==="archive" ? "Confirma o arquivamento? O histórico será preservado." : "Confirma a reativação deste produto?"}</p></>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>setAction("")}>Cancelar</Button><Button disabled={busy || blocked} variant={action==="delete" ? "destructive" : "default"}>{busy ? "Salvando…" : action==="edit" || action==="adjust" ? "Salvar" : "Confirmar"}</Button></div>
      </form>}
    </DialogContent></Dialog>
  </>;
}