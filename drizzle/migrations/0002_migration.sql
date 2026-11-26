CREATE OR REPLACE FUNCTION public.audit_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN j := to_jsonb(OLD); ELSE j := to_jsonb(NEW); END IF;
  INSERT INTO public.audit_log(store_id, actor, action, entity, entity_id)
  VALUES ((j->>'store_id')::uuid, auth.uid(), lower(TG_OP), TG_TABLE_NAME, COALESCE(j->>'id', j->>'device_id')::uuid);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;