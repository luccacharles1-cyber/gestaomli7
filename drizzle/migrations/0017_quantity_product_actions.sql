ALTER TABLE public.accessories ADD COLUMN category text, ADD COLUMN description text, ADD COLUMN archived boolean NOT NULL DEFAULT false;
CREATE TABLE public.accessory_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES public.stores(id), accessory_id uuid NOT NULL REFERENCES public.accessories(id), actor uuid, created_at timestamptz NOT NULL DEFAULT now(), previous_quantity integer NOT NULL, new_quantity integer NOT NULL, delta integer GENERATED ALWAYS AS (new_quantity-previous_quantity) STORED, reason text NOT NULL, sale_id uuid REFERENCES public.sales(id), CHECK(previous_quantity>=0 AND new_quantity>=0)
);
GRANT SELECT ON public.accessory_movements TO authenticated;
GRANT ALL ON public.accessory_movements TO service_role;
ALTER TABLE public.accessory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY movements_read ON public.accessory_movements FOR SELECT TO authenticated USING(public.is_store_member(store_id));
CREATE INDEX accessory_movements_product ON public.accessory_movements(accessory_id,created_at);
CREATE TABLE public.sale_product_costs (sale_product_item_id uuid PRIMARY KEY REFERENCES public.sale_product_items(id), store_id uuid NOT NULL REFERENCES public.stores(id), unit_cost numeric(12,2));
GRANT SELECT ON public.sale_product_costs TO authenticated;
GRANT ALL ON public.sale_product_costs TO service_role;
ALTER TABLE public.sale_product_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_snapshot_cost_read ON public.sale_product_costs FOR SELECT TO authenticated USING(public.has_store_permission(store_id,'view_costs'));
INSERT INTO public.sale_product_costs(sale_product_item_id,store_id,unit_cost) SELECT p.id,p.store_id,c.unit_cost FROM public.sale_product_items p LEFT JOIN public.accessory_costs c ON c.accessory_id=p.accessory_id AND c.store_id=p.store_id;
COMMENT ON TABLE public.sale_product_costs IS 'Immutable product cost at sale completion. Legacy rows backfilled from cost available at migration time; original historical costs were not recorded.';
CREATE FUNCTION public.capture_product_sale_cost() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN INSERT INTO public.sale_product_costs(sale_product_item_id,store_id,unit_cost) SELECT NEW.id,NEW.store_id,(SELECT unit_cost FROM public.accessory_costs WHERE accessory_id=NEW.accessory_id AND store_id=NEW.store_id); RETURN NEW; END $$;
CREATE TRIGGER product_sale_cost_snapshot AFTER INSERT ON public.sale_product_items FOR EACH ROW EXECUTE FUNCTION public.capture_product_sale_cost();
CREATE FUNCTION public.log_accessory_quantity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old_qty integer; BEGIN
 old_qty:=CASE WHEN TG_OP='INSERT' THEN 0 ELSE OLD.quantity END;
 IF NEW.quantity<0 THEN RAISE EXCEPTION 'Saldo não pode ser negativo.'; END IF;
 IF NEW.archived AND NEW.quantity<>0 THEN RAISE EXCEPTION 'Resolva o saldo de % unidades antes de arquivar.',NEW.quantity; END IF;
 IF old_qty<>NEW.quantity THEN INSERT INTO public.accessory_movements(store_id,accessory_id,actor,previous_quantity,new_quantity,reason,sale_id) VALUES(NEW.store_id,NEW.id,auth.uid(),old_qty,NEW.quantity,coalesce(nullif(current_setting('product.reason',true),''),'Cadastro inicial'),nullif(current_setting('product.sale_id',true),'')::uuid); END IF;
 RETURN NEW; END $$;
