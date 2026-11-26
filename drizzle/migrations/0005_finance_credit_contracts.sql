
-- Novas permissões da equipe
ALTER TABLE public.store_members
  ADD COLUMN can_register_payments boolean NOT NULL DEFAULT false,
  ADD COLUMN can_reverse_payments boolean NOT NULL DEFAULT false,
  ADD COLUMN can_approve_credit boolean NOT NULL DEFAULT false,
  ADD COLUMN can_renegotiate boolean NOT NULL DEFAULT false,
  ADD COLUMN can_view_contracts boolean NOT NULL DEFAULT false;

ALTER TABLE public.store_invites
  ADD COLUMN can_register_payments boolean NOT NULL DEFAULT false,
  ADD COLUMN can_reverse_payments boolean NOT NULL DEFAULT false,
  ADD COLUMN can_approve_credit boolean NOT NULL DEFAULT false,
  ADD COLUMN can_renegotiate boolean NOT NULL DEFAULT false,
  ADD COLUMN can_view_contracts boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.has_store_permission(_store_id uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
        WHEN 'register_payments' THEN m.can_register_payments
        WHEN 'reverse_payments' THEN m.can_reverse_payments
        WHEN 'approve_credit' THEN m.can_approve_credit
        WHEN 'renegotiate' THEN m.can_renegotiate
        WHEN 'view_contracts' THEN m.can_view_contracts
        ELSE false END)
  )
$$;

-- Vendas: valor a reembolsar em cancelamento
ALTER TABLE public.sales ADD COLUMN refund_due numeric(12,2) NOT NULL DEFAULT 0;

-- Contas financeiras (caixa, banco, outras)
CREATE TABLE public.financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'caixa',
  initial_balance numeric(12,2) NOT NULL DEFAULT 0,
  initial_balance_date date NOT NULL DEFAULT CURRENT_DATE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.financial_accounts TO authenticated;
GRANT ALL ON public.financial_accounts TO service_role;
ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance viewers read accounts" ON public.financial_accounts FOR SELECT TO authenticated USING (public.has_store_permission(store_id, 'view_finance'));
CREATE POLICY "payment editors write accounts" ON public.financial_accounts FOR INSERT TO authenticated WITH CHECK (public.has_store_permission(store_id, 'register_payments'));
CREATE POLICY "payment editors update accounts" ON public.financial_accounts FOR UPDATE TO authenticated USING (public.has_store_permission(store_id, 'register_payments')) WITH CHECK (public.has_store_permission(store_id, 'register_payments'));

-- Categorias
CREATE TABLE public.financial_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'despesa',
  operational boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.financial_categories TO authenticated;
GRANT ALL ON public.financial_categories TO service_role;
ALTER TABLE public.financial_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance viewers read categories" ON public.financial_categories FOR SELECT TO authenticated USING (public.has_store_permission(store_id, 'view_finance'));
CREATE POLICY "payment editors write categories" ON public.financial_categories FOR INSERT TO authenticated WITH CHECK (public.has_store_permission(store_id, 'register_payments'));
CREATE POLICY "payment editors update categories" ON public.financial_categories FOR UPDATE TO authenticated USING (public.has_store_permission(store_id, 'register_payments')) WITH CHECK (public.has_store_permission(store_id, 'register_payments'));

