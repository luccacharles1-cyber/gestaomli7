import { PAYMENT_LABEL } from "./sales";
import { formatBRL, toCents } from "./money";
import { formatDate } from "./format";

export type ReceiptSnapshot = {
  store?: {name?:string;legal_name?:string;document?:string;phone?:string;email?:string;address?:string;warranty_text?:string};
  client?: {name?:string;document?:string;whatsapp?:string;email?:string;address?:string}|null;
  items?: Array<{model:string;name?:string;quantity?:number;unit_price?:string|number;subtotal?:string|number;storage?:string;color?:string;imei1?:string;imei2?:string;serial_number?:string;price:string|number}>;
  trade_in?: {model:string;storage?:string;imei1?:string;imei2?:string;agreed_value:string|number}|null;
  payments?: Array<{method:keyof typeof PAYMENT_LABEL;amount:string|number;installments?:number|null}>;
};
export type ReceiptData = {number:number|null;date:string;status:string;snapshot:ReceiptSnapshot;original:{total:number;received:number;balance:number;discount:number;subtotal:number}};
export function receiptLines(r:ReceiptData):string[] {
  const s=r.snapshot;
  return ["Recibo de venda — sem valor fiscal",`Nº ${String(r.number ?? 0).padStart(6,"0")} · ${formatDate(r.date)}`,...(r.status==="cancelada"?["VENDA CANCELADA — recibo original preservado"]:[]),s.store?.name ?? "Loja",s.store?.legal_name,s.store?.document?`CNPJ/CPF: ${s.store.document}`:null,s.store?.address,[s.store?.phone,s.store?.email].filter(Boolean).join(" · "),s.client?`Cliente: ${s.client.name ?? ""}`:null,s.client?.document?`CPF/CNPJ: ${s.client.document}`:null,s.client?.address,"Produtos",...(s.items ?? []).flatMap(i=>[`${i.name ?? i.model} ${i.storage ?? ""} ${i.color ?? ""} — ${i.quantity ?? 1} × ${formatBRL(i.unit_price ?? i.price)} · Subtotal: ${formatBRL(i.subtotal ?? i.price)}`,[i.imei1?`IMEI 1: ${i.imei1}`:null,i.imei2?`IMEI 2: ${i.imei2}`:null,i.serial_number?`Série: ${i.serial_number}`:null].filter(Boolean).join(" · ")]),...(s.trade_in?[`Usado na troca: ${s.trade_in.model} ${s.trade_in.storage ?? ""}`,`Valor atribuído à troca: ${formatBRL(s.trade_in.agreed_value)}`,...[s.trade_in.imei1,s.trade_in.imei2].filter(Boolean).map(v=>`IMEI: ${v}`)]:[]),`Subtotal: ${formatBRL(r.original.subtotal)}`,`Desconto: ${formatBRL(r.original.discount)}`,`Total da venda: ${formatBRL(r.original.total)}`,"Formas de pagamento",...(s.payments ?? []).map(p=>`${PAYMENT_LABEL[p.method]}${p.installments?` · ${p.installments}x`:""}: ${formatBRL(p.amount)}`),`Valor recebido na emissão: ${formatBRL(r.original.received)}`,`Saldo pendente na emissão: ${formatBRL(r.original.balance)}`,...(toCents(r.original.balance)>0?["Há saldo pendente. Este recibo não declara quitação."]:["Sem saldo pendente na emissão."]),s.store?.warranty_text,"Este recibo não é nota fiscal. Valores preservados da data de conclusão da venda."].filter((v):v is string=>typeof v==="string" && !!v.trim());
}

export async function receiptPdf(r:ReceiptData) {
  const {jsPDF}=await import("jspdf");
  const pdf=new jsPDF();
  pdf.setProperties({title:"Recibo de venda — sem valor fiscal",subject:`Recibo nº ${r.number}`});
  pdf.setFontSize(11);
  let y=20;
  for(const line of receiptLines(r)) for(const part of pdf.splitTextToSize(line,170) as string[]) {if(y>275){pdf.addPage();y=20;}pdf.text(part,20,y);y+=7;}
  return pdf;
}