CREATE TABLE public.sale_product_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sale_id uuid NOT NULL REFERENCES public.sales(id),
 store_id uuid NOT NULL REFERENCES public.stores(id),
 accessory_id uuid NOT NULL REFERENCES public.accessories(id),
 name text NOT NULL,
 quantity integer NOT NULL CHECK (quantity > 0),
 unit_price numeric(12,2) NOT NULL CHECK (unit_price > 0),
 subtotal numeric(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(sale_id, accessory_id)
);
GRANT SELECT ON public.sale_product_items TO authenticated;
GRANT ALL ON public.sale_product_items TO service_role;
ALTER TABLE public.sale_product_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY sale_products_read ON public.sale_product_items FOR SELECT TO authenticated USING (public.is_store_member(store_id));
CREATE INDEX sale_product_store_sale ON public.sale_product_items(store_id, sale_id);

CREATE OR REPLACE FUNCTION public.complete_sale(_store_id uuid, _client_id uuid, _items jsonb, _discount numeric, _payments jsonb, _trade_in jsonb, _notes text, _client_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
 _sale_id uuid;
 _items_total numeric(12,2) := 0;
 _received numeric(12,2) := 0;
 _trade_val numeric(12,2) := 0;
 _total numeric(12,2);
 _balance numeric(12,2);
 _item jsonb;
 _pay jsonb;
 _dev public.devices%ROWTYPE;
 _product public.accessories%ROWTYPE;
 _quantity integer;
 _price numeric(12,2);
 _trade_device_id uuid;
 _receipt int;
 _can_discount boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
 IF NOT public.has_store_permission(_store_id, 'register_sales') THEN RAISE EXCEPTION 'Sem permissão para registrar vendas.'; END IF;
 -- Serialize receipt numbering and same-token retries before reading stock.
 PERFORM 1 FROM public.stores WHERE id = _store_id FOR UPDATE;
 IF _client_token IS NOT NULL THEN
  SELECT id INTO _sale_id FROM public.sales WHERE store_id = _store_id AND client_token = _client_token;
  IF FOUND THEN RETURN _sale_id; END IF;
 END IF;
 IF _client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = _client_id AND store_id = _store_id) THEN RAISE EXCEPTION 'Cliente não encontrado nesta loja.'; END IF;
 IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN RAISE EXCEPTION 'A venda precisa de ao menos um item válido.'; END IF;
 IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'A venda precisa de ao menos um item válido.'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(_items) i GROUP BY coalesce(i->>'device_id', i->>'accessory_id') HAVING count(*) > 1) THEN RAISE EXCEPTION 'Item repetido na venda. Informe a quantidade na mesma linha.'; END IF;
 _discount := COALESCE(_discount, 0);
 IF _discount < 0 THEN RAISE EXCEPTION 'Desconto inválido.'; END IF;
 _can_discount := public.has_store_permission(_store_id, 'give_discounts');
 IF _discount > 0 AND NOT _can_discount THEN RAISE EXCEPTION 'Sem permissão para conceder desconto.'; END IF;
 FOR _item IN SELECT * FROM jsonb_array_elements(_items) ORDER BY coalesce(value->>'device_id', value->>'accessory_id') LOOP
  IF ((_item->>'device_id') IS NULL) = ((_item->>'accessory_id') IS NULL) THEN RAISE EXCEPTION 'Informe um aparelho ou produto por item.'; END IF;
  _price := (_item->>'price')::numeric(12,2);
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'Preço inválido.'; END IF;
  IF _item->>'accessory_id' IS NOT NULL THEN
   SELECT * INTO _product FROM public.accessories WHERE id = (_item->>'accessory_id')::uuid AND store_id = _store_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado nesta loja.'; END IF;
   IF coalesce(_item->>'quantity','') !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'Quantidade deve ser inteira e maior que zero.'; END IF;
   _quantity := (_item->>'quantity')::integer;
   IF _quantity > _product.quantity THEN RAISE EXCEPTION 'Quantidade acima do saldo disponível para % (saldo: %).', _product.name, _product.quantity; END IF;
   IF _product.sale_price IS NOT NULL AND _price < _product.sale_price AND NOT _can_discount THEN RAISE EXCEPTION 'Sem permissão para reduzir o preço do produto.'; END IF;
   _items_total := _items_total + _price * _quantity;
  ELSE
   IF _item->>'quantity' IS NOT NULL AND _item->>'quantity' <> '1' THEN RAISE EXCEPTION 'Aparelhos são vendidos por unidade.'; END IF;
   SELECT * INTO _dev FROM public.devices WHERE id = (_item->>'device_id')::uuid AND store_id = _store_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Aparelho não encontrado nesta loja.'; END IF;
   IF _dev.status NOT IN ('disponivel','reservado') THEN RAISE EXCEPTION 'O aparelho % não está disponível (status atual: %).', _dev.model, _dev.status; END IF;
   IF _dev.min_price IS NOT NULL AND _price < _dev.min_price AND NOT _can_discount THEN RAISE EXCEPTION 'Preço abaixo do mínimo autorizado para % sem permissão de desconto.', _dev.model; END IF;
   _items_total := _items_total + _price;
  END IF;
 END LOOP;
 FOR _pay IN SELECT * FROM jsonb_array_elements(COALESCE(_payments, '[]'::jsonb)) LOOP
  IF (_pay->>'amount') IS NULL OR (_pay->>'amount')::numeric <= 0 THEN RAISE EXCEPTION 'Pagamento com valor inválido.'; END IF;
  _received := _received + (_pay->>'amount')::numeric(12,2);
 END LOOP;
 IF _trade_in IS NOT NULL THEN
  _trade_val := (_trade_in->>'agreed_value')::numeric(12,2);
  IF _trade_val IS NULL OR _trade_val <= 0 THEN RAISE EXCEPTION 'Valor do usado inválido.'; END IF;
  IF _client_id IS NULL THEN RAISE EXCEPTION 'Venda com usado na troca exige cliente identificado.'; END IF;
  IF _trade_in->>'model' IS NULL OR length(trim(_trade_in->>'model')) = 0 THEN RAISE EXCEPTION 'Informe o modelo do usado.'; END IF;
 END IF;
 _total := _items_total - _discount;
 IF _total < 0 THEN RAISE EXCEPTION 'Desconto maior que o total.'; END IF;
 _balance := _total - _trade_val - _received;
 IF _balance < 0 THEN RAISE EXCEPTION 'Pagamentos e troca excedem o total da venda.'; END IF;
 UPDATE public.stores SET receipt_seq = receipt_seq + 1 WHERE id = _store_id RETURNING receipt_seq INTO _receipt;
 INSERT INTO public.sales (store_id, client_id, seller_id, status, items_total, discount, trade_in_value, total, amount_received, balance, receipt_number, notes, client_token)
 VALUES (_store_id, _client_id, auth.uid(), 'concluida', _items_total, _discount, _trade_val, _total, _received, _balance, _receipt, _notes, _client_token) RETURNING id INTO _sale_id;
 FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
  IF _item->>'accessory_id' IS NOT NULL THEN
   SELECT * INTO _product FROM public.accessories WHERE id = (_item->>'accessory_id')::uuid AND store_id = _store_id;
   INSERT INTO public.sale_product_items(sale_id,store_id,accessory_id,name,quantity,unit_price)
   VALUES(_sale_id,_store_id,_product.id,_product.name,(_item->>'quantity')::integer,(_item->>'price')::numeric(12,2));
   UPDATE public.accessories SET quantity = quantity - (_item->>'quantity')::integer WHERE id = _product.id AND store_id = _store_id;
  ELSE
   INSERT INTO public.sale_items (sale_id, store_id, device_id, price) VALUES (_sale_id, _store_id, (_item->>'device_id')::uuid, (_item->>'price')::numeric(12,2));
   UPDATE public.devices SET status = 'vendido', sale_price = (_item->>'price')::numeric(12,2) WHERE id = (_item->>'device_id')::uuid;
  END IF;
 END LOOP;
 FOR _pay IN SELECT * FROM jsonb_array_elements(COALESCE(_payments, '[]'::jsonb)) LOOP
  INSERT INTO public.sale_payments (sale_id, store_id, method, amount, installments, fee)
  VALUES (_sale_id, _store_id, (_pay->>'method')::public.payment_method, (_pay->>'amount')::numeric(12,2), NULLIF(_pay->>'installments','')::int, COALESCE((_pay->>'fee')::numeric, 0));
 END LOOP;
 IF _trade_in IS NOT NULL THEN
  INSERT INTO public.devices (store_id, category, brand, model, storage, color, imei1, imei2, serial_number, condition, conservation, battery_health, defects, notes, origin_name, acquired_at, status)
  VALUES (_store_id, COALESCE(NULLIF(_trade_in->>'category',''),'iPhone'), COALESCE(NULLIF(_trade_in->>'brand',''),'Apple'), trim(_trade_in->>'model'), NULLIF(_trade_in->>'storage',''), NULLIF(_trade_in->>'color',''), NULLIF(_trade_in->>'imei1',''), NULLIF(_trade_in->>'imei2',''), NULLIF(_trade_in->>'serial_number',''), COALESCE(NULLIF(_trade_in->>'condition',''),'seminovo')::public.device_condition, NULLIF(_trade_in->>'conservation',''), NULLIF(_trade_in->>'battery_health','')::int, NULLIF(_trade_in->>'defects',''), NULLIF(_trade_in->>'notes',''), (SELECT 'Troca - ' || name FROM public.clients WHERE id = _client_id), CURRENT_DATE, 'em_conferencia') RETURNING id INTO _trade_device_id;
  INSERT INTO public.device_costs (device_id, store_id, purchase_cost) VALUES (_trade_device_id, _store_id, _trade_val);
  INSERT INTO public.sale_trade_ins (sale_id, store_id, device_id, agreed_value) VALUES (_sale_id, _store_id, _trade_device_id, _trade_val);
 END IF;
 UPDATE public.sales s SET receipt_snapshot = jsonb_build_object(
  'store', (SELECT jsonb_build_object('name', st.name, 'legal_name', st.legal_name, 'document', st.document, 'phone', st.phone, 'email', st.email, 'address', st.address, 'warranty_text', st.warranty_text) FROM public.stores st WHERE st.id = _store_id),
  'client', (SELECT jsonb_build_object('name', c.name, 'document', c.document, 'whatsapp', c.whatsapp, 'email', c.email, 'address', c.address) FROM public.clients c WHERE c.id = _client_id),
  'items', (SELECT jsonb_agg(row) FROM (
   SELECT jsonb_build_object('model', d.model, 'storage', d.storage, 'color', d.color, 'imei1', d.imei1, 'imei2', d.imei2, 'serial_number', d.serial_number, 'condition', d.condition, 'price', si.price, 'quantity',1,'unit_price',si.price,'subtotal',si.price) AS row FROM public.sale_items si JOIN public.devices d ON d.id = si.device_id WHERE si.sale_id = _sale_id
   UNION ALL SELECT jsonb_build_object('model',p.name,'name',p.name,'quantity',p.quantity,'unit_price',p.unit_price,'subtotal',p.subtotal,'price',p.subtotal,'kind','product') FROM public.sale_product_items p WHERE p.sale_id = _sale_id) rows),
  'trade_in', CASE WHEN _trade_device_id IS NOT NULL THEN (SELECT jsonb_build_object('model', d.model, 'storage', d.storage, 'color', d.color, 'imei1', d.imei1, 'imei2', d.imei2, 'condition', d.condition, 'agreed_value', _trade_val) FROM public.devices d WHERE d.id = _trade_device_id) END,
  'payments', (SELECT jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amount, 'installments', p.installments)) FROM public.sale_payments p WHERE p.sale_id = _sale_id)) WHERE s.id = _sale_id;
 INSERT INTO public.sale_events (sale_id, store_id, event, detail) VALUES (_sale_id, _store_id, 'concluida', jsonb_build_object('total', _total, 'received', _received, 'trade_in', _trade_val, 'balance', _balance));
 RETURN _sale_id;
