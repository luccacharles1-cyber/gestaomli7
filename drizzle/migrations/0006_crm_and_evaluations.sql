CREATE TABLE public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  desired_model text,
  budget numeric(12,2),
  notes text,
  stage text NOT NULL DEFAULT 'novo' CHECK (stage IN ('novo','atendimento','proposta','negociacao','concluida','perdida')),
  sale_id uuid REFERENCES public.sales(id),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.opportunities TO authenticated;
GRANT ALL ON public.opportunities TO service_role;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read opps" ON public.opportunities FOR SELECT TO authenticated USING (public.is_store_member(store_id));
CREATE POLICY "members create opps" ON public.opportunities FOR INSERT TO authenticated WITH CHECK (public.is_store_member(store_id) AND (owner_id = auth.uid() OR public.has_store_permission(store_id,'manage_team')));
CREATE POLICY "owner or manager update opps" ON public.opportunities FOR UPDATE TO authenticated USING (public.is_store_member(store_id) AND (owner_id = auth.uid() OR public.has_store_permission(store_id,'manage_team'))) WITH CHECK (public.is_store_member(store_id) AND (owner_id = auth.uid() OR public.has_store_permission(store_id,'manage_team')));

CREATE OR REPLACE FUNCTION public.opportunities_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND store_id = NEW.store_id) THEN RAISE EXCEPTION 'Cliente de outra loja.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM store_members WHERE user_id = NEW.owner_id AND store_id = NEW.store_id) THEN RAISE EXCEPTION 'Responsável não pertence à loja.'; END IF;
  IF NEW.sale_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sales WHERE id = NEW.sale_id AND store_id = NEW.store_id AND (client_id IS NULL OR client_id = NEW.client_id)) THEN
    RAISE EXCEPTION 'Venda inválida para esta oportunidade.'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.store_id <> OLD.store_id THEN RAISE EXCEPTION 'Não é possível mudar a loja.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER opportunities_guard BEFORE INSERT OR UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.opportunities_guard();

CREATE TABLE public.crm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  client_id uuid REFERENCES public.clients(id),
  opportunity_id uuid REFERENCES public.opportunities(id),
  assigned_to uuid NOT NULL DEFAULT auth.uid(),
  title text NOT NULL,
  due_at timestamptz NOT NULL,
  done_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.crm_tasks TO authenticated;
GRANT ALL ON public.crm_tasks TO service_role;
ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read tasks" ON public.crm_tasks FOR SELECT TO authenticated USING (public.is_store_member(store_id));
CREATE POLICY "members create tasks" ON public.crm_tasks FOR INSERT TO authenticated WITH CHECK (public.is_store_member(store_id) AND (assigned_to = auth.uid() OR public.has_store_permission(store_id,'manage_team')));
CREATE POLICY "assignee or manager update tasks" ON public.crm_tasks FOR UPDATE TO authenticated USING (public.is_store_member(store_id) AND (assigned_to = auth.uid() OR public.has_store_permission(store_id,'manage_team'))) WITH CHECK (public.is_store_member(store_id) AND (assigned_to = auth.uid() OR public.has_store_permission(store_id,'manage_team')));

CREATE OR REPLACE FUNCTION public.crm_tasks_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND store_id = NEW.store_id) THEN RAISE EXCEPTION 'Cliente de outra loja.'; END IF;
  IF NEW.opportunity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM opportunities WHERE id = NEW.opportunity_id AND store_id = NEW.store_id) THEN RAISE EXCEPTION 'Oportunidade de outra loja.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM store_members WHERE user_id = NEW.assigned_to AND store_id = NEW.store_id) THEN RAISE EXCEPTION 'Responsável não pertence à loja.'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.store_id <> OLD.store_id THEN RAISE EXCEPTION 'Não é possível mudar a loja.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_tasks_guard BEFORE INSERT OR UPDATE ON public.crm_tasks FOR EACH ROW EXECUTE FUNCTION public.crm_tasks_guard();

