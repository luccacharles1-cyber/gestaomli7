import {describe,it,expect} from "vitest";
import {receiptLines,type ReceiptData} from "./sale-receipt";
const receipt:ReceiptData={number:23,date:"2026-11-11T15:00:00Z",status:"concluida",snapshot:{store:{name:"Loja"},items:[{model:"iPhone",imei1:"356938035643809",price:4000}],trade_in:{model:"iPhone 11",agreed_value:1500},payments:[{method:"pix",amount:1000}]},original:{total:4000,received:1000,balance:1500,discount:0,subtotal:4000}};
describe("existing sale receipt",()=>{
 it("preserves the existing number",()=>expect(receiptLines(receipt)[1]).toContain("000023"));
 it("keeps the exact pending balance explicit without declaring settlement",()=>{const lines=receiptLines(receipt);expect(lines).toContain("Saldo pendente na emissão: R$ 1.500,00");expect(lines).toContain("Há saldo pendente. Este recibo não declara quitação.");});
 it("keeps the 1500 trade separate from the 1000 received",()=>{const text=receiptLines(receipt).join("\n");expect(text).toContain("Valor atribuído à troca: R$ 1.500,00");expect(text).toContain("Valor recebido na emissão: R$ 1.000,00");});
});