import { describe,expect,it } from "vitest";
import { reportRange,salesReport,type ReportSale,type ReportItem,type ReportEntry } from "./sales-report";
const sale:ReportSale={id:"s",created_at:"2026-11-11T15:00:00Z",receipt_number:1,seller_id:"owner",status:"concluida",total:4000,trade_in_value:0,amount_received:4000,balance:0};
const item:ReportItem={sale_id:"s",device_id:"d",model:"iPhone",storage:"128 GB",cost:2500};
const entry:ReportEntry={sale_id:"s",contract_id:"c",method:"pix",kind:"entrada",status:"pago",paid_amount:500,is_refund:false,reversal_of:null};
describe("sales report",()=>{
 it("includes two R$80 chargers in revenue and quantity",()=>{expect(salesReport([{...sale,total:160,amount_received:160}],[{...item,model:"Carregador",quantity:2,cost:30}],[],[],true,true).summary).toMatchObject({revenue:16000,devices:2,profit:10000});});
 it("counts a cash sale using dashboard revenue and gross profit definitions",()=>{expect(salesReport([sale],[item],[],[],true,true).summary).toEqual({revenue:400000,sales:1,devices:1,ticket:400000,profit:150000,margin:37.5,incomplete:0});});
 it("keeps R$4000 sale, R$1500 trade, R$2500 received and zero pending separate",()=>{expect(salesReport([{...sale,trade_in_value:1500,amount_received:2500}],[item],[],[],true,true).rows[0]).toMatchObject({revenue:400000,tradeIn:150000,received:250000,pending:0});});
 it("updates credit receipts without new revenue or double counting regular receipts",()=>{expect(salesReport([{...sale,amount_received:1000,balance:3000}],[item],[entry,{...entry,contract_id:null,paid_amount:1000}],[],true,true).rows[0]).toMatchObject({revenue:400000,received:150000,pending:250000});});
 it("does not include reversed installment receipts",()=>{expect(salesReport([{...sale,amount_received:1000,balance:3000}],[item],[{...entry,status:"estornado"}],[],true,true).rows[0]).toMatchObject({received:100000,pending:300000});});
 it("removes cancelled sales from revenue, quantity and gross profit",()=>{expect(salesReport([{...sale,status:"cancelada"}],[item],[],[],true,true).summary).toMatchObject({revenue:0,sales:0,devices:0,profit:0});});
 it("flags missing costs on the exact sale",()=>{expect(salesReport([sale],[{...item,cost:null}],[],[],true,true).rows[0]?.missingCosts).toEqual(["iPhone 128 GB"]);});
 it("omits restricted cost and finance results",()=>{expect(salesReport([sale],[item],[entry],[],false,false).rows[0]).toMatchObject({profit:null,received:null,pending:null,missingCosts:[]});});
 it("filters by registered seller and model",()=>{expect(salesReport([sale],[item],[],[],true,true,"seller","iPhone").rows).toEqual([]);expect(salesReport([sale],[item],[],[],true,true,"owner","iPhone").sellers).toEqual([{id:"owner",devices:1,revenue:400000}]);});
 it("keeps cards pending operator settlement out of cash received",()=>{expect(salesReport([sale],[item],[],[{sale_id:"s",method:"cartao_credito",amount:4000}],true,true).rows[0]?.received).toBe(0);});
 it("uses Sao Paulo sale dates across UTC midnight and inclusive seven days",()=>{expect(reportRange("hoje","","",new Date("2026-11-12T01:00:00Z")).from).toBe("2026-11-11");expect(reportRange("7d","","",new Date("2026-11-11T15:00:00Z")).from).toBe("2026-11-05");});
 it("rejects reversed custom dates",()=>{expect(()=>reportRange("custom","2026-11-12","2026-11-01")).toThrow();});
});