-- ===== Access helpers =====
ALTER TABLE public.store_subscriptions
  ADD COLUMN IF NOT EXISTS plan_id uuid,
  ADD COLUMN IF NOT EXISTS contracted_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS user_limit integer,
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS access_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS access_until timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_canceled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS external_customer_id text,
  ADD COLUMN IF NOT EXISTS external_subscription_id text,
  ADD COLUMN IF NOT EXISTS paid_period_start date,
  ADD COLUMN IF NOT EXISTS paid_period_end date,
  ADD COLUMN IF NOT EXISTS next_due_date date,
  ADD COLUMN IF NOT EXISTS access_reason text;
ALTER TABLE public.store_subscriptions ADD CONSTRAINT store_subscriptions_billing_chk CHECK (billing_status IN ('legacy','trial','courtesy','active','past_due','canceled','none'));
ALTER TABLE public.store_subscriptions ADD CONSTRAINT store_subscriptions_access_chk CHECK (access_status IN ('active','suspended'));
COMMENT ON COLUMN public.store_subscriptions.status IS 'DEPRECATED: replaced by billing_status / access_status';
COMMENT ON COLUMN public.store_subscriptions.plan IS 'DEPRECATED: replaced by plan_id';

CREATE OR REPLACE FUNCTION public.store_access_ok(_store_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT s.access_status = 'active'
      AND NOT (s.billing_status IN ('trial','courtesy') AND s.access_until IS NOT NULL AND s.access_until < now())
    FROM public.store_subscriptions s WHERE s.store_id = _store_id), true)
$$;