END $function$;

-- Preserve the existing cancellation/refund/trade-in checks and extend stock restoration.
DO $ddl$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.cancel_sale(uuid,text)'::regprocedure) INTO definition;
 IF position('FOR _item IN SELECT * FROM public.sale_items' IN definition) = 0 THEN RAISE EXCEPTION 'Unexpected cancellation definition'; END IF;
 definition := replace(definition, 'FOR _item IN SELECT * FROM public.sale_items', 'FOR _item IN SELECT * FROM public.sale_product_items WHERE sale_id = _sale_id ORDER BY accessory_id LOOP
    UPDATE public.accessories SET quantity = quantity + _item.quantity WHERE id = _item.accessory_id AND store_id = _sale.store_id;
  END LOOP;
  FOR _item IN SELECT * FROM public.sale_items');
 EXECUTE definition;
END $ddl$;

CREATE OR REPLACE FUNCTION public.notify_sale_owners() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _p jsonb;
BEGIN
 IF NEW.status <> 'concluida' OR NOT EXISTS (SELECT 1 FROM public.sales WHERE id = NEW.id) THEN RETURN NULL; END IF;
 _p := jsonb_build_object('seller',(SELECT email FROM public.store_members WHERE store_id=NEW.store_id AND user_id=NEW.seller_id),'total',NEW.total,'receipt_number',NEW.receipt_number,'sold_at',NEW.created_at,'items',
 (SELECT coalesce(string_agg(label, ', '), '') FROM (
 SELECT trim(d.brand || ' ' || d.model || coalesce(' ' || d.storage,'')) AS label FROM public.sale_items si JOIN public.devices d ON d.id=si.device_id WHERE si.sale_id=NEW.id
 UNION ALL SELECT p.quantity::text || 'x ' || p.name FROM public.sale_product_items p WHERE p.sale_id=NEW.id) items));
 INSERT INTO public.notifications(store_id,user_id,kind,sale_id,payload) SELECT NEW.store_id,m.user_id,'sale_completed',NEW.id,_p FROM public.store_members m WHERE m.store_id=NEW.store_id AND m.role='owner' ON CONFLICT(user_id,kind,sale_id) DO NOTHING;
 RETURN NULL;
END $function$;