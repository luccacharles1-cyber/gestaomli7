import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getSalesReport } from "@/lib/sales-report.functions";
import { formatCents } from "@/lib/money";
import { formatDateTime, TZ } from "@/lib/format";
import { useStore } from "@/lib/store-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Filters = { period:string; from:string; to:string; seller:string; model:string };
const options = (filters:Filters, storeId?:string) => queryOptions({queryKey:["sales-report",storeId,filters],queryFn:()=>getSalesReport({data:{...filters,storeId}})});

export const Route = createFileRoute("/_authenticated/app/relatorios")({
  validateSearch: (s:Record<string,unknown>):Filters => ({period:typeof s["period"]==="string"?s["period"]:"mes",from:typeof s["from"]==="string"?s["from"]:"",to:typeof s["to"]==="string"?s["to"]:"",seller:typeof s["seller"]==="string"?s["seller"]:"",model:typeof s["model"]==="string"?s["model"]:""}),
  loaderDeps: ({search})=>search,
  loader: ({context,deps})=>context.queryClient.ensureQueryData(options(deps)),
  head: () => ({ meta: [{ title: "Relatório de Vendas — MLI Gestão" }, { name: "description", content: "Vendas reais da loja por período, vendedor e modelo, com trocas e recebimentos separados." }, { property: "og:title", content: "Relatório de Vendas — MLI Gestão" }, { property: "og:description", content: "Faturamento, itens, lucro autorizado e saldos da loja." },{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"}] }),
  errorComponent:({error,reset})=><div className="space-y-3"><p role="alert" className="text-destructive">{error instanceof Error ? error.message : "Não foi possível carregar o relatório."}</p><Button onClick={reset}>Tentar novamente</Button><Button variant="outline" asChild><Link to="/app/relatorios" search={{period:"mes",from:"",to:"",seller:"",model:""}}>Mês atual</Link></Button></div>,
  notFoundComponent:()=> <p>Relatório não encontrado.</p>,
  component: SalesReportPage,
});

function SalesReportPage() {
  const filters=Route.useSearch();
  const navigate=useNavigate({from:Route.fullPath});
  const {store}=useStore();
  const {data}=useSuspenseQuery(options(filters,store.id));
  const set=(key:keyof Filters,value:string)=>navigate({search:prev=>({...prev,[key]:value})});
  const sellerName=(id:string|null)=>data.team.find(m=>m.user_id===id)?.email ?? "Vendedor não identificado";
  const s=data.summary;
  const metrics=[{label:"Faturamento",value:formatCents(s.revenue)},{label:"Quantidade de vendas",value:String(s.sales)},{label:"Itens vendidos",value:String(s.devices)},{label:"Ticket médio",value:s.sales?formatCents(s.ticket):"—"},...(data.canCosts?[{label:"Lucro bruto",value:formatCents(s.profit ?? 0)},{label:"Margem bruta",value:s.margin==null?"—":`${s.margin.toFixed(1).replace(".",",")}%`}]:[])];
  return <div className="mx-auto max-w-6xl space-y-6">
    <header><h1 className="text-2xl font-semibold">Relatório de Vendas</h1><p className="mt-1 text-sm text-muted-foreground">Data da venda · {data.range.from} a {data.range.to} · Fuso da loja: {TZ}</p></header>
    <section className="space-y-3">
      <ToggleGroup type="single" variant="outline" value={filters.period} onValueChange={v=>{if(v) void navigate({search:prev=>({...prev,period:v,from:prev.from||data.range.from,to:prev.to||data.range.to})});}} className="flex flex-wrap justify-start">
        <ToggleGroupItem value="hoje">Hoje</ToggleGroupItem><ToggleGroupItem value="7d">Últimos 7 dias</ToggleGroupItem><ToggleGroupItem value="mes">Mês atual</ToggleGroupItem><ToggleGroupItem value="custom">Personalizado</ToggleGroupItem>
      </ToggleGroup>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {filters.period==="custom" && <><div><Label htmlFor="report-from">De</Label><Input id="report-from" type="date" value={filters.from} onChange={e=>{if(e.target.value) void set("from",e.target.value);}} /></div><div><Label htmlFor="report-to">Até</Label><Input id="report-to" type="date" value={filters.to} onChange={e=>{if(e.target.value) void set("to",e.target.value);}} /></div></>}
        <div><Label>Vendedor</Label><Select value={filters.seller||"all"} onValueChange={v=>void set("seller",v==="all"?"":v)}><SelectTrigger aria-label="Vendedor"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os vendedores</SelectItem>{data.team.map(m=><SelectItem key={m.user_id} value={m.user_id}>{m.email ?? "Sem e-mail"}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Modelo / Produto</Label><Select value={filters.model||"all"} onValueChange={v=>void set("model",v==="all"?"":v)}><SelectTrigger aria-label="Modelo / Produto"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os itens</SelectItem>{data.models.map(m=><SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div>
      </div>
    </section>
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-3">{metrics.map(m=><div key={m.label} className="border-b pb-4"><p className="text-sm text-muted-foreground">{m.label}{s.incomplete && ["Lucro bruto","Margem bruta"].includes(m.label)?" · parcial":""}</p><p className="mt-1 break-words text-xl font-semibold">{m.value}</p></div>)}</section>
    {data.canCosts && s.incomplete>0 && <p role="status" className="text-sm text-warning-foreground">Lucro incompleto em {s.incomplete} venda(s); itens sem custo estão indicados abaixo.</p>}
    <p className="text-xs text-muted-foreground">Canceladas e devoluções por cancelamento não compõem o faturamento. Trocas são aquisições, não recebimentos. Parcelas recebidas depois não geram novo faturamento.{filters.model?" O filtro de modelo inclui o valor integral das vendas que contêm esse modelo.":""}</p>
    <section><h2 className="mb-3 text-lg font-semibold">Vendas</h2>{!data.rows.length?<p className="py-8 text-sm text-muted-foreground">Nenhuma venda neste período.</p>:<Table><TableHeader><TableRow><TableHead>Data / Venda</TableHead><TableHead>Vendedor / Itens</TableHead><TableHead>Valor vendido / Troca</TableHead>{data.canFinance && <><TableHead>Recebido</TableHead><TableHead>Saldo pendente</TableHead></>}{data.canCosts && <TableHead>Lucro bruto</TableHead>}</TableRow></TableHeader><TableBody>{data.rows.map(r=><TableRow key={r.id}><TableCell><Link to="/app/vendas/$id" params={{id:r.id}} className="font-medium underline">Venda nº {r.number ?? "—"}</Link><p className="mt-1 text-xs text-muted-foreground">{formatDateTime(r.date)}</p>{r.status==="cancelada" && <p className="text-xs text-destructive">Cancelada · fora dos totais</p>}</TableCell><TableCell className="max-w-64 whitespace-normal break-words"><p>{sellerName(r.sellerId)}</p>{r.devices.map((d,i)=><p key={i} className="text-xs text-muted-foreground">{d}</p>)}</TableCell><TableCell>{formatCents(r.revenue)}<p className="text-xs text-muted-foreground">Troca: {formatCents(r.tradeIn)}</p></TableCell>{data.canFinance && <><TableCell>{formatCents(r.received ?? 0)}</TableCell><TableCell>{formatCents(r.pending ?? 0)}</TableCell></>}{data.canCosts && <TableCell className="max-w-64 whitespace-normal">{r.profit==null?"—":formatCents(r.profit)}{r.missingCosts.length>0 && <p className="text-xs text-warning-foreground">Sem custo: {r.missingCosts.join(", ")}</p>}</TableCell>}</TableRow>)}</TableBody></Table>}</section>
    <section><h2 className="mb-3 text-lg font-semibold">Resumo por vendedor</h2>{!data.sellers.length?<p className="text-sm text-muted-foreground">Nenhuma venda concluída neste período.</p>:<Table><TableHeader><TableRow><TableHead>Vendedor</TableHead><TableHead>Itens</TableHead><TableHead>Valor vendido</TableHead></TableRow></TableHeader><TableBody>{data.sellers.map(r=><TableRow key={r.id ?? "unknown"}><TableCell className="max-w-64 whitespace-normal break-words">{sellerName(r.id)}</TableCell><TableCell>{r.devices}</TableCell><TableCell>{formatCents(r.revenue)}</TableCell></TableRow>)}</TableBody></Table>}</section>
  </div>;
}