CREATE OR REPLACE FUNCTION public.is_store_member_any(_store_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.store_members WHERE store_id = _store_id AND user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.is_store_member(_store_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.store_members WHERE store_id = _store_id AND user_id = auth.uid())
     AND public.store_access_ok(_store_id)
$$;

CREATE OR REPLACE FUNCTION public.is_store_owner(_store_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.store_members WHERE store_id = _store_id AND user_id = auth.uid() AND role = 'owner')
     AND public.store_access_ok(_store_id)
$$;

CREATE OR REPLACE FUNCTION public.has_store_permission(_store_id uuid, _perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.store_access_ok(_store_id) AND EXISTS (
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

-- account status stays visible while suspended
DROP POLICY IF EXISTS "members read store" ON public.stores;
CREATE POLICY "members read store" ON public.stores FOR SELECT TO authenticated USING (public.is_store_member_any(id));
DROP POLICY IF EXISTS "members read team" ON public.store_members;
CREATE POLICY "members read team" ON public.store_members FOR SELECT TO authenticated USING (public.is_store_member_any(store_id));
DROP POLICY IF EXISTS "members read subscription" ON public.store_subscriptions;
CREATE POLICY "members read subscription" ON public.store_subscriptions FOR SELECT TO authenticated USING (public.is_store_member_any(store_id) OR public.has_role(auth.uid(), 'admin'));

-- ===== Admin history =====
CREATE TABLE public.admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  actor uuid,
  action text NOT NULL,
  reason text,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_audit TO authenticated;
GRANT ALL ON public.admin_audit TO service_role;
ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read admin audit" ON public.admin_audit FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "owners read owner changes" ON public.admin_audit FOR SELECT TO authenticated USING (store_id IS NOT NULL AND action LIKE 'owner_%' AND public.is_store_owner(store_id));
CREATE INDEX admin_audit_store_idx ON public.admin_audit(store_id, created_at DESC);

-- ===== Plans =====
CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  monthly_price numeric(12,2) NOT NULL CHECK (monthly_price >= 0),
  user_limit integer CHECK (user_limit IS NULL OR user_limit > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.plans TO authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read plans" ON public.plans FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR active);
CREATE POLICY "admins insert plans" ON public.plans FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update plans" ON public.plans FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
ALTER TABLE public.store_subscriptions ADD CONSTRAINT store_subscriptions_plan_fk FOREIGN KEY (plan_id) REFERENCES public.plans(id);

CREATE OR REPLACE FUNCTION public.plans_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  INSERT INTO admin_audit(actor, action, before, after)
  VALUES (auth.uid(), CASE WHEN TG_OP='INSERT' THEN 'plan_created' ELSE 'plan_updated' END,
    CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW));
  RETURN NEW;
END $$;
CREATE TRIGGER plans_audit BEFORE INSERT OR UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.plans_audit();

-- ===== User limits =====
CREATE OR REPLACE FUNCTION public.enforce_user_limit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _limit integer; _used integer;
BEGIN
  SELECT user_limit INTO _limit FROM store_subscriptions WHERE store_id = NEW.store_id;
  IF _limit IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM stores WHERE id = NEW.store_id FOR UPDATE;
  SELECT count(*) INTO _used FROM store_members WHERE store_id = NEW.store_id;
  IF TG_TABLE_NAME = 'store_invites' THEN
    _used := _used + (SELECT count(*) FROM store_invites WHERE store_id = NEW.store_id AND accepted_at IS NULL);
  END IF;
  IF _used >= _limit THEN RAISE EXCEPTION 'Limite de % usuários do plano atingido.', _limit; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enforce_user_limit BEFORE INSERT ON public.store_members FOR EACH ROW EXECUTE FUNCTION public.enforce_user_limit();
CREATE TRIGGER enforce_user_limit BEFORE INSERT ON public.store_invites FOR EACH ROW EXECUTE FUNCTION public.enforce_user_limit();

-- ===== Partners (multiple owners) =====
DROP POLICY IF EXISTS "team managers manage invites" ON public.store_invites;
CREATE POLICY "team managers manage invites" ON public.store_invites FOR ALL TO authenticated
  USING (public.has_store_permission(store_id, 'manage_team') AND (role <> 'owner' OR public.is_store_owner(store_id)))
  WITH CHECK (public.has_store_permission(store_id, 'manage_team') AND (role <> 'owner' OR public.is_store_owner(store_id)));

CREATE OR REPLACE FUNCTION public.log_owner_invite() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.role = 'owner' THEN
    INSERT INTO admin_audit(store_id, actor, action, after) VALUES (NEW.store_id, auth.uid(), 'owner_invited', jsonb_build_object('email', NEW.email));
  ELSIF TG_OP = 'DELETE' AND OLD.role = 'owner' AND OLD.accepted_at IS NULL THEN
    INSERT INTO admin_audit(store_id, actor, action, before) VALUES (OLD.store_id, auth.uid(), 'owner_invite_canceled', jsonb_build_object('email', OLD.email));
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER log_owner_invite AFTER INSERT OR DELETE ON public.store_invites FOR EACH ROW EXECUTE FUNCTION public.log_owner_invite();

CREATE OR REPLACE FUNCTION public.accept_my_invites() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _email text; _n integer := 0; r record; _o boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  SELECT lower(email) INTO _email FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF _email IS NULL THEN RETURN 0; END IF;
  FOR r IN SELECT * FROM public.store_invites WHERE lower(email) = _email AND accepted_at IS NULL LOOP
    BEGIN
      _o := r.role = 'owner';
      IF NOT EXISTS (SELECT 1 FROM store_members WHERE store_id = r.store_id AND user_id = auth.uid()) THEN
        -- the pending invite already holds a seat: release it before the limit check
        UPDATE public.store_invites SET accepted_at = now() WHERE id = r.id;
        INSERT INTO public.store_members(store_id, user_id, email, role, can_view_costs, can_view_finance, can_give_discounts, can_approve_evaluations, can_manage_inventory, can_manage_team,
          can_register_sales, can_cancel_sales, can_register_payments, can_reverse_payments, can_approve_credit, can_renegotiate, can_view_contracts)
        VALUES (r.store_id, auth.uid(), _email, r.role, _o OR r.can_view_costs, _o OR r.can_view_finance, _o OR r.can_give_discounts, _o OR r.can_approve_evaluations, _o OR r.can_manage_inventory, _o OR r.can_manage_team,
          _o OR r.can_register_sales, _o OR r.can_cancel_sales, _o OR r.can_register_payments, _o OR r.can_reverse_payments, _o OR r.can_approve_credit, _o OR r.can_renegotiate, _o OR r.can_view_contracts);
        IF _o THEN
          INSERT INTO admin_audit(store_id, actor, action, after) VALUES (r.store_id, auth.uid(), 'owner_accepted', jsonb_build_object('email', _email));
        END IF;
      ELSE
        UPDATE public.store_invites SET accepted_at = now() WHERE id = r.id;
      END IF;
      _n := _n + 1;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'convite % não aceito: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.set_member_role(_member_id uuid, _role store_role, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE m store_members; _owners integer; _o boolean := _role = 'owner';
BEGIN
  SELECT * INTO m FROM store_members WHERE id = _member_id;
  IF NOT FOUND OR NOT public.is_store_owner(m.store_id) THEN RAISE EXCEPTION 'Somente proprietário altera o perfil de proprietário.'; END IF;
  IF m.role = _role THEN RETURN; END IF;
  PERFORM 1 FROM stores WHERE id = m.store_id FOR UPDATE; -- serialize owner changes per store
  SELECT * INTO m FROM store_members WHERE id = _member_id;
  IF m.role = 'owner' THEN
    SELECT count(*) INTO _owners FROM store_members WHERE store_id = m.store_id AND role = 'owner';
    IF _owners <= 1 THEN RAISE EXCEPTION 'A loja precisa manter pelo menos um proprietário.'; END IF;
  END IF;
  UPDATE store_members SET role = _role,
    can_view_costs = can_view_costs OR _o, can_view_finance = can_view_finance OR _o, can_give_discounts = can_give_discounts OR _o,
    can_approve_evaluations = can_approve_evaluations OR _o, can_manage_inventory = can_manage_inventory OR _o, can_manage_team = can_manage_team OR _o,
    can_register_sales = can_register_sales OR _o, can_cancel_sales = can_cancel_sales OR _o, can_register_payments = can_register_payments OR _o,
    can_reverse_payments = can_reverse_payments OR _o, can_approve_credit = can_approve_credit OR _o, can_renegotiate = can_renegotiate OR _o,
    can_view_contracts = can_view_contracts OR _o
  WHERE id = _member_id;
  INSERT INTO admin_audit(store_id, actor, action, reason, before, after)
  VALUES (m.store_id, auth.uid(), CASE WHEN _o THEN 'owner_granted' ELSE 'owner_revoked' END, nullif(trim(_reason),''),
    jsonb_build_object('email', m.email, 'role', m.role), jsonb_build_object('email', m.email, 'role', _role));
END $$;

CREATE OR REPLACE FUNCTION public.remove_owner(_member_id uuid, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE m store_members; _owners integer;
BEGIN
  SELECT * INTO m FROM store_members WHERE id = _member_id;
  IF NOT FOUND OR m.role <> 'owner' OR NOT public.is_store_owner(m.store_id) THEN RAISE EXCEPTION 'Somente proprietário remove outro proprietário.'; END IF;
  PERFORM 1 FROM stores WHERE id = m.store_id FOR UPDATE;
  SELECT count(*) INTO _owners FROM store_members WHERE store_id = m.store_id AND role = 'owner';
  IF _owners <= 1 THEN RAISE EXCEPTION 'A loja precisa manter pelo menos um proprietário.'; END IF;
  DELETE FROM store_members WHERE id = _member_id;
  INSERT INTO admin_audit(store_id, actor, action, reason, before)
  VALUES (m.store_id, auth.uid(), 'owner_removed', nullif(trim(_reason),''), jsonb_build_object('email', m.email, 'role', m.role));
END $$;

-- ===== Platform admin RPCs =====
CREATE OR REPLACE FUNCTION public.require_platform_admin() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Acesso restrito ao administrador da plataforma.'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.require_platform_admin();
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM stores),
    'legacy', count(*) FILTER (WHERE s.billing_status = 'legacy'),
    'trial', count(*) FILTER (WHERE s.billing_status = 'trial'),
    'trial_expired', count(*) FILTER (WHERE s.billing_status = 'trial' AND s.access_until < now()),
    'paid', count(*) FILTER (WHERE s.billing_status = 'active' AND (s.paid_period_end IS NULL OR s.paid_period_end >= current_date)),
    'courtesy', count(*) FILTER (WHERE s.billing_status = 'courtesy'),
    'past_due', count(*) FILTER (WHERE s.billing_status = 'past_due'),
    'suspended', count(*) FILTER (WHERE s.access_status = 'suspended'),
    'renewal_canceled', count(*) FILTER (WHERE s.renewal_canceled),
    'mrr_stores', count(*) FILTER (WHERE s.billing_status = 'active' AND NOT s.renewal_canceled AND s.contracted_price IS NOT NULL),
    'mrr', coalesce(sum(s.contracted_price) FILTER (WHERE s.billing_status = 'active' AND NOT s.renewal_canceled AND s.contracted_price IS NOT NULL), 0)
  ) INTO r FROM stores st LEFT JOIN store_subscriptions s ON s.store_id = st.id;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_stores() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.require_platform_admin();
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
    SELECT jsonb_build_object(
      'id', st.id, 'name', st.name, 'email', st.email, 'phone', st.phone, 'created_at', st.created_at,
      'owners', (SELECT coalesce(jsonb_agg(m.email ORDER BY m.created_at), '[]') FROM store_members m WHERE m.store_id = st.id AND m.role = 'owner'),
      'users', (SELECT count(*) FROM store_members m WHERE m.store_id = st.id),
      'user_limit', s.user_limit, 'plan', p.name, 'contracted_price', s.contracted_price,
      'billing_status', coalesce(s.billing_status, 'none'), 'access_status', coalesce(s.access_status, 'active'),
      'access_until', s.access_until, 'renewal_canceled', coalesce(s.renewal_canceled, false),
      'access_ok', public.store_access_ok(st.id)
    ) AS x
    FROM stores st LEFT JOIN store_subscriptions s ON s.store_id = st.id LEFT JOIN plans p ON p.id = s.plan_id) q), '[]');
