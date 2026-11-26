
CREATE OR REPLACE FUNCTION public.set_device_reservation(_device_id uuid, _reserve boolean, _note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _dev public.devices%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _dev FROM public.devices WHERE id = _device_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aparelho não encontrado.'; END IF;
  IF NOT public.has_store_permission(_dev.store_id, 'register_sales') THEN RAISE EXCEPTION 'Sem permissão para reservar aparelhos.'; END IF;
  IF _reserve THEN
    IF _dev.status <> 'disponivel' THEN RAISE EXCEPTION 'Só é possível reservar aparelhos disponíveis.'; END IF;
    UPDATE public.devices SET status = 'reservado' WHERE id = _device_id;
  ELSE
    IF _dev.status <> 'reservado' THEN RAISE EXCEPTION 'Este aparelho não está reservado.'; END IF;
    UPDATE public.devices SET status = 'disponivel' WHERE id = _device_id;
  END IF;
  IF _note IS NOT NULL AND length(trim(_note)) > 0 THEN
    INSERT INTO public.device_movements (store_id, device_id, from_status, to_status, note, created_by)
    VALUES (_dev.store_id, _device_id, _dev.status, CASE WHEN _reserve THEN 'reservado'::public.device_status ELSE 'disponivel'::public.device_status END, trim(_note), auth.uid());
  END IF;
END $$;