CREATE TABLE public.evaluation_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  model text NOT NULL,
  storage text NOT NULL DEFAULT '',
  reference_value numeric(12,2) NOT NULL CHECK (reference_value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX evaluation_prices_uniq ON public.evaluation_prices (store_id, lower(model), storage);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evaluation_prices TO authenticated;
GRANT ALL ON public.evaluation_prices TO service_role;
ALTER TABLE public.evaluation_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read eval prices" ON public.evaluation_prices FOR SELECT TO authenticated USING (public.is_store_member(store_id));
CREATE POLICY "owner insert eval prices" ON public.evaluation_prices FOR INSERT TO authenticated WITH CHECK (public.is_store_owner(store_id));
CREATE POLICY "owner update eval prices" ON public.evaluation_prices FOR UPDATE TO authenticated USING (public.is_store_owner(store_id)) WITH CHECK (public.is_store_owner(store_id));
CREATE POLICY "owner delete eval prices" ON public.evaluation_prices FOR DELETE TO authenticated USING (public.is_store_owner(store_id));

CREATE TABLE public.evaluation_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  kind text NOT NULL CHECK (kind IN ('bateria','conservacao','pecas','defeitos')),
  label text NOT NULL,
  amount numeric(12,2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.evaluation_adjustments TO authenticated;
GRANT ALL ON public.evaluation_adjustments TO service_role;
ALTER TABLE public.evaluation_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read eval adj" ON public.evaluation_adjustments FOR SELECT TO authenticated USING (public.is_store_member(store_id));
CREATE POLICY "owner insert eval adj" ON public.evaluation_adjustments FOR INSERT TO authenticated WITH CHECK (public.is_store_owner(store_id));
CREATE POLICY "owner update eval adj" ON public.evaluation_adjustments FOR UPDATE TO authenticated USING (public.is_store_owner(store_id)) WITH CHECK (public.is_store_owner(store_id));

CREATE TABLE public.evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  client_id uuid REFERENCES public.clients(id),
  opportunity_id uuid REFERENCES public.opportunities(id),
  model text NOT NULL,
  storage text NOT NULL DEFAULT '',
  reference_value numeric(12,2),
  adjustments jsonb NOT NULL DEFAULT '[]',
  suggested_value numeric(12,2),
  offered_value numeric(12,2) NOT NULL,
  needs_approval boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('aprovada','pendente','recusada','utilizada')),
  notes text,
  approved_by uuid,
  approved_at timestamptz,
  sale_id uuid REFERENCES public.sales(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.evaluations TO authenticated;
GRANT ALL ON public.evaluations TO service_role;
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read evaluations" ON public.evaluations FOR SELECT TO authenticated USING (public.is_store_member(store_id));

CREATE OR REPLACE FUNCTION public.create_evaluation(_store_id uuid, _client_id uuid, _opportunity_id uuid, _model text, _storage text, _adjustment_ids uuid[], _offered numeric, _notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _ref numeric(12,2); _adj jsonb; _sum numeric(12,2); _sug numeric(12,2); _need boolean; _approver boolean; _id uuid;
BEGIN
  IF NOT public.has_store_permission(_store_id, 'register_sales') THEN RAISE EXCEPTION 'Sem permissão para avaliar usados.'; END IF;
  IF _model IS NULL OR length(trim(_model)) = 0 THEN RAISE EXCEPTION 'Informe o modelo.'; END IF;
  IF _offered IS NULL OR _offered <= 0 THEN RAISE EXCEPTION 'Informe o valor oferecido.'; END IF;
  IF _client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients WHERE id=_client_id AND store_id=_store_id) THEN RAISE EXCEPTION 'Cliente inválido.'; END IF;
  IF _opportunity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM opportunities WHERE id=_opportunity_id AND store_id=_store_id) THEN RAISE EXCEPTION 'Oportunidade inválida.'; END IF;
  SELECT reference_value INTO _ref FROM evaluation_prices WHERE store_id=_store_id AND lower(model)=lower(trim(_model)) AND storage=coalesce(_storage,'');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'label',label,'amount',amount)),'[]'), coalesce(sum(amount),0)
    INTO _adj, _sum FROM evaluation_adjustments WHERE store_id=_store_id AND active AND id = ANY(coalesce(_adjustment_ids,'{}'));
  IF jsonb_array_length(_adj) <> coalesce(array_length(_adjustment_ids,1),0) THEN RAISE EXCEPTION 'Ajuste inválido.'; END IF;
  _sug := CASE WHEN _ref IS NULL THEN NULL ELSE greatest(0, _ref + _sum) END;
  _need := _sug IS NULL OR _offered > _sug;
  _approver := public.has_store_permission(_store_id, 'approve_evaluations');
  INSERT INTO evaluations (store_id, client_id, opportunity_id, model, storage, reference_value, adjustments, suggested_value, offered_value, needs_approval, status, notes, approved_by, approved_at, created_by)
  VALUES (_store_id, _client_id, _opportunity_id, trim(_model), coalesce(_storage,''), _ref, _adj, _sug, round(_offered,2), _need,
    CASE WHEN NOT _need OR _approver THEN 'aprovada' ELSE 'pendente' END, _notes,
    CASE WHEN _need AND _approver THEN auth.uid() END, CASE WHEN _need AND _approver THEN now() END, auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.decide_evaluation(_id uuid, _approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _e evaluations;
BEGIN
  SELECT * INTO _e FROM evaluations WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR NOT public.has_store_permission(_e.store_id, 'approve_evaluations') THEN RAISE EXCEPTION 'Sem permissão para aprovar avaliações.'; END IF;
  IF _e.status <> 'pendente' THEN RAISE EXCEPTION 'Avaliação não está pendente.'; END IF;
  UPDATE evaluations SET status = CASE WHEN _approve THEN 'aprovada' ELSE 'recusada' END, approved_by=auth.uid(), approved_at=now() WHERE id=_id;
END $$;

CREATE OR REPLACE FUNCTION public.trade_in_requires_evaluation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _eid uuid := public.safe_uuid(current_setting('mli.evaluation_id', true)); _e evaluations;
BEGIN
  SELECT * INTO _e FROM evaluations WHERE id=_eid FOR UPDATE;
  IF NOT FOUND OR _e.store_id <> NEW.store_id THEN RAISE EXCEPTION 'Usado na troca exige uma avaliação aprovada.'; END IF;
  IF _e.status <> 'aprovada' THEN RAISE EXCEPTION 'A avaliação do usado não está aprovada.'; END IF;
  IF _e.offered_value <> NEW.agreed_value THEN RAISE EXCEPTION 'Valor do usado difere da avaliação aprovada.'; END IF;
  UPDATE evaluations SET status='utilizada', sale_id=NEW.sale_id WHERE id=_eid;
  RETURN NEW;
END $$;
CREATE TRIGGER trade_in_requires_evaluation BEFORE INSERT ON public.sale_trade_ins FOR EACH ROW EXECUTE FUNCTION public.trade_in_requires_evaluation();

CREATE OR REPLACE FUNCTION public.complete_sale_evaluated(_store_id uuid, _client_id uuid, _items jsonb, _discount numeric, _payments jsonb, _trade_in jsonb, _notes text, _client_token text, _evaluation_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM set_config('mli.evaluation_id', coalesce(_evaluation_id::text,''), true);
  RETURN public.complete_sale(_store_id, _client_id, _items, _discount, _payments, _trade_in, _notes, _client_token);
END $$;
GRANT EXECUTE ON FUNCTION public.create_evaluation(uuid,uuid,uuid,text,text,uuid[],numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_evaluation(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sale_evaluated(uuid,uuid,jsonb,numeric,jsonb,jsonb,text,text,uuid) TO authenticated;