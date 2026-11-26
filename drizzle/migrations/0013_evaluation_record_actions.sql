ALTER TABLE public.evaluation_prices ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE public.evaluation_adjustments ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE public.evaluations ADD COLUMN archived boolean NOT NULL DEFAULT false;
REVOKE INSERT, UPDATE, DELETE ON public.evaluation_prices FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.evaluation_adjustments FROM authenticated;
CREATE OR REPLACE FUNCTION public.create_evaluation(_store_id uuid, _client_id uuid, _opportunity_id uuid, _model text, _storage text, _adjustment_ids uuid[], _offered numeric, _notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _ref numeric(12,2); _adj jsonb; _sum numeric(12,2); _sug numeric(12,2); _need boolean; _approver boolean; _id uuid;
BEGIN
 IF NOT public.has_store_permission(_store_id,'register_sales') THEN RAISE EXCEPTION 'Sem permissão para avaliar usados.'; END IF;
 PERFORM 1 FROM stores WHERE id=_store_id FOR UPDATE;
 IF _model IS NULL OR length(trim(_model))=0 THEN RAISE EXCEPTION 'Informe o modelo.'; END IF;
 IF _offered IS NULL OR _offered<=0 THEN RAISE EXCEPTION 'Informe o valor oferecido.'; END IF;
 IF _client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM clients WHERE id=_client_id AND store_id=_store_id) THEN RAISE EXCEPTION 'Cliente inválido.'; END IF;
 IF _opportunity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM opportunities WHERE id=_opportunity_id AND store_id=_store_id) THEN RAISE EXCEPTION 'Oportunidade inválida.'; END IF;
 SELECT reference_value INTO _ref FROM evaluation_prices WHERE store_id=_store_id AND NOT archived AND lower(model)=lower(trim(_model)) AND storage=coalesce(_storage,'');
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'label',label,'amount',amount)),'[]'),coalesce(sum(amount),0) INTO _adj,_sum FROM evaluation_adjustments WHERE store_id=_store_id AND active AND NOT archived AND id=ANY(coalesce(_adjustment_ids,'{}'));
 IF jsonb_array_length(_adj)<>coalesce(array_length(_adjustment_ids,1),0) THEN RAISE EXCEPTION 'Ajuste inválido ou arquivado.'; END IF;
 _sug:=CASE WHEN _ref IS NULL THEN NULL ELSE greatest(0,_ref+_sum) END; _need:=_sug IS NULL OR _offered>_sug; _approver:=public.has_store_permission(_store_id,'approve_evaluations');
 INSERT INTO evaluations(store_id,client_id,opportunity_id,model,storage,reference_value,adjustments,suggested_value,offered_value,needs_approval,status,notes,approved_by,approved_at,created_by)
 VALUES(_store_id,_client_id,_opportunity_id,trim(_model),coalesce(_storage,''),_ref,_adj,_sug,round(_offered,2),_need,CASE WHEN NOT _need OR _approver THEN 'aprovada' ELSE 'pendente' END,_notes,CASE WHEN _need AND _approver THEN auth.uid() END,CASE WHEN _need AND _approver THEN now() END,auth.uid()) RETURNING id INTO _id;
 RETURN _id;
