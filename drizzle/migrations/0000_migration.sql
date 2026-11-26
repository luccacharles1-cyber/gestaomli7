
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin');
CREATE TYPE public.store_role AS ENUM ('owner','manager','seller');
CREATE TYPE public.device_status AS ENUM ('em_transito','em_conferencia','disponivel','reservado','em_assistencia','vendido','devolvido_fornecedor');
CREATE TYPE public.device_condition AS ENUM ('novo','seminovo');

-- Platform roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own roles readable" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Stores
CREATE TABLE public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  legal_name text,
  document text,
  phone text,
  email text,
  address text,
  logo_path text,
  warranty_text text,
  receipt_seq integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.store_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  email text,
  role store_role NOT NULL DEFAULT 'seller',
  can_view_costs boolean NOT NULL DEFAULT false,
  can_view_finance boolean NOT NULL DEFAULT false,
  can_give_discounts boolean NOT NULL DEFAULT false,
  can_approve_evaluations boolean NOT NULL DEFAULT false,
  can_manage_inventory boolean NOT NULL DEFAULT false,
  can_manage_team boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, user_id)
);

CREATE TABLE public.store_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  email text NOT NULL,
  role store_role NOT NULL DEFAULT 'seller' CHECK (role <> 'owner'),
  can_view_costs boolean NOT NULL DEFAULT false,
  can_view_finance boolean NOT NULL DEFAULT false,
  can_give_discounts boolean NOT NULL DEFAULT false,
  can_approve_evaluations boolean NOT NULL DEFAULT false,
  can_manage_inventory boolean NOT NULL DEFAULT false,
  can_manage_team boolean NOT NULL DEFAULT false,
  invited_by uuid NOT NULL DEFAULT auth.uid(),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, email)
);

CREATE OR REPLACE FUNCTION public.is_store_member(_store_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.store_members WHERE store_id = _store_id AND user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.has_store_permission(_store_id uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
        ELSE false END)
  )
$$;

CREATE OR REPLACE FUNCTION public.is_store_owner(_store_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.store_members WHERE store_id = _store_id AND user_id = auth.uid() AND role = 'owner')
$$;

