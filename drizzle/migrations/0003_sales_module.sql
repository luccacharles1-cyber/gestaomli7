
ALTER TYPE public.device_status ADD VALUE IF NOT EXISTS 'devolvido_cliente';

ALTER TABLE public.store_members ADD COLUMN can_register_sales boolean NOT NULL DEFAULT true;
ALTER TABLE public.store_members ADD COLUMN can_cancel_sales boolean NOT NULL DEFAULT false;
ALTER TABLE public.store_invites ADD COLUMN can_register_sales boolean NOT NULL DEFAULT true;
ALTER TABLE public.store_invites ADD COLUMN can_cancel_sales boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.has_store_permission(_store_id uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members m
    WHERE m.store_id = _store_id AND m.user_id = auth.uid()
      AND (m.role = 'owner' OR CASE _perm
        WHEN 'view_costs' THEN m.can_view_costs
        WHEN 'view_finance' THEN m.can_view_finance
        WHEN 'give_discounts' THEN m.can_give_discounts
        WHEN 'approve_evaluations' THEN m.can_approve_evaluations
        WHEN 'manage_inventory' THEN m.can_manage_inventory
        WHEN 'manage_team' THEN m.can_manage_team
        WHEN 'register_sales' THEN m.can_register_sales
        WHEN 'cancel_sales' THEN m.can_cancel_sales
        ELSE false END)
  )
$$;

CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  name text NOT NULL,
  whatsapp text,
  email text,
  document text,
  address text,
  origin text,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read clients" ON public.clients FOR SELECT TO authenticated USING (public.is_store_member(store_id));
CREATE POLICY "members write clients" ON public.clients FOR INSERT TO authenticated WITH CHECK (public.is_store_member(store_id));
CREATE POLICY "members update clients" ON public.clients FOR UPDATE TO authenticated USING (public.is_store_member(store_id)) WITH CHECK (public.is_store_member(store_id));

CREATE TYPE public.sale_status AS ENUM ('concluida', 'cancelada');
CREATE TYPE public.payment_method AS ENUM ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'crediario', 'outro');

CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  client_id uuid REFERENCES public.clients(id),
  seller_id uuid,
  status public.sale_status NOT NULL DEFAULT 'concluida',
  items_total numeric(12,2) NOT NULL,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  trade_in_value numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL,
  amount_received numeric(12,2) NOT NULL DEFAULT 0,
  balance numeric(12,2) NOT NULL DEFAULT 0,
  receipt_number integer,
  notes text,
  client_token text,
  receipt_snapshot jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  UNIQUE (store_id, client_token)
);
GRANT SELECT ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read sales" ON public.sales FOR SELECT TO authenticated USING (public.is_store_member(store_id));

CREATE TABLE public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  device_id uuid NOT NULL REFERENCES public.devices(id),
  price numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sale_items TO authenticated;
GRANT ALL ON public.sale_items TO service_role;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read sale items" ON public.sale_items FOR SELECT TO authenticated USING (public.is_store_member(store_id));

CREATE TABLE public.sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  method public.payment_method NOT NULL,
  amount numeric(12,2) NOT NULL,
  installments integer,
  fee numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sale_payments TO authenticated;
GRANT ALL ON public.sale_payments TO service_role;
ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read sale payments" ON public.sale_payments FOR SELECT TO authenticated USING (public.is_store_member(store_id));

CREATE TABLE public.sale_trade_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  device_id uuid NOT NULL REFERENCES public.devices(id),
  agreed_value numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sale_trade_ins TO authenticated;
GRANT ALL ON public.sale_trade_ins TO service_role;
ALTER TABLE public.sale_trade_ins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read trade ins" ON public.sale_trade_ins FOR SELECT TO authenticated USING (public.is_store_member(store_id));

CREATE TABLE public.sale_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  actor uuid DEFAULT auth.uid(),
  event text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sale_events TO authenticated;
GRANT ALL ON public.sale_events TO service_role;
ALTER TABLE public.sale_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read sale events" ON public.sale_events FOR SELECT TO authenticated USING (public.is_store_member(store_id));

