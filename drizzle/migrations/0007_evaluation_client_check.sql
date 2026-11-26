CREATE OR REPLACE FUNCTION public.trade_in_requires_evaluation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _eid uuid := public.safe_uuid(current_setting('mli.evaluation_id', true)); _e evaluations; _client uuid;
BEGIN
  SELECT * INTO _e FROM evaluations WHERE id=_eid FOR UPDATE;
  IF NOT FOUND OR _e.store_id <> NEW.store_id THEN RAISE EXCEPTION 'Usado na troca exige uma avaliação aprovada desta loja.'; END IF;
  SELECT client_id INTO _client FROM sales WHERE id=NEW.sale_id;
  IF _e.client_id IS NULL OR _client IS NULL OR _e.client_id <> _client THEN RAISE EXCEPTION 'A avaliação pertence a outro cliente.'; END IF;
  IF _e.status = 'utilizada' THEN RAISE EXCEPTION 'Esta avaliação já foi usada em outra venda.'; END IF;
  IF _e.status <> 'aprovada' THEN RAISE EXCEPTION 'A avaliação do usado não está aprovada.'; END IF;
  IF _e.offered_value <> NEW.agreed_value THEN RAISE EXCEPTION 'Valor do usado difere da avaliação aprovada.'; END IF;
  UPDATE evaluations SET status='utilizada', sale_id=NEW.sale_id WHERE id=_eid;
  RETURN NEW;
END $$;