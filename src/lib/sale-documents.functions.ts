import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ReceiptData, ReceiptSnapshot } from "./sale-receipt";
import { toCents, centsToDecimal } from "./money";

export const saleDocuments = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(z.object({storeId:z.string().uuid(),saleId:z.string().uuid().optional()})).handler(async({data,context})=>{
  const db=context.supabase;
  const permission=await db.rpc("has_store_permission",{_store_id:data.storeId,_perm:"view_contracts"});
  if(permission.error || !permission.data) throw new Error("Sem permissão para consultar documentos.");
  let query=db.from("sales").select("id,receipt_number,created_at,status,receipt_snapshot,total,amount_received,balance,discount,items_total").eq("store_id",data.storeId).order("created_at",{ascending:false}).order("id");
  if(data.saleId) query=query.eq("id",data.saleId);
  const sales=[];
  for(let offset=0;;offset+=500){const result=await query.range(offset,offset+499);if(result.error)throw result.error;sales.push(...(result.data ?? []));if((result.data?.length ?? 0)<500)break;}
  if(data.saleId && !sales.length) throw new Error("Venda não encontrada nesta loja.");
  const invoices=await db.from("sale_invoice_files").select("id,sale_id,filename,kind,created_at").eq("store_id",data.storeId).order("created_at");
  if(invoices.error)throw invoices.error;
  const rows=[];
  for(const sale of sales){
    const events=await db.from("sale_events").select("detail").eq("store_id",data.storeId).eq("sale_id",sale.id).eq("event","concluida").order("created_at").limit(1);
    if(events.error) throw events.error;
    const event=(events.data?.[0]?.detail ?? {}) as Record<string,unknown>;
    const snapshot=(sale.receipt_snapshot ?? {}) as ReceiptSnapshot;
    // Legacy snapshots store items/payments but original totals live in the completion event.
    const sum=(snapshot.payments ?? []).reduce((acc,p)=>acc+(p.method==="crediario"?0:toCents(p.amount)),0);
    const received=typeof event['received']==="number"?event['received']:Number(centsToDecimal(sum));
    const balance=typeof event['balance']==="number"?event['balance']:Math.max(0,sale.total-Number(snapshot.trade_in?.agreed_value ?? 0)-received);
    const receipt:ReceiptData={number:sale.receipt_number,date:sale.created_at,status:sale.status,snapshot,original:{total:sale.total,received,balance,discount:sale.discount,subtotal:sale.items_total}};
    rows.push({id:sale.id,hasReceipt:!!sale.receipt_snapshot && sale.receipt_number!=null,receipt,invoices:(invoices.data ?? []).filter(i=>i.sale_id===sale.id)});
  }
  return rows;
});

export const attachInvoice = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(z.object({storeId:z.string().uuid(),saleId:z.string().uuid(),path:z.string(),filename:z.string().min(1).max(255),kind:z.enum(["pdf","xml"])})).handler(async({data,context})=>{
  const db=context.supabase;
  const permission=await db.rpc("has_store_permission",{_store_id:data.storeId,_perm:"view_contracts"});
  if(permission.error || !permission.data) throw new Error("Sem permissão para anexar documentos.");
  const sale=await db.from("sales").select("id").eq("id",data.saleId).eq("store_id",data.storeId).maybeSingle();
  if(sale.error || !sale.data) throw new Error("Venda não encontrada nesta loja.");
  const prefix=`${data.storeId}/invoices/${data.saleId}/`;
  if(!data.path.startsWith(prefix)||data.path.slice(prefix.length).includes("/")||!data.path.endsWith(`.${data.kind}`))throw new Error("Arquivo não pertence à venda.");
  const files=await db.storage.from("store-files").list(prefix.slice(0,-1),{search:data.path.slice(prefix.length)});
  const file=files.data?.find(f=>f.name===data.path.slice(prefix.length));
  if(files.error || !file || Number(file.metadata?.['size'] ?? 0)>10*1024*1024) throw new Error("Arquivo inválido ou não enviado.");
  const saved=await db.from("sale_invoice_files").insert({store_id:data.storeId,sale_id:data.saleId,path:data.path,filename:data.filename,kind:data.kind,created_by:context.userId});
  if(saved.error) throw saved.error;
  return {ok:true};
});

export const invoiceUrl = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(z.object({storeId:z.string().uuid(),id:z.string().uuid(),download:z.boolean()})).handler(async({data,context})=>{
  const file=await context.supabase.from("sale_invoice_files").select("path,filename").eq("store_id",data.storeId).eq("id",data.id).single();
  if(file.error || !file.data) throw new Error("Sem acesso ao anexo.");
  const signed=await context.supabase.storage.from("store-files").createSignedUrl(file.data.path,300,data.download?{download:file.data.filename}:{});
  if(signed.error)throw signed.error;
  return signed.data.signedUrl;
});