END $$;

CREATE OR REPLACE FUNCTION public.admin_store_detail(_store_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.require_platform_admin();
  RETURN (SELECT jsonb_build_object(
    'store', jsonb_build_object('id', st.id, 'name', st.name, 'legal_name', st.legal_name, 'document', st.document, 'email', st.email, 'phone', st.phone, 'address', st.address, 'created_at', st.created_at),
    'subscription', (SELECT to_jsonb(s) - 'status' - 'plan' FROM store_subscriptions s WHERE s.store_id = st.id),
    'members', (SELECT coalesce(jsonb_agg(jsonb_build_object('email', m.email, 'role', m.role, 'since', m.created_at) ORDER BY m.created_at), '[]') FROM store_members m WHERE m.store_id = st.id),
    'history', (SELECT coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'reason', a.reason, 'before', a.before, 'after', a.after, 'created_at', a.created_at,
        'actor', (SELECT email FROM auth.users u WHERE u.id = a.actor)) ORDER BY a.created_at DESC), '[]') FROM admin_audit a WHERE a.store_id = st.id)
  ) FROM stores st WHERE st.id = _store_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_access(_store_id uuid, _action text, _until timestamptz, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b store_subscriptions; a store_subscriptions;
BEGIN
  PERFORM public.require_platform_admin();
  IF coalesce(trim(_reason), '') = '' THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  INSERT INTO store_subscriptions(store_id) VALUES (_store_id) ON CONFLICT (store_id) DO NOTHING;
  SELECT * INTO b FROM store_subscriptions WHERE store_id = _store_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
  IF _action IN ('trial','courtesy','extend') AND (_until IS NULL OR _until <= now()) THEN RAISE EXCEPTION 'Informe uma validade futura.'; END IF;
  IF _action = 'trial' THEN
    UPDATE store_subscriptions SET billing_status = 'trial', access_until = _until, access_reason = _reason, updated_at = now() WHERE store_id = _store_id;
  ELSIF _action = 'courtesy' THEN
    UPDATE store_subscriptions SET billing_status = 'courtesy', access_until = _until, access_reason = _reason, updated_at = now() WHERE store_id = _store_id;
  ELSIF _action = 'extend' THEN
    IF b.access_until IS NOT NULL AND _until <= b.access_until THEN RAISE EXCEPTION 'A nova data deve ser posterior à atual.'; END IF;
    UPDATE store_subscriptions SET access_until = _until, access_reason = _reason, updated_at = now() WHERE store_id = _store_id;
  ELSIF _action = 'suspend' THEN
    IF b.access_status = 'suspended' THEN RAISE EXCEPTION 'A loja já está suspensa.'; END IF;
    UPDATE store_subscriptions SET access_status = 'suspended', access_reason = _reason, updated_at = now() WHERE store_id = _store_id;
  ELSIF _action = 'reactivate' THEN
    IF b.access_status <> 'suspended' THEN RAISE EXCEPTION 'A loja não está suspensa.'; END IF;
    UPDATE store_subscriptions SET access_status = 'active', access_reason = _reason, updated_at = now() WHERE store_id = _store_id;
  ELSE RAISE EXCEPTION 'Ação inválida.'; END IF;
  SELECT * INTO a FROM store_subscriptions WHERE store_id = _store_id;
  INSERT INTO admin_audit(store_id, actor, action, reason, before, after)
  VALUES (_store_id, auth.uid(), 'access_' || _action, _reason,
    jsonb_build_object('billing_status', b.billing_status, 'access_status', b.access_status, 'access_until', b.access_until),
    jsonb_build_object('billing_status', a.billing_status, 'access_status', a.access_status, 'access_until', a.access_until));
END $$;

CREATE OR REPLACE FUNCTION public.admin_assign_plan(_store_id uuid, _plan_id uuid, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p plans; b store_subscriptions;
BEGIN
  PERFORM public.require_platform_admin();
  IF coalesce(trim(_reason), '') = '' THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  SELECT * INTO p FROM plans WHERE id = _plan_id;
  IF NOT FOUND OR NOT p.active THEN RAISE EXCEPTION 'Plano inativo ou inexistente não aceita novas adesões.'; END IF;
  INSERT INTO store_subscriptions(store_id) VALUES (_store_id) ON CONFLICT (store_id) DO NOTHING;
  SELECT * INTO b FROM store_subscriptions WHERE store_id = _store_id FOR UPDATE;
  UPDATE store_subscriptions SET plan_id = p.id, contracted_price = p.monthly_price, user_limit = p.user_limit, updated_at = now() WHERE store_id = _store_id;
  INSERT INTO admin_audit(store_id, actor, action, reason, before, after)
  VALUES (_store_id, auth.uid(), 'plan_assigned', _reason,
    jsonb_build_object('plan_id', b.plan_id, 'contracted_price', b.contracted_price, 'user_limit', b.user_limit),
    jsonb_build_object('plan_id', p.id, 'plan', p.name, 'contracted_price', p.monthly_price, 'user_limit', p.user_limit));
END $$;

-- ===== Sale notifications =====
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  sale_id uuid REFERENCES public.sales(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, sale_id)
);
GRANT SELECT ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own notifications" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid() AND public.is_store_member_any(store_id));
CREATE INDEX notifications_user_idx ON public.notifications(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.notify_sale_owners() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _p jsonb;
BEGIN
  IF NEW.status <> 'concluida' OR NOT EXISTS (SELECT 1 FROM sales WHERE id = NEW.id) THEN RETURN NULL; END IF;
  _p := jsonb_build_object(
    'seller', (SELECT email FROM store_members WHERE store_id = NEW.store_id AND user_id = NEW.seller_id),
    'total', NEW.total, 'receipt_number', NEW.receipt_number, 'sold_at', NEW.created_at,
    'items', (SELECT coalesce(string_agg(trim(d.brand || ' ' || d.model || coalesce(' ' || d.storage, '')), ', ' ORDER BY si.created_at), '')
              FROM sale_items si JOIN devices d ON d.id = si.device_id WHERE si.sale_id = NEW.id));
  INSERT INTO notifications(store_id, user_id, kind, sale_id, payload)
  SELECT NEW.store_id, m.user_id, 'sale_completed', NEW.id, _p FROM store_members m WHERE m.store_id = NEW.store_id AND m.role = 'owner'
  ON CONFLICT (user_id, kind, sale_id) DO NOTHING;
  RETURN NULL;
END $$;
-- deferred: runs at commit, after the sale's items exist and only if the sale transaction succeeds
CREATE CONSTRAINT TRIGGER notify_sale_owners AFTER INSERT ON public.sales DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.notify_sale_owners();

CREATE OR REPLACE FUNCTION public.mark_notifications_read(_ids uuid[]) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE notifications SET read_at = now() WHERE user_id = auth.uid() AND read_at IS NULL AND id = ANY(_ids)
$$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

REVOKE EXECUTE ON FUNCTION public.admin_overview(), public.admin_stores(), public.admin_store_detail(uuid), public.admin_set_access(uuid,text,timestamptz,text), public.admin_assign_plan(uuid,uuid,text), public.set_member_role(uuid,store_role,text), public.remove_owner(uuid,text), public.mark_notifications_read(uuid[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_overview(), public.admin_stores(), public.admin_store_detail(uuid), public.admin_set_access(uuid,text,timestamptz,text), public.admin_assign_plan(uuid,uuid,text), public.set_member_role(uuid,store_role,text), public.remove_owner(uuid,text), public.mark_notifications_read(uuid[]) TO authenticated;