-- Lançamentos financeiros (entradas, saídas, transferências, aportes, recebíveis)
CREATE TABLE public.financial_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  account_id uuid REFERENCES public.financial_accounts(id),
  category_id uuid REFERENCES public.financial_categories(id),
  kind text NOT NULL,
  amount numeric(12,2) NOT NULL,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  description text NOT NULL,
  method text,
  status text NOT NULL DEFAULT 'pago',
  due_date date,
  competence_date date,
  paid_at date,
  fee numeric(12,2) NOT NULL DEFAULT 0,
  client_id uuid REFERENCES public.clients(id),
  sale_id uuid REFERENCES public.sales(id),
  contract_id uuid,
  transfer_group uuid,
  is_transfer boolean NOT NULL DEFAULT false,
  is_equity boolean NOT NULL DEFAULT false,
  is_refund boolean NOT NULL DEFAULT false,
  reversed_by uuid,
  reversal_of uuid REFERENCES public.financial_entries(id),
  reversal_reason text,
  attachment_path text,
  client_token text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, client_token)
);
GRANT SELECT, INSERT, UPDATE ON public.financial_entries TO authenticated;
GRANT ALL ON public.financial_entries TO service_role;
ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance viewers read entries" ON public.financial_entries FOR SELECT TO authenticated USING (public.has_store_permission(store_id, 'view_finance'));
CREATE POLICY "payment editors write entries" ON public.financial_entries FOR INSERT TO authenticated WITH CHECK (public.has_store_permission(store_id, 'register_payments'));
CREATE POLICY "payment editors update entries" ON public.financial_entries FOR UPDATE TO authenticated USING (public.has_store_permission(store_id, 'register_payments')) WITH CHECK (public.has_store_permission(store_id, 'register_payments'));
CREATE INDEX financial_entries_store_status ON public.financial_entries (store_id, status, due_date);
CREATE INDEX financial_entries_sale ON public.financial_entries (sale_id);

-- Condições de recebimento de cartão por loja
CREATE TABLE public.store_card_settings (
  store_id uuid NOT NULL REFERENCES public.stores(id),
  method text NOT NULL,
  fee_pct numeric(5,2) NOT NULL DEFAULT 0,
  receive_days int NOT NULL DEFAULT 30,
  PRIMARY KEY (store_id, method)
);
GRANT SELECT, INSERT, UPDATE ON public.store_card_settings TO authenticated;
GRANT ALL ON public.store_card_settings TO service_role;
ALTER TABLE public.store_card_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance viewers read card settings" ON public.store_card_settings FOR SELECT TO authenticated USING (public.has_store_permission(store_id, 'view_finance'));
CREATE POLICY "payment editors write card settings" ON public.store_card_settings FOR INSERT TO authenticated WITH CHECK (public.has_store_permission(store_id, 'register_payments'));
CREATE POLICY "payment editors update card settings" ON public.store_card_settings FOR UPDATE TO authenticated USING (public.has_store_permission(store_id, 'register_payments')) WITH CHECK (public.has_store_permission(store_id, 'register_payments'));

-- Crediário próprio
CREATE TABLE public.credit_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  sale_id uuid NOT NULL REFERENCES public.sales(id),
  client_id uuid REFERENCES public.clients(id),
  down_payment numeric(12,2) NOT NULL DEFAULT 0,
  principal numeric(12,2) NOT NULL,
  installments_count int NOT NULL,
  first_due_date date NOT NULL,
  interest_method text NOT NULL DEFAULT 'sem_juros',
  status text NOT NULL DEFAULT 'ativo',
  renegotiated_into uuid,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  approved_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id)
);
GRANT SELECT ON public.credit_contracts TO authenticated;
GRANT ALL ON public.credit_contracts TO service_role;
ALTER TABLE public.credit_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance viewers read contracts" ON public.credit_contracts FOR SELECT TO authenticated USING (public.has_store_permission(store_id, 'view_finance'));

CREATE TABLE public.credit_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  contract_id uuid NOT NULL REFERENCES public.credit_contracts(id),
  number int NOT NULL,
  due_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  principal_amount numeric(12,2) NOT NULL,
  interest_amount numeric(12,2) NOT NULL DEFAULT 0,
  fee_amount numeric(12,2) NOT NULL DEFAULT 0,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  paid_at date,
  status text NOT NULL DEFAULT 'aberto',
  UNIQUE (contract_id, number)
);
GRANT SELECT ON public.credit_installments TO authenticated;
GRANT ALL ON public.credit_installments TO service_role;
ALTER TABLE public.credit_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance viewers read installments" ON public.credit_installments FOR SELECT TO authenticated USING (public.has_store_permission(store_id, 'view_finance'));

