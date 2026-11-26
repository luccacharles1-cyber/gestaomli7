import { formatCents } from "./money";
import { whatsappUrl } from "./crm";
export type TradeProposal={used:string;offered:number;desired:string;price:number;available:boolean};
export function tradeDifference(price:number,offered:number){return price-offered;}
export function proposalText(p:TradeProposal){
  const difference=tradeDifference(p.price,p.offered);
  return [`Aparelho do cliente: ${p.used}`,`Valor oferecido: ${formatCents(p.offered)}`,`Aparelho desejado: ${p.desired}`,`Preço da proposta: ${formatCents(p.price)}`,...(!p.available?["Disponibilidade a confirmar"]:[]),difference>=0?`${formatCents(p.price)} − ${formatCents(p.offered)} = ${formatCents(difference)} a pagar pelo cliente`:`Diferença a favor do cliente: ${formatCents(-difference)}`].join("\n");
}
export function proposalWhatsApp(text:string,phone?:string|null){return `${whatsappUrl(phone) ?? "https://wa.me/"}?text=${encodeURIComponent(text)}`;}