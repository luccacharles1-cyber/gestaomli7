
CREATE OR REPLACE FUNCTION public.safe_uuid(_t text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN _t::uuid; EXCEPTION WHEN others THEN RETURN NULL; END $$;

CREATE POLICY "store members read files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'store-files' AND public.is_store_member(public.safe_uuid((storage.foldername(name))[1])));
CREATE POLICY "inventory managers upload device photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'store-files' AND (
    ((storage.foldername(name))[2] = 'devices' AND public.has_store_permission(public.safe_uuid((storage.foldername(name))[1]), 'manage_inventory'))
    OR ((storage.foldername(name))[2] = 'logo' AND public.is_store_owner(public.safe_uuid((storage.foldername(name))[1])))
  ));
CREATE POLICY "inventory managers delete device photos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'store-files' AND (
    ((storage.foldername(name))[2] = 'devices' AND public.has_store_permission(public.safe_uuid((storage.foldername(name))[1]), 'manage_inventory'))
    OR ((storage.foldername(name))[2] = 'logo' AND public.is_store_owner(public.safe_uuid((storage.foldername(name))[1])))
  ));
CREATE POLICY "owners update logo" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'store-files' AND (storage.foldername(name))[2] = 'logo' AND public.is_store_owner(public.safe_uuid((storage.foldername(name))[1])));