ALTER TABLE public.financial_entries
  ADD CONSTRAINT financial_entries_contract_fk FOREIGN KEY (contract_id) REFERENCES public.credit_contracts(id);

-- Contratos e documentos
CREATE TABLE public.contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  type text NOT NULL,
  name text NOT NULL,
  body text NOT NULL,
  version int NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.contract_templates TO authenticated;
GRANT ALL ON public.contract_templates TO service_role;
ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contract viewers read templates" ON public.contract_templates FOR SELECT TO authenticated USING (public.has_store_permission(store_id, 'view_contracts'));
CREATE POLICY "contract viewers write templates" ON public.contract_templates FOR INSERT TO authenticated WITH CHECK (public.has_store_permission(store_id, 'view_contracts'));
CREATE POLICY "contract viewers update templates" ON public.contract_templates FOR UPDATE TO authenticated USING (public.has_store_permission(store_id, 'view_contracts')) WITH CHECK (public.has_store_permission(store_id, 'view_contracts'));

CREATE TABLE public.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  type text NOT NULL,
  template_id uuid REFERENCES public.contract_templates(id),
  template_version int,
  sale_id uuid REFERENCES public.sales(id),
  client_id uuid REFERENCES public.clients(id),
  device_id uuid REFERENCES public.devices(id),
  status text NOT NULL DEFAULT 'modelo_pendente',
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  content text,
  signed_path text,
  signatories jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.contracts TO authenticated;
GRANT ALL ON public.contracts TO service_role;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contract viewers read contracts" ON public.contracts FOR SELECT TO authenticated USING (public.has_store_permission(store_id, 'view_contracts'));
CREATE POLICY "contract viewers write contracts" ON public.contracts FOR INSERT TO authenticated WITH CHECK (public.has_store_permission(store_id, 'view_contracts'));
CREATE POLICY "contract viewers update contracts" ON public.contracts FOR UPDATE TO authenticated USING (public.has_store_permission(store_id, 'view_contracts')) WITH CHECK (public.has_store_permission(store_id, 'view_contracts'));

-- Conta "Caixa" padrão para lojas existentes
INSERT INTO public.financial_accounts (store_id, name, type)
SELECT id, 'Caixa', 'caixa' FROM public.stores;

-- Integração venda → financeiro: cartão vira recebível da operadora; crediário não entra no caixa
CREATE OR REPLACE FUNCTION public.sale_payment_to_finance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_account uuid;
  v_days int;
  v_fee_pct numeric;
  v_net numeric(12,2);
  v_date date;
