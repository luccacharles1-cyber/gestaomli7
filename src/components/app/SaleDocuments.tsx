import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Printer, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { saleDocuments,attachInvoice,invoiceUrl } from "@/lib/sale-documents.functions";
import { receiptLines,receiptPdf,type ReceiptData } from "@/lib/sale-receipt";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export function ReceiptView({receipt}:{receipt:ReceiptData}) {
  const [busy,setBusy]=useState(false);
  async function exportPdf(print:boolean){setBusy(true);try{const pdf=await receiptPdf(receipt);if(print){pdf.autoPrint();window.open(pdf.output("bloburl"),"_blank","noopener");}else pdf.save(`recibo-venda-${String(receipt.number ?? 0).padStart(6,"0")}.pdf`);}catch{toast.error("Não foi possível gerar o PDF.");}finally{setBusy(false);}}
  return <div className="space-y-4"><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>exportPdf(false)}><Download className="mr-1 h-4 w-4"/>Baixar PDF</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>exportPdf(true)}><Printer className="mr-1 h-4 w-4"/>Imprimir recibo</Button></div><article data-testid="sale-receipt" className="space-y-2 break-words border-t py-4 text-sm">{receiptLines(receipt).map((line,i)=><p key={i} className={i===0?"text-lg font-semibold":""}>{line}</p>)}</article></div>;
}

export function SaleDocuments({saleId}:{saleId?:string}){
  const {store,perms}=useStore();
  const qc=useQueryClient();
  const [selected,setSelected]=useState<ReceiptData|null>(null);
  const [newOpen,setNewOpen]=useState(false);
  const [type,setType]=useState("receipt");
  const [pick,setPick]=useState(saleId ?? "");
  const [busy,setBusy]=useState(false);
  const fetchDocs=useServerFn(saleDocuments),attach=useServerFn(attachInvoice),url=useServerFn(invoiceUrl);
  const {data,error,isLoading}=useQuery({queryKey:["sale-documents",store.id,saleId],enabled:perms.viewContracts,queryFn:()=>fetchDocs({data:{storeId:store.id,saleId}})});
  if(!perms.viewContracts)return null;
  async function upload(files:FileList|null){if(!files?.length||!pick)return;setBusy(true);try{for(const file of Array.from(files)){
    const ext=file.name.split(".").pop()?.toLowerCase();if(!["pdf","xml"].includes(ext ?? "")||file.size>10*1024*1024)throw new Error("Envie XML ou PDF de até 10 MB.");
    const kind=ext as "pdf"|"xml";
    const path=`${store.id}/invoices/${pick}/${crypto.randomUUID()}.${kind}`;
    const result=await supabase.storage.from("store-files").upload(path,file,{contentType:kind==="pdf"?"application/pdf":"application/xml"});if(result.error)throw result.error;
    try{await attach({data:{storeId:store.id,saleId:pick,path,filename:file.name,kind}});}catch(error){await supabase.storage.from("store-files").remove([path]);throw error;}
  }toast.success("Nota fiscal anexada.");await qc.invalidateQueries({queryKey:["sale-documents"]});setNewOpen(false);}catch(e){toast.error(e instanceof Error?e.message:"Não foi possível anexar.");}finally{setBusy(false);}}
  async function openFile(id:string,download:boolean){try{const signed=await url({data:{storeId:store.id,id,download}});window.open(signed,"_blank","noopener");}catch{toast.error("Não foi possível abrir o anexo.");}}
  return <section className="space-y-4 print:hidden"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Recibos e notas fiscais</h2><Button onClick={()=>{setPick(saleId??"");setType(saleId?"invoice":"receipt");setNewOpen(true);}}><Upload className="mr-1 h-4 w-4"/>{saleId?"Anexar nota fiscal":"Novo documento"}</Button></div>{error?<p role="alert" className="text-destructive">Não foi possível carregar os documentos.</p>:isLoading?<p>Carregando documentos…</p>:!data?.length?<p className="text-sm text-muted-foreground">Nenhuma venda registrada.</p>:data.map(row=><div key={row.id} className="space-y-2 border-b pb-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">Recibo de venda nº {String(row.receipt.number??0).padStart(6,"0")}</p>{row.hasReceipt?<Button size="sm" variant="outline" onClick={()=>setSelected(row.receipt)}>Visualizar recibo</Button>:<p className="text-xs text-muted-foreground">Recibo não disponível</p>}</div><p className="text-xs text-muted-foreground">{row.invoices.length?"Nota fiscal anexada":"Nota fiscal não anexada"}</p>{row.invoices.map(file=><div key={file.id} className="flex flex-wrap items-center gap-2"><span className="min-w-0 break-all text-sm">{file.filename}</span><Button size="sm" variant="ghost" onClick={()=>openFile(file.id,false)}>Consultar</Button><Button size="sm" variant="outline" onClick={()=>openFile(file.id,true)}>Baixar {file.kind.toUpperCase()}</Button></div>)}</div>)}
    <Dialog open={!!selected} onOpenChange={v=>{if(!v)setSelected(null);}}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Recibo de venda — sem valor fiscal</DialogTitle></DialogHeader>{selected && <ReceiptView receipt={selected}/>}</DialogContent></Dialog>
    <Dialog open={newOpen} onOpenChange={setNewOpen}><DialogContent><DialogHeader><DialogTitle>Novo documento</DialogTitle></DialogHeader><Select value={type} onValueChange={setType}><SelectTrigger aria-label="Tipo de documento"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="receipt">Recibo de venda</SelectItem><SelectItem value="invoice">Anexar nota fiscal</SelectItem></SelectContent></Select><Select value={pick} onValueChange={setPick}><SelectTrigger aria-label="Venda vinculada"><SelectValue placeholder="Selecionar venda"/></SelectTrigger><SelectContent>{data?.map(row=><SelectItem key={row.id} value={row.id}>Venda nº {row.receipt.number}</SelectItem>)}</SelectContent></Select>{type==="receipt"?<Button disabled={!pick} onClick={()=>{const row=data?.find(r=>r.id===pick);if(row?.hasReceipt){setSelected(row.receipt);setNewOpen(false);}else toast.error("Esta venda não possui recibo preservado.");}}>Abrir recibo existente</Button>:<><p className="text-xs text-muted-foreground">XML e PDF emitidos pelo sistema fiscal da loja. A emissão oficial permanece naquele sistema.</p><Input type="file" accept=".pdf,.xml,application/pdf,application/xml,text/xml" multiple aria-label="Arquivos da nota fiscal" disabled={busy||!pick} onChange={e=>void upload(e.target.files)}/></>}</DialogContent></Dialog>
  </section>;
}