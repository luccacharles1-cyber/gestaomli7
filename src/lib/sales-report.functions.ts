import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { reportRange, salesReport } from "./sales-report";

export const getSalesReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ storeId:z.string().uuid().optional(), period:z.string(), from:z.string(), to:z.string(), seller:z.string(), model:z.string() }))
  .handler(async ({data,context}) => {
    const db = context.supabase;
    const membership = await db.from("store_members").select("store_id, email").eq("user_id",context.userId).order("created_at");
    if (membership.error) throw membership.error;
    const storeId = data.storeId ?? membership.data?.[0]?.store_id;
    if (!storeId || !membership.data?.some(m=>m.store_id===storeId)) throw new Error("Sem acesso à loja.");
    const member = await db.rpc("is_store_member",{_store_id:storeId});
    if (member.error || !member.data) throw new Error("Sem acesso à loja.");
    const [costPermission,financePermission] = await Promise.all([db.rpc("has_store_permission",{_store_id:storeId,_perm:"view_costs"}),db.rpc("has_store_permission",{_store_id:storeId,_perm:"view_finance"})]);
    if (costPermission.error || financePermission.error) throw new Error("Não foi possível verificar permissões.");
    const canCosts = costPermission.data === true, canFinance = financePermission.data === true;
    const range = reportRange(data.period,data.from,data.to);
    async function readAll<T>(read:(offset:number)=>PromiseLike<{data:T[] | null;error:unknown}>) {
      const result:T[]=[];
      for (let offset=0;;offset+=500) { const page=await read(offset); if(page.error) throw page.error; result.push(...(page.data ?? [])); if((page.data?.length ?? 0)<500) break; }
      return result;
    }
    const sales = await readAll(offset=>db.from("sales").select("id, created_at, receipt_number, seller_id, status, total, trade_in_value, amount_received, balance").eq("store_id",storeId).gte("created_at",range.gte).lte("created_at",range.lte).order("created_at",{ascending:false}).order("id").range(offset,offset+499));
    const ids = sales.map(s=>s.id);
    const items: Array<{sale_id:string;device_id:string;model:string;storage:string|null;cost:number|null;quantity?:number;unitPrice?:number;subtotal?:number}>=[];
    const entries: Array<{sale_id:string|null;contract_id:string|null;method:string|null;kind:string;status:string;paid_amount:number;is_refund:boolean;reversal_of:string|null}>=[];
    const payments: Array<{sale_id:string;method:string;amount:number}>=[];
    for(let start=0;start<ids.length;start+=100) {
      const batch=ids.slice(start,start+100);
      const sold = await readAll(offset=>db.from("sale_items").select("sale_id, device_id, devices(model, storage)").eq("store_id",storeId).in("sale_id",batch).order("id").range(offset,offset+499));
      const costs = canCosts && sold.length ? await readAll(offset=>db.from("device_costs").select("device_id,total_cost").eq("store_id",storeId).in("device_id",sold.map(i=>i.device_id)).order("device_id").range(offset,offset+499)) : [];
      const costMap=new Map(costs.map(c=>[c.device_id,c.total_cost]));
      items.push(...sold.map(i=>({sale_id:i.sale_id,device_id:i.device_id,model:i.devices?.model ?? "Aparelho não identificado",storage:i.devices?.storage ?? null,cost:canCosts ? costMap.get(i.device_id) ?? null : null})));
      const products = await readAll(offset=>db.from("sale_product_items").select("id,sale_id,accessory_id,name,quantity,unit_price,subtotal").eq("store_id",storeId).in("sale_id",batch).order("id").range(offset,offset+499));
      const productCosts = canCosts && products.length ? await readAll(offset=>db.from("sale_product_costs").select("sale_product_item_id,unit_cost").eq("store_id",storeId).in("sale_product_item_id",products.map(p=>p.id)).order("sale_product_item_id").range(offset,offset+499)) : [];
      const productCostMap = new Map(productCosts.map(p=>[p.sale_product_item_id,p.unit_cost]));
      items.push(...products.map(p=>({sale_id:p.sale_id,device_id:p.accessory_id,model:p.name,storage:null,quantity:p.quantity,unitPrice:p.unit_price,subtotal:p.subtotal ?? p.quantity * p.unit_price,cost:canCosts ? productCostMap.get(p.id) ?? null : null})));
      if(canFinance) {
        entries.push(...await readAll(offset=>db.from("financial_entries").select("sale_id, contract_id, method, kind, status, paid_amount, is_refund, reversal_of").eq("store_id",storeId).in("sale_id",batch).order("id").range(offset,offset+499)));
        payments.push(...await readAll(offset=>db.from("sale_payments").select("sale_id,method,amount").eq("store_id",storeId).in("sale_id",batch).order("id").range(offset,offset+499)));
      }
    }
    const team = await db.from("store_members").select("user_id,email").eq("store_id",storeId).order("created_at");
    if(team.error) throw team.error;
    // Sales reads already allow store members; do not invent an unrelated edit permission.
    return { ...salesReport(sales,items,entries,payments,canCosts,canFinance,data.seller,data.model), storeId, range, canCosts, canFinance, models:[...new Set(items.map(i=>i.model))].sort(), team:team.data ?? [] };
  });