CREATE TRIGGER accessory_quantity_history AFTER INSERT OR UPDATE ON public.accessories FOR EACH ROW EXECUTE FUNCTION public.log_accessory_quantity();
REVOKE UPDATE, DELETE ON public.accessories FROM authenticated;
CREATE FUNCTION public.manage_accessory(_store_id uuid,_id uuid,_action text,_values jsonb DEFAULT '{}'::jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.accessories%ROWTYPE; q integer; c numeric(12,2); v numeric(12,2); BEGIN
 IF auth.uid() IS NULL OR NOT public.has_store_permission(_store_id,'manage_inventory') THEN RAISE EXCEPTION 'Sem permissão para alterar o estoque desta loja.'; END IF;
 PERFORM 1 FROM public.stores WHERE id=_store_id FOR UPDATE;
 SELECT * INTO p FROM public.accessories WHERE id=_id AND store_id=_store_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado nesta loja.'; END IF;
 IF _action='edit' THEN
 IF nullif(trim(_values->>'name'),'') IS NULL THEN RAISE EXCEPTION 'Informe o nome.'; END IF;
 v:=nullif(_values->>'sale_price','')::numeric(12,2);
 IF v<0 THEN RAISE EXCEPTION 'Preço inválido.'; END IF;
 IF _values ? 'unit_cost' THEN
 IF NOT public.has_store_permission(_store_id,'view_costs') THEN RAISE EXCEPTION 'Sem permissão para alterar custos.'; END IF;
 c:=nullif(_values->>'unit_cost','')::numeric(12,2);
 IF c IS NULL OR c<0 THEN RAISE EXCEPTION 'Custo inválido.'; END IF;
 INSERT INTO public.accessory_costs(accessory_id,store_id,unit_cost) VALUES(_id,_store_id,c) ON CONFLICT(accessory_id) DO UPDATE SET unit_cost=EXCLUDED.unit_cost;
 END IF;
 UPDATE public.accessories SET name=trim(_values->>'name'),category=nullif(trim(_values->>'category'),''),description=nullif(trim(_values->>'description'),''),sale_price=v WHERE id=_id;
 RETURN 'Produto atualizado.';
 ELSIF _action='adjust' THEN
 IF p.archived THEN RAISE EXCEPTION 'Reative o produto antes de ajustar o saldo.'; END IF;
 IF coalesce(_values->>'quantity','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Informe um saldo inteiro não negativo.'; END IF;
 q:=(_values->>'quantity')::integer;
 IF nullif(trim(_values->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo do ajuste.'; END IF;
 IF (_values->>'previous_quantity')::integer IS DISTINCT FROM p.quantity THEN RAISE EXCEPTION 'O saldo mudou. Atualize a lista antes de ajustar.'; END IF;
 PERFORM set_config('product.reason',trim(_values->>'reason'),true); PERFORM set_config('product.sale_id','',true);
 UPDATE public.accessories SET quantity=q WHERE id=_id;
 PERFORM set_config('product.reason','',true);
 RETURN 'Quantidade ajustada.';
 ELSIF _action IN ('delete','archive') THEN
 IF p.quantity<>0 THEN RAISE EXCEPTION 'Resolva o saldo de % unidades antes de excluir ou arquivar.',p.quantity; END IF;
 IF _action='delete' THEN
 IF EXISTS(SELECT 1 FROM public.sale_product_items WHERE accessory_id=_id) OR EXISTS(SELECT 1 FROM public.accessory_movements WHERE accessory_id=_id) THEN RAISE EXCEPTION 'Produto com histórico. Use Arquivar.'; END IF;
 DELETE FROM public.accessory_costs WHERE accessory_id=_id AND store_id=_store_id;
 DELETE FROM public.accessories WHERE id=_id AND store_id=_store_id; RETURN 'Produto excluído.';
 END IF;
 UPDATE public.accessories SET archived=true WHERE id=_id; RETURN 'Produto arquivado.';
 ELSIF _action='reactivate' THEN UPDATE public.accessories SET archived=false WHERE id=_id; RETURN 'Produto reativado.';
 ELSE RAISE EXCEPTION 'Ação inválida.'; END IF;
 END $$;
REVOKE ALL ON FUNCTION public.manage_accessory(uuid,uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_accessory(uuid,uuid,text,jsonb) TO authenticated;
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public.complete_sale(uuid,uuid,jsonb,numeric,jsonb,jsonb,text,text)'::regprocedure) INTO d;
 IF position('IF coalesce(_item' IN d)=0 OR position('UPDATE public.accessories SET quantity = quantity -' IN d)=0 THEN RAISE EXCEPTION 'Unexpected complete_sale definition'; END IF;
 d:=replace(d,'IF coalesce(_item','IF _product.archived THEN RAISE EXCEPTION ''Produto arquivado não pode ser vendido.''; END IF; IF coalesce(_item');
 d:=replace(d,'UPDATE public.accessories SET quantity = quantity -','PERFORM set_config(''product.reason'',''Venda'',true); PERFORM set_config(''product.sale_id'',_sale_id::text,true); UPDATE public.accessories SET quantity = quantity -');
 d:=replace(d,'ELSE
   INSERT INTO public.sale_items','PERFORM set_config(''product.reason'','''',true); PERFORM set_config(''product.sale_id'','''',true);
  ELSE
   INSERT INTO public.sale_items');
 EXECUTE d;
 SELECT pg_get_functiondef('public.cancel_sale(uuid,text)'::regprocedure) INTO d;
 d:=replace(d,'UPDATE public.accessories SET quantity = quantity +','PERFORM set_config(''product.reason'',''Cancelamento de venda'',true); PERFORM set_config(''product.sale_id'',_sale_id::text,true); UPDATE public.accessories SET quantity = quantity +');
 d:=replace(d,'FOR _item IN SELECT * FROM public.sale_items','PERFORM set_config(''product.reason'','''',true); PERFORM set_config(''product.sale_id'','''',true);
  FOR _item IN SELECT * FROM public.sale_items');
 EXECUTE d;
END $$;