END $$;
CREATE OR REPLACE FUNCTION public.manage_evaluation_record(_store_id uuid,_kind text,_action text,_id uuid DEFAULT NULL,_values jsonb DEFAULT '{}') RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _e evaluations; _p evaluation_prices; _a evaluation_adjustments; _new evaluations; _temp uuid; _ids uuid[]; _linked boolean;
BEGIN
 IF _kind NOT IN ('price','adjustment','evaluation') OR _action NOT IN ('save','delete','archive','toggle') THEN RAISE EXCEPTION 'Ação inválida.'; END IF;
 IF NOT public.is_store_member(_store_id) THEN RAISE EXCEPTION 'Sem acesso à loja.'; END IF;
 PERFORM 1 FROM stores WHERE id=_store_id FOR UPDATE;
 IF _kind IN ('price','adjustment') AND NOT public.is_store_owner(_store_id) THEN RAISE EXCEPTION 'Somente o proprietário altera a tabela.'; END IF;
 IF _kind='price' THEN
  IF _id IS NOT NULL THEN SELECT * INTO _p FROM evaluation_prices WHERE id=_id AND store_id=_store_id AND NOT archived FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Referência não encontrada.'; END IF; END IF;
  IF _action='save' THEN
   IF coalesce(trim(_values->>'model'),'')='' OR (_values->>'value')::numeric IS NULL OR (_values->>'value')::numeric<0 THEN RAISE EXCEPTION 'Informe modelo e valor válido.'; END IF;
   IF EXISTS(SELECT 1 FROM evaluation_prices WHERE store_id=_store_id AND lower(trim(model))=lower(trim(_values->>'model')) AND storage=coalesce(_values->>'storage','') AND id IS DISTINCT FROM _id) THEN RAISE EXCEPTION 'Já existe outra referência para esse modelo e armazenamento (inclusive arquivada).'; END IF;
   IF _id IS NULL THEN INSERT INTO evaluation_prices(store_id,model,storage,reference_value) VALUES(_store_id,trim(_values->>'model'),coalesce(_values->>'storage',''),(_values->>'value')::numeric); ELSE UPDATE evaluation_prices SET model=trim(_values->>'model'),storage=coalesce(_values->>'storage',''),reference_value=(_values->>'value')::numeric,updated_at=now() WHERE id=_id; END IF;
  ELSIF _action IN ('delete','archive') AND _id IS NOT NULL THEN
   SELECT EXISTS(SELECT 1 FROM evaluations WHERE store_id=_store_id AND lower(model)=lower(_p.model) AND storage=_p.storage AND reference_value IS NOT NULL) INTO _linked;
   IF _linked OR _action='archive' THEN UPDATE evaluation_prices SET archived=true WHERE id=_id; RETURN 'archived'; ELSE DELETE FROM evaluation_prices WHERE id=_id; RETURN 'deleted'; END IF;
  ELSE RAISE EXCEPTION 'Ação inválida.'; END IF;
 ELSIF _kind='adjustment' THEN
  IF _id IS NOT NULL THEN SELECT * INTO _a FROM evaluation_adjustments WHERE id=_id AND store_id=_store_id AND NOT archived FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Ajuste não encontrado.'; END IF; END IF;
  IF _action='save' THEN
   IF coalesce(trim(_values->>'label'),'')='' OR (_values->>'amount')::numeric IS NULL THEN RAISE EXCEPTION 'Informe descrição e valor.'; END IF;
   IF _id IS NULL THEN INSERT INTO evaluation_adjustments(store_id,kind,label,amount) VALUES(_store_id,_values->>'kind',trim(_values->>'label'),(_values->>'amount')::numeric); ELSE UPDATE evaluation_adjustments SET kind=_values->>'kind',label=trim(_values->>'label'),amount=(_values->>'amount')::numeric WHERE id=_id; END IF;
  ELSIF _action='toggle' AND _id IS NOT NULL THEN UPDATE evaluation_adjustments SET active=NOT active WHERE id=_id;
  ELSIF _action IN ('delete','archive') AND _id IS NOT NULL THEN
   SELECT EXISTS(SELECT 1 FROM evaluations e WHERE e.store_id=_store_id AND e.adjustments @> jsonb_build_array(jsonb_build_object('id',_id))) INTO _linked;
   IF _linked OR _action='archive' THEN UPDATE evaluation_adjustments SET archived=true,active=false WHERE id=_id; RETURN 'archived'; ELSE DELETE FROM evaluation_adjustments WHERE id=_id; RETURN 'deleted'; END IF;
  ELSE RAISE EXCEPTION 'Ação inválida.'; END IF;
 ELSE
  SELECT * INTO _e FROM evaluations WHERE id=_id AND store_id=_store_id AND NOT archived FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avaliação não encontrada.'; END IF;
  IF NOT public.has_store_permission(_store_id,'register_sales') OR NOT (_e.created_by=auth.uid() OR public.has_store_permission(_store_id,'approve_evaluations') OR public.has_store_permission(_store_id,'manage_team')) THEN RAISE EXCEPTION 'Sem permissão para alterar esta avaliação.'; END IF;
  IF _action='archive' THEN UPDATE evaluations SET archived=true WHERE id=_id; RETURN 'archived'; END IF;
  IF _e.sale_id IS NOT NULL OR _e.status='utilizada' THEN RAISE EXCEPTION 'Avaliação usada em venda só pode ser arquivada.'; END IF;
  IF _action='delete' THEN DELETE FROM evaluations WHERE id=_id; RETURN 'deleted';
  ELSIF _action='save' THEN
   SELECT coalesce(array_agg(value::uuid),'{}') INTO _ids FROM jsonb_array_elements_text(coalesce(_values->'adjustments','[]'));
   _temp:=public.create_evaluation(_store_id,(_values->>'client_id')::uuid,_e.opportunity_id,_values->>'model',_values->>'storage',_ids,(_values->>'offered')::numeric,_values->>'notes');
   SELECT * INTO _new FROM evaluations WHERE id=_temp;
   UPDATE evaluations SET client_id=_new.client_id,model=_new.model,storage=_new.storage,reference_value=_new.reference_value,adjustments=_new.adjustments,suggested_value=_new.suggested_value,offered_value=_new.offered_value,needs_approval=_new.needs_approval,status=_new.status,notes=_new.notes,approved_by=_new.approved_by,approved_at=_new.approved_at WHERE id=_id;
   DELETE FROM evaluations WHERE id=_temp;
  ELSE RAISE EXCEPTION 'Ação inválida.'; END IF;
 END IF;
 RETURN 'saved';
END $$;
REVOKE ALL ON FUNCTION public.manage_evaluation_record(uuid,text,text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_evaluation_record(uuid,text,text,uuid,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.evaluation_archive_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN IF NEW.status='utilizada' AND OLD.status<>'utilizada' AND OLD.archived THEN RAISE EXCEPTION 'Avaliação arquivada não pode ser usada em venda.'; END IF; RETURN NEW; END $$;
CREATE TRIGGER evaluation_archive_guard BEFORE UPDATE ON public.evaluations FOR EACH ROW EXECUTE FUNCTION public.evaluation_archive_guard();