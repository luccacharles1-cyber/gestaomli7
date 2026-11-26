
-- gen_random_bytes vive no schema extensions; qualificar nas funções com search_path fixo
CREATE OR REPLACE FUNCTION public.create_store_invite(_store_id uuid, _email text, _role store_role, _perms jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE _email_n text; _id uuid; _token text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  _email_n := lower(trim(_email));
  IF _email_n !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail inválido.'; END IF;
  IF NOT public.has_store_permission(_store_id, 'manage_team') THEN RAISE EXCEPTION 'Sem permissão para gerenciar equipe.'; END IF;
  IF _role = 'owner' AND NOT public.is_store_owner(_store_id) THEN RAISE EXCEPTION 'Somente proprietários convidam sócios.'; END IF;
  IF EXISTS (SELECT 1 FROM store_members WHERE store_id = _store_id AND lower(email) = _email_n) THEN
    RAISE EXCEPTION 'Este e-mail já é membro da loja.';
  END IF;
  IF EXISTS (SELECT 1 FROM store_invites WHERE store_id = _store_id AND lower(email) = _email_n AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()) THEN
    RAISE EXCEPTION 'Já existe um convite pendente para este e-mail.';
  END IF;
  _token := encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO store_invites(store_id, email, role, token, expires_at,
    can_view_costs, can_view_finance, can_give_discounts, can_approve_evaluations, can_manage_inventory, can_manage_team,
    can_register_sales, can_cancel_sales, can_register_payments, can_reverse_payments, can_approve_credit, can_renegotiate, can_view_contracts)
  VALUES (_store_id, _email_n, _role, _token, now() + interval '7 days',
    coalesce((_perms->>'can_view_costs')::boolean, false), coalesce((_perms->>'can_view_finance')::boolean, false),
    coalesce((_perms->>'can_give_discounts')::boolean, false), coalesce((_perms->>'can_approve_evaluations')::boolean, false),
    coalesce((_perms->>'can_manage_inventory')::boolean, false), coalesce((_perms->>'can_manage_team')::boolean, false),
    coalesce((_perms->>'can_register_sales')::boolean, true), coalesce((_perms->>'can_cancel_sales')::boolean, false),
    coalesce((_perms->>'can_register_payments')::boolean, false), coalesce((_perms->>'can_reverse_payments')::boolean, false),
    coalesce((_perms->>'can_approve_credit')::boolean, false), coalesce((_perms->>'can_renegotiate')::boolean, false),
    coalesce((_perms->>'can_view_contracts')::boolean, false))
  ON CONFLICT (store_id, email) DO UPDATE SET
    role = EXCLUDED.role, token = EXCLUDED.token, expires_at = EXCLUDED.expires_at,
    accepted_at = NULL, revoked_at = NULL, send_count = 0, last_sent_at = NULL, invited_by = auth.uid(),
    can_view_costs = EXCLUDED.can_view_costs, can_view_finance = EXCLUDED.can_view_finance,
    can_give_discounts = EXCLUDED.can_give_discounts, can_approve_evaluations = EXCLUDED.can_approve_evaluations,
    can_manage_inventory = EXCLUDED.can_manage_inventory, can_manage_team = EXCLUDED.can_manage_team,
    can_register_sales = EXCLUDED.can_register_sales, can_cancel_sales = EXCLUDED.can_cancel_sales,
    can_register_payments = EXCLUDED.can_register_payments, can_reverse_payments = EXCLUDED.can_reverse_payments,
    can_approve_credit = EXCLUDED.can_approve_credit, can_renegotiate = EXCLUDED.can_renegotiate,
    can_view_contracts = EXCLUDED.can_view_contracts
  RETURNING id INTO _id;
  RETURN jsonb_build_object('id', _id, 'token', _token);
END $func$;

-- corrigir tokens dos convites pendentes preexistentes (backfill anterior falhou pelo mesmo motivo)
UPDATE public.store_invites
SET token = encode(extensions.gen_random_bytes(24), 'hex'), expires_at = now() + interval '7 days'
WHERE accepted_at IS NULL AND token IS NULL;
