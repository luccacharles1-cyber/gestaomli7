
-- Convites: token seguro, validade, revogação e controle de reenvio
ALTER TABLE public.store_invites
  ADD COLUMN token text,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN send_count integer NOT NULL DEFAULT 0,
  ADD COLUMN last_sent_at timestamptz;

-- Convites pendentes existentes ganham token e validade para poderem ser compartilhados
UPDATE public.store_invites
SET token = encode(gen_random_bytes(24), 'hex'), expires_at = now() + interval '7 days'
WHERE accepted_at IS NULL AND token IS NULL;

CREATE UNIQUE INDEX store_invites_token_key ON public.store_invites (token) WHERE token IS NOT NULL;

-- A restrição antiga impedia convites de sócio; a autorização passa a ser garantida pelas funções abaixo (somente proprietários convidam sócios)
ALTER TABLE public.store_invites DROP CONSTRAINT store_invites_role_check;

-- Cria convite com token e validade; valida loja, permissão e duplicidades no servidor
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
  _token := encode(gen_random_bytes(24), 'hex');
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

-- Reenvio com limite e intervalo mínimo; renova a validade
CREATE OR REPLACE FUNCTION public.resend_store_invite(_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE r record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT * INTO r FROM store_invites WHERE id = _invite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Convite não encontrado.'; END IF;
  IF NOT public.has_store_permission(r.store_id, 'manage_team') THEN RAISE EXCEPTION 'Sem permissão para gerenciar equipe.'; END IF;
  IF r.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Convite já aceito.'; END IF;
  IF r.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Convite revogado. Crie um novo convite.'; END IF;
  IF r.last_sent_at IS NOT NULL AND r.last_sent_at > now() - interval '60 seconds' THEN
    RAISE EXCEPTION 'Aguarde um minuto antes de reenviar.';
  END IF;
  IF r.send_count >= 10 THEN RAISE EXCEPTION 'Limite de reenvios atingido. Revogue e crie um novo convite.'; END IF;
  UPDATE store_invites SET send_count = send_count + 1, last_sent_at = now(), expires_at = now() + interval '7 days'
  WHERE id = _invite_id;
  RETURN jsonb_build_object('token', r.token);
END $func$;

-- Revogação pelo proprietário/gerente autorizado
CREATE OR REPLACE FUNCTION public.revoke_store_invite(_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE r record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT * INTO r FROM store_invites WHERE id = _invite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Convite não encontrado.'; END IF;
  IF NOT public.has_store_permission(r.store_id, 'manage_team') THEN RAISE EXCEPTION 'Sem permissão para gerenciar equipe.'; END IF;
  UPDATE store_invites SET revoked_at = now() WHERE id = _invite_id AND accepted_at IS NULL AND revoked_at IS NULL;
END $func$;

-- Consulta do convite pelo token (tela de aceite); não expõe o e-mail convidado a terceiros
CREATE OR REPLACE FUNCTION public.get_invite_by_token(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE r record; _email text; _status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT lower(email) INTO _email FROM auth.users WHERE id = auth.uid();
  SELECT i.*, s.name AS store_name INTO r FROM store_invites i JOIN stores s ON s.id = i.store_id WHERE i.token = _token;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  _status := CASE
    WHEN r.accepted_at IS NOT NULL THEN 'used'
    WHEN r.revoked_at IS NOT NULL THEN 'revoked'
    WHEN r.expires_at IS NOT NULL AND r.expires_at < now() THEN 'expired'
    WHEN lower(r.email) <> _email THEN 'other_email'
    ELSE 'valid' END;
  RETURN jsonb_build_object('status', _status, 'store_name', r.store_name, 'role', r.role,
    'expires_at', r.expires_at, 'email', CASE WHEN lower(r.email) = _email THEN r.email ELSE NULL END);
END $func$;

-- Aceite explícito: exige e-mail verificado correspondente, convite válido, único uso
CREATE OR REPLACE FUNCTION public.accept_invite(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE r record; _email text; _o boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
  SELECT lower(email) INTO _email FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF _email IS NULL THEN RAISE EXCEPTION 'Confirme o e-mail da sua conta antes de aceitar o convite.'; END IF;
  SELECT * INTO r FROM store_invites WHERE token = _token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Convite inválido.'; END IF;
  IF lower(r.email) <> _email THEN RAISE EXCEPTION 'Este convite foi criado para outro e-mail.'; END IF;
  IF r.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Este convite já foi utilizado.'; END IF;
  IF r.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Este convite foi revogado.'; END IF;
  IF r.expires_at IS NOT NULL AND r.expires_at < now() THEN RAISE EXCEPTION 'Convite vencido. Peça um novo ao responsável.'; END IF;
  IF EXISTS (SELECT 1 FROM store_members WHERE store_id = r.store_id AND user_id = auth.uid()) THEN
    UPDATE store_invites SET accepted_at = now() WHERE id = r.id;
    RETURN r.store_id;
  END IF;
  _o := r.role = 'owner';
  -- o convite pendente já ocupa uma vaga: libera antes da checagem de limite no insert do membro
  UPDATE store_invites SET accepted_at = now() WHERE id = r.id;
  INSERT INTO store_members(store_id, user_id, email, role, can_view_costs, can_view_finance, can_give_discounts, can_approve_evaluations, can_manage_inventory, can_manage_team,
    can_register_sales, can_cancel_sales, can_register_payments, can_reverse_payments, can_approve_credit, can_renegotiate, can_view_contracts)
  VALUES (r.store_id, auth.uid(), _email, r.role, _o OR r.can_view_costs, _o OR r.can_view_finance, _o OR r.can_give_discounts, _o OR r.can_approve_evaluations, _o OR r.can_manage_inventory, _o OR r.can_manage_team,
    _o OR r.can_register_sales, _o OR r.can_cancel_sales, _o OR r.can_register_payments, _o OR r.can_reverse_payments, _o OR r.can_approve_credit, _o OR r.can_renegotiate, _o OR r.can_view_contracts);
  IF _o THEN
    INSERT INTO admin_audit(store_id, actor, action, after) VALUES (r.store_id, auth.uid(), 'owner_accepted', jsonb_build_object('email', _email));
  END IF;
  RETURN r.store_id;
END $func$;

-- Aceite automático no login fica desligado: todo convite agora tem token e exige aceite explícito
CREATE OR REPLACE FUNCTION public.accept_my_invites()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
BEGIN
  RETURN 0;
END $func$;
COMMENT ON FUNCTION public.accept_my_invites() IS 'DEPRECATED: convites exigem aceite explícito via accept_invite(token).';

REVOKE EXECUTE ON FUNCTION public.create_store_invite(uuid, text, store_role, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resend_store_invite(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_store_invite(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_invite_by_token(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_invite(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_store_invite(uuid, text, store_role, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resend_store_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_store_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invite_by_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invite(text) TO authenticated;
