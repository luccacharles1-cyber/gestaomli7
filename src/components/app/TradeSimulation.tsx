import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {toast} from "sonner";
import {Copy,MessageCircle} from "lucide-react";
import {supabase} from "@/integrations/supabase/client";
import {useStore} from "@/lib/store-context";
import {centsToInput,parseBRLToCents,toCents} from "@/lib/money";
import {proposalText,proposalWhatsApp} from "@/lib/trade-proposal";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from "@/components/ui/select";
export function TradeSimulation({used,offered,clientId}:{used:string;offered:number|null;clientId:string}){
 const {store}=useStore();const [selected,setSelected]=useState("");const [price,setPrice]=useState("");
 const {data}=useQuery({queryKey:["trade-simulation",store.id],queryFn:async()=>{const [d,p,c]=await Promise.all([supabase.from("devices").select("id,model,storage,color,status,sale_price").eq("store_id",store.id).order("model"),supabase.from("evaluation_prices").select("model,storage").eq("store_id",store.id).eq("archived",false),supabase.from("clients").select("id,whatsapp").eq("store_id",store.id)]);for(const r of [d,p,c])if(r.error)throw r.error;return {devices:d.data??[],prices:p.data??[],clients:c.data??[]};}});
 const units=(data?.devices??[]).filter(d=>d.status==="disponivel");
 const models=Array.from(new Set([...(data?.devices??[]).map(d=>`${d.model} ${d.storage??""}`.trim()),...(data?.prices??[]).map(d=>`${d.model} ${d.storage}`.trim())]));
 const unit=units.find(d=>d.id===selected);const desired=unit?`${unit.model} ${unit.storage??""} ${unit.color??""}`:selected.startsWith("model:")?selected.slice(6):"";
 const priceCents=parseBRLToCents(price);const valid=!!used.trim()&&!!desired&&offered!=null&&priceCents!=null;
 const text=valid?proposalText({used,offered:offered??0,desired,price:priceCents??0,available:!!unit}):"";
 return <div className="space-y-4 border-t pt-4"><Label>Aparelho desejado</Label><Select value={selected} onValueChange={v=>{setSelected(v);const d=units.find(d=>d.id===v);setPrice(d?.sale_price!=null?centsToInput(toCents(d.sale_price)):"");}}><SelectTrigger aria-label="Aparelho desejado"><SelectValue placeholder="Selecionar estoque ou modelo"/></SelectTrigger><SelectContent>{units.map(d=><SelectItem key={d.id} value={d.id}>Estoque · {d.model} {d.storage} {d.color}</SelectItem>)}{models.map(m=><SelectItem key={m} value={`model:${m}`}>Catálogo · {m}</SelectItem>)}</SelectContent></Select><Label htmlFor="proposal-price">Preço da proposta (R$)</Label><Input id="proposal-price" inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)}/>{selected&&!unit&&<p className="text-sm text-warning-foreground">Disponibilidade a confirmar</p>}{text&&<p data-testid="trade-proposal" className="whitespace-pre-wrap break-words border-t py-3 text-sm">{text}</p>}<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!valid} onClick={async()=>{try{await navigator.clipboard.writeText(text);toast.success("Proposta copiada.");}catch{toast.error("Não foi possível copiar.");}}}><Copy className="mr-1 h-4 w-4"/>Copiar proposta</Button><Button type="button" disabled={!valid} onClick={()=>window.open(proposalWhatsApp(text,data?.clients.find(c=>c.id===clientId)?.whatsapp),"_blank","noopener")}><MessageCircle className="mr-1 h-4 w-4"/>Enviar pelo WhatsApp</Button></div></div>;
}