GRANT SELECT, UPDATE ON public.stores TO authenticated;
GRANT ALL ON public.stores TO service_role;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read store" ON public.stores FOR SELECT TO authenticated USING (public.is_store_member(id));
CREATE POLICY "owner updates store" ON public.stores FOR UPDATE TO authenticated USING (public.is_store_owner(id)) WITH CHECK (public.is_store_owner(id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_members TO authenticated;
GRANT ALL ON public.store_members TO service_role;
ALTER TABLE public.store_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read team" ON public.store_members FOR SELECT TO authenticated USING (public.is_store_member(store_id));
CREATE POLICY "team managers update non-owners" ON public.store_members FOR UPDATE TO authenticated
  USING (public.has_store_permission(store_id,'manage_team') AND role <> 'owner' AND user_id <> auth.uid())
  WITH CHECK (public.has_store_permission(store_id,'manage_team') AND role <> 'owner' AND user_id <> auth.uid());
CREATE POLICY "team managers remove non-owners" ON public.store_members FOR DELETE TO authenticated
  USING (public.has_store_permission(store_id,'manage_team') AND role <> 'owner');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_invites TO authenticated;
GRANT ALL ON public.store_invites TO service_role;
ALTER TABLE public.store_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team managers manage invites" ON public.store_invites FOR ALL TO authenticated
  USING (public.has_store_permission(store_id,'manage_team'))
  WITH CHECK (public.has_store_permission(store_id,'manage_team') AND role <> 'owner');

-- Subscriptions (structure only)
CREATE TABLE public.store_subscriptions (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'inicial',
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','past_due','suspended','canceled')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.store_subscriptions TO authenticated;
GRANT ALL ON public.store_subscriptions TO service_role;
ALTER TABLE public.store_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read subscription" ON public.store_subscriptions FOR SELECT TO authenticated USING (public.is_store_member(store_id));

-- Create store RPC
CREATE OR REPLACE FUNCTION public.create_store(_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN RAISE EXCEPTION 'Nome da loja obrigatório'; END IF;
  _email := auth.jwt() ->> 'email';
  INSERT INTO public.stores(name, created_by, email) VALUES (trim(_name), auth.uid(), _email) RETURNING id INTO _id;
  INSERT INTO public.store_members(store_id, user_id, email, role, can_view_costs, can_view_finance, can_give_discounts, can_approve_evaluations, can_manage_inventory, can_manage_team)
  VALUES (_id, auth.uid(), _email, 'owner', true, true, true, true, true, true);
  INSERT INTO public.store_subscriptions(store_id) VALUES (_id);
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.create_store(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_store(text) TO authenticated;

-- Accept pending invites for current user's email
CREATE OR REPLACE FUNCTION public.accept_my_invites()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _email text; _n integer := 0; r record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  SELECT lower(email) INTO _email FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF _email IS NULL THEN RETURN 0; END IF;
  FOR r IN SELECT * FROM public.store_invites WHERE lower(email) = _email AND accepted_at IS NULL LOOP
    INSERT INTO public.store_members(store_id, user_id, email, role, can_view_costs, can_view_finance, can_give_discounts, can_approve_evaluations, can_manage_inventory, can_manage_team)
    VALUES (r.store_id, auth.uid(), _email, r.role, r.can_view_costs, r.can_view_finance, r.can_give_discounts, r.can_approve_evaluations, r.can_manage_inventory, r.can_manage_team)
    ON CONFLICT (store_id, user_id) DO NOTHING;
    UPDATE public.store_invites SET accepted_at = now() WHERE id = r.id;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.accept_my_invites() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.accept_my_invites() TO authenticated;

-- Devices
CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  internal_code text,
  category text NOT NULL DEFAULT 'iPhone',
  brand text NOT NULL DEFAULT 'Apple',
  model text NOT NULL CHECK (length(trim(model)) > 0),
  storage text,
  color text,
  imei1 text CHECK (imei1 IS NULL OR imei1 ~ '^[0-9]{15}$'),
  imei2 text CHECK (imei2 IS NULL OR imei2 ~ '^[0-9]{15}$'),
  serial_number text,
  condition device_condition NOT NULL DEFAULT 'seminovo',
  conservation text,
  battery_health integer CHECK (battery_health IS NULL OR battery_health BETWEEN 0 AND 100),
  replaced_parts text,
  defects text,
  notes text,
  test_checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin_name text,
  acquired_at date,
  sale_price numeric(12,2) CHECK (sale_price IS NULL OR sale_price >= 0),
  min_price numeric(12,2) CHECK (min_price IS NULL OR min_price >= 0),
  location text,
  status device_status NOT NULL DEFAULT 'em_conferencia',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (imei1 IS NULL OR imei2 IS NULL OR imei1 <> imei2)
);
CREATE INDEX devices_store_idx ON public.devices(store_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices TO authenticated;
GRANT ALL ON public.devices TO service_role;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read devices" ON public.devices FOR SELECT TO authenticated USING (public.is_store_member(store_id));
CREATE POLICY "inventory managers insert devices" ON public.devices FOR INSERT TO authenticated WITH CHECK (public.has_store_permission(store_id,'manage_inventory'));
CREATE POLICY "inventory managers update devices" ON public.devices FOR UPDATE TO authenticated USING (public.has_store_permission(store_id,'manage_inventory')) WITH CHECK (public.has_store_permission(store_id,'manage_inventory'));
CREATE POLICY "owners delete devices" ON public.devices FOR DELETE TO authenticated USING (public.is_store_owner(store_id));

-- Prevent store_id change
CREATE OR REPLACE FUNCTION public.devices_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.store_id <> OLD.store_id THEN RAISE EXCEPTION 'store_id imutável'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER devices_guard BEFORE INSERT OR UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.devices_guard();

-- Unique IMEI per store across both fields
CREATE TABLE public.device_imeis (
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  imei text NOT NULL,
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  PRIMARY KEY (store_id, imei)
);
GRANT SELECT ON public.device_imeis TO authenticated;
GRANT ALL ON public.device_imeis TO service_role;
ALTER TABLE public.device_imeis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read imeis" ON public.device_imeis FOR SELECT TO authenticated USING (public.is_store_member(store_id));

CREATE OR REPLACE FUNCTION public.devices_sync_imeis()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.device_imeis WHERE device_id = NEW.id;
  BEGIN
    IF NEW.imei1 IS NOT NULL THEN INSERT INTO public.device_imeis VALUES (NEW.store_id, NEW.imei1, NEW.id); END IF;
    IF NEW.imei2 IS NOT NULL THEN INSERT INTO public.device_imeis VALUES (NEW.store_id, NEW.imei2, NEW.id); END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'IMEI já cadastrado em outro aparelho desta loja' USING ERRCODE = '23505';
  END;
  RETURN NEW;
END $$;
CREATE TRIGGER devices_sync_imeis AFTER INSERT OR UPDATE OF imei1, imei2 ON public.devices FOR EACH ROW EXECUTE FUNCTION public.devices_sync_imeis();

-- Costs (separate, permission-gated)
CREATE TABLE public.device_costs (
  device_id uuid PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  purchase_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (purchase_cost >= 0),
  freight_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (freight_cost >= 0),
  other_costs numeric(12,2) NOT NULL DEFAULT 0 CHECK (other_costs >= 0),
  total_cost numeric(12,2) GENERATED ALWAYS AS (purchase_cost + freight_cost + other_costs) STORED,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.device_costs TO authenticated;
GRANT ALL ON public.device_costs TO service_role;
ALTER TABLE public.device_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cost viewers read" ON public.device_costs FOR SELECT TO authenticated USING (public.has_store_permission(store_id,'view_costs'));
CREATE POLICY "cost editors insert" ON public.device_costs FOR INSERT TO authenticated WITH CHECK (public.has_store_permission(store_id,'view_costs') AND public.has_store_permission(store_id,'manage_inventory') AND EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id AND d.store_id = device_costs.store_id));
CREATE POLICY "cost editors update" ON public.device_costs FOR UPDATE TO authenticated USING (public.has_store_permission(store_id,'view_costs') AND public.has_store_permission(store_id,'manage_inventory')) WITH CHECK (public.has_store_permission(store_id,'view_costs') AND public.has_store_permission(store_id,'manage_inventory') AND EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id AND d.store_id = device_costs.store_id));

-- Photos
CREATE TABLE public.device_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  path text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_photos TO authenticated;
GRANT ALL ON public.device_photos TO service_role;
ALTER TABLE public.device_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read photos" ON public.device_photos FOR SELECT TO authenticated USING (public.is_store_member(store_id));
CREATE POLICY "inventory managers write photos" ON public.device_photos FOR INSERT TO authenticated WITH CHECK (public.has_store_permission(store_id,'manage_inventory') AND path LIKE store_id::text || '/%' AND EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id AND d.store_id = device_photos.store_id));
CREATE POLICY "inventory managers update photos" ON public.device_photos FOR UPDATE TO authenticated USING (public.has_store_permission(store_id,'manage_inventory')) WITH CHECK (public.has_store_permission(store_id,'manage_inventory'));
CREATE POLICY "inventory managers delete photos" ON public.device_photos FOR DELETE TO authenticated USING (public.has_store_permission(store_id,'manage_inventory'));

-- Movements
CREATE TABLE public.device_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  from_status device_status,
  to_status device_status NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.device_movements TO authenticated;
GRANT ALL ON public.device_movements TO service_role;
ALTER TABLE public.device_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read movements" ON public.device_movements FOR SELECT TO authenticated USING (public.is_store_member(store_id));

CREATE OR REPLACE FUNCTION public.devices_log_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.device_movements(store_id, device_id, from_status, to_status, note, created_by) VALUES (NEW.store_id, NEW.id, NULL, NEW.status, 'Cadastro', auth.uid());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.device_movements(store_id, device_id, from_status, to_status, created_by) VALUES (NEW.store_id, NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER devices_log_movement AFTER INSERT OR UPDATE OF status ON public.devices FOR EACH ROW EXECUTE FUNCTION public.devices_log_movement();

-- Accessories
CREATE TABLE public.accessories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  sku text,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  sale_price numeric(12,2) CHECK (sale_price IS NULL OR sale_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accessories TO authenticated;
GRANT ALL ON public.accessories TO service_role;
ALTER TABLE public.accessories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read accessories" ON public.accessories FOR SELECT TO authenticated USING (public.is_store_member(store_id));
CREATE POLICY "inventory managers write accessories" ON public.accessories FOR ALL TO authenticated USING (public.has_store_permission(store_id,'manage_inventory')) WITH CHECK (public.has_store_permission(store_id,'manage_inventory'));

CREATE TABLE public.accessory_costs (
  accessory_id uuid PRIMARY KEY REFERENCES public.accessories(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0)
);
GRANT SELECT, INSERT, UPDATE ON public.accessory_costs TO authenticated;
GRANT ALL ON public.accessory_costs TO service_role;
ALTER TABLE public.accessory_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cost viewers read acc" ON public.accessory_costs FOR SELECT TO authenticated USING (public.has_store_permission(store_id,'view_costs'));
CREATE POLICY "cost editors write acc" ON public.accessory_costs FOR INSERT TO authenticated WITH CHECK (public.has_store_permission(store_id,'view_costs') AND public.has_store_permission(store_id,'manage_inventory') AND EXISTS (SELECT 1 FROM public.accessories a WHERE a.id = accessory_id AND a.store_id = accessory_costs.store_id));
CREATE POLICY "cost editors update acc" ON public.accessory_costs FOR UPDATE TO authenticated USING (public.has_store_permission(store_id,'view_costs') AND public.has_store_permission(store_id,'manage_inventory')) WITH CHECK (public.has_store_permission(store_id,'view_costs') AND public.has_store_permission(store_id,'manage_inventory'));

-- Highlights (platform)
CREATE TABLE public.highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text,
  title text NOT NULL,
  body text,
  cta_label text,
  cta_url text,
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT false,
  sponsored boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.highlights TO authenticated;
GRANT ALL ON public.highlights TO service_role;
ALTER TABLE public.highlights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read active highlights" ON public.highlights FOR SELECT TO authenticated USING (active OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage highlights" ON public.highlights FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Product grants (suppliers area etc.)
CREATE TABLE public.product_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  product text NOT NULL DEFAULT 'fornecedores',
  note text,
  granted_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, product)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_grants TO authenticated;
GRANT ALL ON public.product_grants TO service_role;
ALTER TABLE public.product_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own grants" ON public.product_grants FOR SELECT TO authenticated USING (lower(email) = lower(auth.jwt() ->> 'email') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage grants" ON public.product_grants FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Audit log
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  actor uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners read audit" ON public.audit_log FOR SELECT TO authenticated USING (public.is_store_owner(store_id));

CREATE OR REPLACE FUNCTION public.audit_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  INSERT INTO public.audit_log(store_id, actor, action, entity, entity_id)
  VALUES (r.store_id, auth.uid(), lower(TG_OP), TG_TABLE_NAME, CASE WHEN TG_TABLE_NAME = 'device_costs' THEN r.device_id ELSE r.id END);
  RETURN r;
END $$;
CREATE TRIGGER audit_devices AFTER INSERT OR UPDATE OR DELETE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_device_costs AFTER INSERT OR UPDATE ON public.device_costs FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_members AFTER INSERT OR UPDATE OR DELETE ON public.store_members FOR EACH ROW EXECUTE FUNCTION public.audit_row();