CREATE OR REPLACE FUNCTION public.complete_sale(
  _store_id uuid,
  _client_id uuid,
  _items jsonb,
  _discount numeric,
  _payments jsonb,
  _trade_in jsonb,
  _notes text,
  _client_token text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  _trade_device_id uuid;
  _receipt int;
  _can_discount boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.has_store_permission(_store_id, 'register_sales') THEN RAISE EXCEPTION 'Sem permissão para registrar vendas.'; END IF;

  IF _client_token IS NOT NULL THEN
    SELECT id INTO _sale_id FROM public.sales WHERE store_id = _store_id AND client_token = _client_token;
    IF FOUND THEN RETURN _sale_id; END IF;
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'A venda precisa de ao menos um aparelho.'; END IF;
  _discount := COALESCE(_discount, 0);
  IF _discount < 0 THEN RAISE EXCEPTION 'Desconto inválido.'; END IF;

  _can_discount := public.has_store_permission(_store_id, 'give_discounts');
  IF _discount > 0 AND NOT _can_discount THEN RAISE EXCEPTION 'Sem permissão para conceder desconto.'; END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO _dev FROM public.devices WHERE id = (_item->>'device_id')::uuid AND store_id = _store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Aparelho não encontrado nesta loja.'; END IF;
    IF _dev.status NOT IN ('disponivel','reservado') THEN RAISE EXCEPTION 'O aparelho % não está disponível (status atual: %).', _dev.model, _dev.status; END IF;
    IF (_item->>'price')::numeric < 0 THEN RAISE EXCEPTION 'Preço inválido.'; END IF;
    IF _dev.min_price IS NOT NULL AND (_item->>'price')::numeric < _dev.min_price AND NOT _can_discount THEN
      RAISE EXCEPTION 'Preço abaixo do mínimo autorizado para % sem permissão de desconto.', _dev.model;
    END IF;
    _items_total := _items_total + (_item->>'price')::numeric(12,2);
  END LOOP;

  FOR _pay IN SELECT * FROM jsonb_array_elements(COALESCE(_payments, '[]'::jsonb)) LOOP
    IF (_pay->>'amount')::numeric <= 0 THEN RAISE EXCEPTION 'Pagamento com valor inválido.'; END IF;
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
  VALUES (_store_id, _client_id, auth.uid(), 'concluida', _items_total, _discount, _trade_val, _total, _received, _balance, _receipt, _notes, _client_token)
  RETURNING id INTO _sale_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    INSERT INTO public.sale_items (sale_id, store_id, device_id, price)
    VALUES (_sale_id, _store_id, (_item->>'device_id')::uuid, (_item->>'price')::numeric(12,2));
    UPDATE public.devices SET status = 'vendido', sale_price = (_item->>'price')::numeric(12,2) WHERE id = (_item->>'device_id')::uuid;
  END LOOP;

  FOR _pay IN SELECT * FROM jsonb_array_elements(COALESCE(_payments, '[]'::jsonb)) LOOP
    INSERT INTO public.sale_payments (sale_id, store_id, method, amount, installments, fee)
    VALUES (_sale_id, _store_id, (_pay->>'method')::public.payment_method, (_pay->>'amount')::numeric(12,2),
            NULLIF(_pay->>'installments','')::int, COALESCE((_pay->>'fee')::numeric, 0));
  END LOOP;

  IF _trade_in IS NOT NULL THEN
    INSERT INTO public.devices (store_id, category, brand, model, storage, color, imei1, imei2, serial_number, condition, conservation, battery_health, defects, notes, origin_name, acquired_at, status)
    VALUES (_store_id, COALESCE(NULLIF(_trade_in->>'category',''),'iPhone'), COALESCE(NULLIF(_trade_in->>'brand',''),'Apple'),
            trim(_trade_in->>'model'), NULLIF(_trade_in->>'storage',''), NULLIF(_trade_in->>'color',''),
            NULLIF(_trade_in->>'imei1',''), NULLIF(_trade_in->>'imei2',''), NULLIF(_trade_in->>'serial_number',''),
            COALESCE(NULLIF(_trade_in->>'condition',''),'seminovo')::public.device_condition, NULLIF(_trade_in->>'conservation',''),
            NULLIF(_trade_in->>'battery_health','')::int, NULLIF(_trade_in->>'defects',''), NULLIF(_trade_in->>'notes',''),
            (SELECT 'Troca - ' || name FROM public.clients WHERE id = _client_id), CURRENT_DATE, 'em_conferencia')
    RETURNING id INTO _trade_device_id;
    INSERT INTO public.device_costs (device_id, store_id, purchase_cost) VALUES (_trade_device_id, _store_id, _trade_val);
    INSERT INTO public.sale_trade_ins (sale_id, store_id, device_id, agreed_value) VALUES (_sale_id, _store_id, _trade_device_id, _trade_val);
  END IF;

  UPDATE public.sales s SET receipt_snapshot = jsonb_build_object(
    'store', (SELECT jsonb_build_object('name', st.name, 'legal_name', st.legal_name, 'document', st.document, 'phone', st.phone, 'email', st.email, 'address', st.address, 'warranty_text', st.warranty_text) FROM public.stores st WHERE st.id = _store_id),
    'client', (SELECT jsonb_build_object('name', c.name, 'document', c.document, 'whatsapp', c.whatsapp, 'email', c.email, 'address', c.address) FROM public.clients c WHERE c.id = _client_id),
    'items', (SELECT jsonb_agg(jsonb_build_object('model', d.model, 'storage', d.storage, 'color', d.color, 'imei1', d.imei1, 'imei2', d.imei2, 'serial_number', d.serial_number, 'condition', d.condition, 'price', si.price)) FROM public.sale_items si JOIN public.devices d ON d.id = si.device_id WHERE si.sale_id = _sale_id),
    'trade_in', CASE WHEN _trade_device_id IS NOT NULL THEN (SELECT jsonb_build_object('model', d.model, 'storage', d.storage, 'color', d.color, 'imei1', d.imei1, 'imei2', d.imei2, 'condition', d.condition, 'agreed_value', _trade_val) FROM public.devices d WHERE d.id = _trade_device_id) END,
    'payments', (SELECT jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amount, 'installments', p.installments)) FROM public.sale_payments p WHERE p.sale_id = _sale_id)
  ) WHERE s.id = _sale_id;

  INSERT INTO public.sale_events (sale_id, store_id, event, detail)
  VALUES (_sale_id, _store_id, 'concluida', jsonb_build_object('total', _total, 'received', _received, 'trade_in', _trade_val, 'balance', _balance));

  RETURN _sale_id;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_sale(_sale_id uuid, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sale public.sales%ROWTYPE;
  _item RECORD;
  _trade RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF NOT public.has_store_permission(_sale.store_id, 'cancel_sales') THEN RAISE EXCEPTION 'Sem permissão para cancelar vendas.'; END IF;
  IF _sale.status = 'cancelada' THEN RAISE EXCEPTION 'Esta venda já está cancelada.'; END IF;

  UPDATE public.sales SET status = 'cancelada', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = NULLIF(trim(_reason),'') WHERE id = _sale_id;

  FOR _item IN SELECT * FROM public.sale_items WHERE sale_id = _sale_id LOOP
    UPDATE public.devices SET status = 'disponivel' WHERE id = _item.device_id AND status = 'vendido';
  END LOOP;

  FOR _trade IN SELECT * FROM public.sale_trade_ins WHERE sale_id = _sale_id LOOP
    UPDATE public.devices SET status = 'devolvido_cliente' WHERE id = _trade.device_id;
  END LOOP;

  INSERT INTO public.sale_events (sale_id, store_id, event, detail)
  VALUES (_sale_id, _sale.store_id, 'cancelada', jsonb_build_object('reason', NULLIF(trim(_reason),'')));
END $$;