BEGIN
  IF NEW.method = 'crediario' THEN RETURN NEW; END IF;
  SELECT s.created_at::date INTO v_date FROM public.sales s WHERE s.id = NEW.sale_id;
  IF NEW.method IN ('cartao_credito','cartao_debito') THEN
    SELECT cs.receive_days, cs.fee_pct INTO v_days, v_fee_pct
      FROM public.store_card_settings cs WHERE cs.store_id = NEW.store_id AND cs.method = NEW.method::text;
    v_days := COALESCE(v_days, CASE WHEN NEW.method = 'cartao_debito' THEN 1 ELSE 30 END);
    v_fee_pct := COALESCE(v_fee_pct, 0);
    v_net := round(NEW.amount * (1 - v_fee_pct / 100), 2);
    INSERT INTO public.financial_entries (store_id, account_id, kind, amount, paid_amount, description, method, status, due_date, competence_date, fee, sale_id)
    VALUES (NEW.store_id, NULL, 'entrada', v_net, 0, 'Recebível de operadora — venda', NEW.method::text, 'pendente', v_date + v_days, v_date, NEW.amount - v_net, NEW.sale_id);
  ELSE
    SELECT a.id INTO v_account FROM public.financial_accounts a
      WHERE a.store_id = NEW.store_id AND a.type = 'caixa' AND a.active ORDER BY a.created_at LIMIT 1;
    IF v_account IS NOT NULL THEN
      INSERT INTO public.financial_entries (store_id, account_id, kind, amount, paid_amount, description, method, status, due_date, competence_date, paid_at, sale_id)
      VALUES (NEW.store_id, v_account, 'entrada', NEW.amount, NEW.amount, 'Venda — recebimento', NEW.method::text, 'pago', v_date, v_date, v_date, NEW.sale_id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER sale_payment_to_finance AFTER INSERT ON public.sale_payments
FOR EACH ROW EXECUTE FUNCTION public.sale_payment_to_finance();

-- Migração das vendas existentes: só o que está comprovado em sale_payments
INSERT INTO public.financial_entries (store_id, account_id, kind, amount, paid_amount, description, method, status, due_date, competence_date, paid_at, sale_id)
SELECT p.store_id, a.id, 'entrada', p.amount, p.amount, 'Venda — recebimento', p.method::text, 'pago', s.created_at::date, s.created_at::date, s.created_at::date, p.sale_id
FROM public.sale_payments p
JOIN public.sales s ON s.id = p.sale_id
JOIN public.financial_accounts a ON a.store_id = p.store_id AND a.type = 'caixa' AND a.active
WHERE p.method NOT IN ('crediario','cartao_credito','cartao_debito');

INSERT INTO public.financial_entries (store_id, account_id, kind, amount, paid_amount, description, method, status, due_date, competence_date, fee, sale_id)
SELECT p.store_id, NULL, 'entrada',
  round(p.amount * (1 - COALESCE(cs.fee_pct, 0) / 100), 2), 0,
  'Recebível de operadora — venda', p.method::text, 'pendente',
  s.created_at::date + COALESCE(cs.receive_days, CASE WHEN p.method = 'cartao_debito' THEN 1 ELSE 30 END),
  s.created_at::date,
  p.amount - round(p.amount * (1 - COALESCE(cs.fee_pct, 0) / 100), 2),
  p.sale_id
FROM public.sale_payments p
JOIN public.sales s ON s.id = p.sale_id
LEFT JOIN public.store_card_settings cs ON cs.store_id = p.store_id AND cs.method = p.method::text
WHERE p.method IN ('cartao_credito','cartao_debito');

-- Registrar recebimento do saldo de uma venda (idempotente, sem troco implícito)
CREATE OR REPLACE FUNCTION public.register_sale_receipt(_sale_id uuid, _amount numeric, _account_id uuid, _method text, _received_at date, _note text, _client_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_entry uuid;
  v_received numeric(12,2);
  v_balance numeric(12,2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF NOT public.has_store_permission(v_sale.store_id, 'register_payments') THEN RAISE EXCEPTION 'Sem permissão para registrar recebimentos.'; END IF;
  IF _client_token IS NOT NULL THEN
    SELECT id INTO v_entry FROM public.financial_entries WHERE store_id = v_sale.store_id AND client_token = _client_token;
    IF FOUND THEN RETURN v_entry; END IF;
  END IF;
  IF v_sale.status = 'cancelada' THEN RAISE EXCEPTION 'Venda cancelada não admite recebimento.'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Valor inválido.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.financial_accounts a WHERE a.id = _account_id AND a.store_id = v_sale.store_id AND a.active) THEN
    RAISE EXCEPTION 'Conta de destino inválida.';
  END IF;
  v_received := v_sale.amount_received + COALESCE((SELECT sum(e.paid_amount) FROM public.financial_entries e WHERE e.sale_id = _sale_id AND e.kind = 'entrada' AND e.status = 'pago' AND NOT e.is_refund AND e.reversal_of IS NULL), 0);
  v_balance := v_sale.total - v_sale.trade_in_value - v_received;
  IF _amount > v_balance THEN
    RAISE EXCEPTION 'Valor excede o saldo devedor de R$ %. Troco ou crédito exigem tratamento explícito.', to_char(v_balance, 'FM999G990D00');
  END IF;
  INSERT INTO public.financial_entries (store_id, account_id, kind, amount, paid_amount, description, method, status, due_date, competence_date, paid_at, sale_id, client_id, client_token)
  VALUES (v_sale.store_id, _account_id, 'entrada', _amount, _amount,
          'Recebimento — venda nº ' || v_sale.receipt_number || COALESCE(' · ' || NULLIF(trim(_note),''), ''),
          _method, 'pago', _received_at, _received_at, _received_at, _sale_id, v_sale.client_id, _client_token)
  RETURNING id INTO v_entry;
  UPDATE public.sales SET amount_received = amount_received + _amount, balance = balance - _amount WHERE id = _sale_id;
  INSERT INTO public.sale_events (sale_id, store_id, event, detail)
  VALUES (_sale_id, v_sale.store_id, 'recebimento', jsonb_build_object('amount', _amount, 'method', _method));
  RETURN v_entry;
END $$;

-- Criar contrato de crediário sem juros a partir do valor financiado da venda
CREATE OR REPLACE FUNCTION public.create_credit_contract(_sale_id uuid, _installments int, _first_due date, _notes text, _client_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_contract uuid;
  v_principal numeric(12,2);
  v_down numeric(12,2);
  v_base numeric(12,2);
  v_last numeric(12,2);
  i int;
  v_month date;
  v_last_day int;
  v_due date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF NOT public.has_store_permission(v_sale.store_id, 'approve_credit') THEN RAISE EXCEPTION 'Sem permissão para aprovar crediário.'; END IF;
  SELECT id INTO v_contract FROM public.credit_contracts WHERE sale_id = _sale_id;
  IF FOUND THEN RETURN v_contract; END IF;
  IF v_sale.status <> 'concluida' THEN RAISE EXCEPTION 'Só é possível criar crediário para venda concluída.'; END IF;
  IF _installments IS NULL OR _installments < 1 OR _installments > 60 THEN RAISE EXCEPTION 'Quantidade de parcelas inválida.'; END IF;
  IF _first_due IS NULL THEN RAISE EXCEPTION 'Informe o primeiro vencimento.'; END IF;
  SELECT COALESCE(sum(CASE WHEN p.method = 'crediario' THEN p.amount END), 0),
         COALESCE(sum(CASE WHEN p.method <> 'crediario' THEN p.amount END), 0)
    INTO v_principal, v_down FROM public.sale_payments p WHERE p.sale_id = _sale_id;
  IF v_principal <= 0 THEN RAISE EXCEPTION 'A venda não tem valor financiado em crediário.'; END IF;
  v_base := trunc(v_principal * 100 / _installments) / 100;
  v_last := v_principal - v_base * (_installments - 1);
  INSERT INTO public.credit_contracts (store_id, sale_id, client_id, down_payment, principal, installments_count, first_due_date, interest_method, notes)
  VALUES (v_sale.store_id, _sale_id, v_sale.client_id, v_down, v_principal, _installments, _first_due, 'sem_juros', NULLIF(trim(_notes),''))
  RETURNING id INTO v_contract;
  FOR i IN 1.._installments LOOP
    v_month := (date_trunc('month', _first_due)::date + ((i - 1) || ' months')::interval)::date;
    v_last_day := extract(day FROM (date_trunc('month', _first_due) + (i || ' months')::interval - interval '1 day'))::int;
    v_due := v_month + (least(extract(day FROM _first_due)::int, v_last_day) - 1);
    INSERT INTO public.credit_installments (store_id, contract_id, number, due_date, amount, principal_amount)
    VALUES (v_sale.store_id, v_contract, i, v_due, CASE WHEN i = _installments THEN v_last ELSE v_base END, CASE WHEN i = _installments THEN v_last ELSE v_base END);
  END LOOP;
  INSERT INTO public.sale_events (sale_id, store_id, event, detail)
  VALUES (_sale_id, v_sale.store_id, 'crediario', jsonb_build_object('principal', v_principal, 'installments', _installments, 'first_due', _first_due));
  RETURN v_contract;
END $$;

-- Receber parcelas do crediário (idempotente, alocação da mais antiga para a mais nova)
CREATE OR REPLACE FUNCTION public.receive_installments(_contract_id uuid, _amount numeric, _account_id uuid, _method text, _received_at date, _note text, _client_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_contract public.credit_contracts%ROWTYPE;
  v_entry uuid;
  v_remaining numeric(12,2);
  v_left numeric(12,2);
  v_pay numeric(12,2);
  r RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_contract FROM public.credit_contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado.'; END IF;
  IF NOT public.has_store_permission(v_contract.store_id, 'register_payments') THEN RAISE EXCEPTION 'Sem permissão para registrar recebimentos.'; END IF;
  IF _client_token IS NOT NULL THEN
    SELECT id INTO v_entry FROM public.financial_entries WHERE store_id = v_contract.store_id AND client_token = _client_token;
    IF FOUND THEN RETURN v_entry; END IF;
  END IF;
  IF v_contract.status <> 'ativo' THEN RAISE EXCEPTION 'Contrato não está ativo.'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Valor inválido.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.financial_accounts a WHERE a.id = _account_id AND a.store_id = v_contract.store_id AND a.active) THEN
    RAISE EXCEPTION 'Conta de destino inválida.';
  END IF;
  SELECT COALESCE(sum(amount - paid_amount), 0) INTO v_remaining FROM public.credit_installments WHERE contract_id = _contract_id AND status IN ('aberto','parcial');
  IF _amount > v_remaining THEN
    RAISE EXCEPTION 'Valor excede o saldo do contrato de R$ %. Troco ou crédito exigem tratamento explícito.', to_char(v_remaining, 'FM999G990D00');
  END IF;
  INSERT INTO public.financial_entries (store_id, account_id, kind, amount, paid_amount, description, method, status, due_date, competence_date, paid_at, sale_id, client_id, contract_id, client_token)
  VALUES (v_contract.store_id, _account_id, 'entrada', _amount, _amount,
          'Recebimento de crediário — venda nº ' || (SELECT receipt_number FROM public.sales WHERE id = v_contract.sale_id) || COALESCE(' · ' || NULLIF(trim(_note),''), ''),
          _method, 'pago', _received_at, _received_at, _received_at, v_contract.sale_id, v_contract.client_id, _contract_id, _client_token)
  RETURNING id INTO v_entry;
  v_left := _amount;
  FOR r IN SELECT * FROM public.credit_installments WHERE contract_id = _contract_id AND status IN ('aberto','parcial') ORDER BY due_date, number LOOP
    EXIT WHEN v_left <= 0;
    v_pay := least(v_left, r.amount - r.paid_amount);
    UPDATE public.credit_installments
      SET paid_amount = paid_amount + v_pay,
          status = CASE WHEN paid_amount + v_pay >= amount THEN 'pago' ELSE 'parcial' END,
          paid_at = CASE WHEN paid_amount + v_pay >= amount THEN _received_at ELSE paid_at END
      WHERE id = r.id;
    v_left := v_left - v_pay;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.credit_installments WHERE contract_id = _contract_id AND status IN ('aberto','parcial')) THEN
    UPDATE public.credit_contracts SET status = 'quitado' WHERE id = _contract_id;
  END IF;
  INSERT INTO public.sale_events (sale_id, store_id, event, detail)
  VALUES (v_contract.sale_id, v_contract.store_id, 'recebimento_crediario', jsonb_build_object('amount', _amount, 'method', _method));
  RETURN v_entry;
END $$;

-- Estorno de recebimento: exige permissão, motivo e gera movimento reverso rastreável
CREATE OR REPLACE FUNCTION public.reverse_receipt(_entry_id uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_entry public.financial_entries%ROWTYPE;
  v_reverse uuid;
  v_left numeric(12,2);
  v_take numeric(12,2);
  r RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_entry FROM public.financial_entries WHERE id = _entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
  IF NOT public.has_store_permission(v_entry.store_id, 'reverse_payments') THEN RAISE EXCEPTION 'Sem permissão para estornar recebimentos.'; END IF;
  IF v_entry.kind <> 'entrada' OR v_entry.status <> 'pago' OR v_entry.reversed_by IS NOT NULL THEN
    RAISE EXCEPTION 'Este lançamento não pode ser estornado.';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN RAISE EXCEPTION 'Informe o motivo do estorno.'; END IF;
  INSERT INTO public.financial_entries (store_id, account_id, kind, amount, paid_amount, description, method, status, due_date, competence_date, paid_at, sale_id, client_id, contract_id, reversal_of, reversal_reason)
  VALUES (v_entry.store_id, v_entry.account_id, 'saida', v_entry.amount, v_entry.amount,
          'Estorno — ' || v_entry.description, v_entry.method, 'pago', CURRENT_DATE, CURRENT_DATE, CURRENT_DATE,
          v_entry.sale_id, v_entry.client_id, v_entry.contract_id, v_entry.id, trim(_reason))
  RETURNING id INTO v_reverse;
  UPDATE public.financial_entries SET status = 'estornado', reversed_by = v_reverse, updated_at = now() WHERE id = v_entry.id;
  IF v_entry.contract_id IS NOT NULL THEN
    v_left := v_entry.amount;
    FOR r IN SELECT * FROM public.credit_installments WHERE contract_id = v_entry.contract_id AND paid_amount > 0 ORDER BY due_date DESC, number DESC LOOP
      EXIT WHEN v_left <= 0;
      v_take := least(v_left, r.paid_amount);
      UPDATE public.credit_installments
        SET paid_amount = paid_amount - v_take,
            status = CASE WHEN paid_amount - v_take <= 0 THEN 'aberto' ELSE 'parcial' END,
            paid_at = CASE WHEN paid_amount - v_take <= 0 THEN NULL ELSE paid_at END
        WHERE id = r.id;
      v_left := v_left - v_take;
    END LOOP;
    UPDATE public.credit_contracts SET status = 'ativo' WHERE id = v_entry.contract_id AND status = 'quitado';
  ELSIF v_entry.sale_id IS NOT NULL THEN
    UPDATE public.sales SET amount_received = amount_received - v_entry.amount, balance = balance + v_entry.amount WHERE id = v_entry.sale_id;
  END IF;
  IF v_entry.sale_id IS NOT NULL THEN
    INSERT INTO public.sale_events (sale_id, store_id, event, detail)
    VALUES (v_entry.sale_id, v_entry.store_id, 'estorno', jsonb_build_object('amount', v_entry.amount, 'reason', trim(_reason)));
  END IF;
  RETURN v_reverse;
END $$;

-- Cancelamento revisado: reembolso separado, recebíveis cancelados, usado comprometido bloqueia
CREATE OR REPLACE FUNCTION public.cancel_sale(_sale_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _sale public.sales%ROWTYPE;
  _item RECORD;
  _trade RECORD;
  v_refund numeric(12,2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF NOT public.has_store_permission(_sale.store_id, 'cancel_sales') THEN RAISE EXCEPTION 'Sem permissão para cancelar vendas.'; END IF;
  IF _sale.status = 'cancelada' THEN RAISE EXCEPTION 'Esta venda já está cancelada.'; END IF;

  FOR _trade IN SELECT sti.device_id, d.model, d.status FROM public.sale_trade_ins sti JOIN public.devices d ON d.id = sti.device_id WHERE sti.sale_id = _sale_id LOOP
    IF _trade.status IN ('vendido','reservado') OR EXISTS (
      SELECT 1 FROM public.sale_items si JOIN public.sales s2 ON s2.id = si.sale_id
      WHERE si.device_id = _trade.device_id AND s2.status = 'concluida'
    ) THEN
      RAISE EXCEPTION 'O usado recebido na troca (%) já foi vendido ou está comprometido em outra operação. O cancelamento exige resolução específica por usuário autorizado.', _trade.model;
    END IF;
  END LOOP;

  SELECT COALESCE(sum(e.paid_amount), 0) INTO v_refund FROM public.financial_entries e
    WHERE e.sale_id = _sale_id AND e.kind = 'entrada' AND e.status = 'pago' AND NOT e.is_refund AND e.reversal_of IS NULL;

  UPDATE public.sales SET status = 'cancelada', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = NULLIF(trim(_reason,''), ''), refund_due = v_refund WHERE id = _sale_id;

  FOR _item IN SELECT * FROM public.sale_items WHERE sale_id = _sale_id LOOP
    UPDATE public.devices SET status = 'disponivel' WHERE id = _item.device_id AND status = 'vendido';
  END LOOP;

  FOR _trade IN SELECT * FROM public.sale_trade_ins WHERE sale_id = _sale_id LOOP
    UPDATE public.devices SET status = 'devolvido_cliente' WHERE id = _trade.device_id AND status = 'em_conferencia';
  END LOOP;

  UPDATE public.financial_entries SET status = 'cancelado', updated_at = now()
    WHERE sale_id = _sale_id AND status IN ('pendente','parcial');

  UPDATE public.credit_installments SET status = 'cancelado'
    WHERE contract_id IN (SELECT id FROM public.credit_contracts WHERE sale_id = _sale_id) AND status IN ('aberto','parcial');
  UPDATE public.credit_contracts SET status = 'cancelado' WHERE sale_id = _sale_id AND status = 'ativo';

  INSERT INTO public.sale_events (sale_id, store_id, event, detail)
  VALUES (_sale_id, _sale.store_id, 'cancelada', jsonb_build_object('reason', NULLIF(trim(_reason),''), 'refund_due', v_refund));
END $$;

-- Registrar reembolso efetivo de venda cancelada (idempotente)
CREATE OR REPLACE FUNCTION public.register_refund(_sale_id uuid, _amount numeric, _account_id uuid, _method text, _paid_at date, _note text, _client_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_entry uuid;
  v_refunded numeric(12,2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF NOT public.has_store_permission(v_sale.store_id, 'register_payments') THEN RAISE EXCEPTION 'Sem permissão para registrar pagamentos.'; END IF;
  IF _client_token IS NOT NULL THEN
    SELECT id INTO v_entry FROM public.financial_entries WHERE store_id = v_sale.store_id AND client_token = _client_token;
    IF FOUND THEN RETURN v_entry; END IF;
  END IF;
  IF v_sale.status <> 'cancelada' THEN RAISE EXCEPTION 'Reembolso só se aplica a venda cancelada.'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Valor inválido.'; END IF;
  SELECT COALESCE(sum(e.amount), 0) INTO v_refunded FROM public.financial_entries e
    WHERE e.sale_id = _sale_id AND e.kind = 'saida' AND e.is_refund AND e.status = 'pago';
  IF _amount > v_sale.refund_due - v_refunded THEN
    RAISE EXCEPTION 'Valor excede o reembolso pendente de R$ %.', to_char(v_sale.refund_due - v_refunded, 'FM999G990D00');
  END IF;
  INSERT INTO public.financial_entries (store_id, account_id, kind, amount, paid_amount, description, method, status, due_date, competence_date, paid_at, sale_id, client_id, is_refund, client_token)
  VALUES (v_sale.store_id, _account_id, 'saida', _amount, _amount,
          'Reembolso — venda nº ' || v_sale.receipt_number || COALESCE(' · ' || NULLIF(trim(_note),''), ''),
          _method, 'pago', _paid_at, _paid_at, _paid_at, _sale_id, v_sale.client_id, true, _client_token)
  RETURNING id INTO v_entry;
  INSERT INTO public.sale_events (sale_id, store_id, event, detail)
  VALUES (_sale_id, v_sale.store_id, 'reembolso', jsonb_build_object('amount', _amount, 'method', _method));
  RETURN v_entry;
END $$;
