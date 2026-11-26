ALTER TABLE public.store_members ADD COLUMN IF NOT EXISTS can_attend_chats boolean NOT NULL DEFAULT false;
ALTER TABLE public.store_invites ADD COLUMN IF NOT EXISTS can_attend_chats boolean NOT NULL DEFAULT false;

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
        WHEN 'attend_chats' THEN m.can_attend_chats
        ELSE false END)
  )
$$;

CREATE TABLE public.whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL UNIQUE,
  display_phone text,
  verified_name text,
  status text NOT NULL DEFAULT 'conectado',
  mode text NOT NULL DEFAULT 'teste' CHECK (mode IN ('teste','producao')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.whatsapp_connections TO authenticated;
GRANT ALL ON public.whatsapp_connections TO service_role;
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read wa connection" ON public.whatsapp_connections FOR SELECT TO authenticated USING (public.is_store_member(store_id));

CREATE TABLE public.whatsapp_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id text NOT NULL UNIQUE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text,
  attempts int NOT NULL DEFAULT 0
);
GRANT ALL ON public.whatsapp_webhook_events TO service_role;
ALTER TABLE public.whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX wa_events_pending ON public.whatsapp_webhook_events (attempts, received_at) WHERE processed_at IS NULL;

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'whatsapp',
  phone text NOT NULL,
  contact_name text,
  client_id uuid REFERENCES public.clients(id),
  opportunity_id uuid REFERENCES public.opportunities(id),
  assigned_to uuid,
  unread_count int NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  last_message_preview text,
  last_inbound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, channel, phone)
);
GRANT SELECT ON public.conversations TO authenticated;
GRANT UPDATE (client_id, opportunity_id, assigned_to, unread_count) ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendants read conversations" ON public.conversations FOR SELECT TO authenticated USING (public.has_store_permission(store_id,'attend_chats'));
CREATE POLICY "attendants update conversations" ON public.conversations FOR UPDATE TO authenticated USING (public.has_store_permission(store_id,'attend_chats')) WITH CHECK (public.has_store_permission(store_id,'attend_chats'));

CREATE OR REPLACE FUNCTION public.conversation_links_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients WHERE id=NEW.client_id AND store_id=NEW.store_id) THEN RAISE EXCEPTION 'Cliente de outra loja.'; END IF;
  IF NEW.opportunity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM opportunities WHERE id=NEW.opportunity_id AND store_id=NEW.store_id) THEN RAISE EXCEPTION 'Oportunidade de outra loja.'; END IF;
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM store_members WHERE user_id=NEW.assigned_to AND store_id=NEW.store_id AND (role='owner' OR can_attend_chats)) THEN RAISE EXCEPTION 'Responsável sem permissão de atendimento.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conversation_links_guard BEFORE INSERT OR UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.conversation_links_guard();

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  wa_message_id text UNIQUE,
  client_token uuid UNIQUE,
  type text NOT NULL DEFAULT 'text',
  body text,
  template_name text,
  media_id text,
  media_mime text,
  media_path text,
  media_error text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','sent','delivered','read','failed','unknown','received')),
  error text,
  sent_by uuid,
  sent_at timestamptz, delivered_at timestamptz, read_at timestamptz, failed_at timestamptz,
  provider_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv ON public.messages (conversation_id, created_at);
GRANT SELECT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendants read messages" ON public.messages FOR SELECT TO authenticated USING (public.has_store_permission(store_id,'attend_chats'));

CREATE TABLE public.whatsapp_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_message_id text NOT NULL,
  status text NOT NULL,
  provider_at timestamptz,
  errors jsonb,
  delivery_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, wa_message_id, status)
);
CREATE INDEX wa_status_msg ON public.whatsapp_status_events (wa_message_id);
GRANT ALL ON public.whatsapp_status_events TO service_role;
ALTER TABLE public.whatsapp_status_events ENABLE ROW LEVEL SECURITY;

-- Recomputes a message state from every stored callback: order-independent and replay-safe.
CREATE OR REPLACE FUNCTION public.wa_apply_statuses(_wa_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s record;
BEGIN
  SELECT min(provider_at) FILTER (WHERE status='sent') sent, min(provider_at) FILTER (WHERE status='delivered') deliv,
         min(provider_at) FILTER (WHERE status='read') rd, min(provider_at) FILTER (WHERE status='failed') fl,
         bool_or(status='read') has_read, bool_or(status='delivered') has_deliv, bool_or(status='sent') has_sent, bool_or(status='failed') has_failed,
         (array_agg(errors ORDER BY provider_at DESC) FILTER (WHERE status='failed'))[1] errs
    INTO s FROM whatsapp_status_events WHERE wa_message_id=_wa_id;
  IF NOT FOUND OR (s.has_sent IS NULL) THEN RETURN; END IF;
  UPDATE messages m SET
    sent_at = coalesce(m.sent_at, s.sent, s.deliv, s.rd),
    delivered_at = coalesce(m.delivered_at, s.deliv, s.rd),
    read_at = coalesce(m.read_at, s.rd),
    failed_at = coalesce(m.failed_at, s.fl),
    error = CASE WHEN s.has_failed AND NOT (s.has_deliv OR s.has_read) THEN coalesce(s.errs->0->>'title', s.errs->0->>'message', 'Falha informada pela Meta') ELSE m.error END,
    status = CASE WHEN s.has_read THEN 'read' WHEN s.has_deliv THEN 'delivered' WHEN s.has_failed THEN 'failed' WHEN s.has_sent THEN 'sent' ELSE m.status END
  WHERE m.wa_message_id=_wa_id AND m.direction='out';
END $$;

CREATE OR REPLACE FUNCTION public.wa_process_event(_delivery_id text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ev record; v jsonb; st uuid; msg jsonb; stat jsonb; conv uuid; phone text; nm text; body text; mtype text; media jsonb; ins uuid; ts timestamptz;
BEGIN
  SELECT * INTO ev FROM whatsapp_webhook_events WHERE delivery_id=_delivery_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF ev.processed_at IS NOT NULL THEN RETURN 'done'; END IF;
  v := ev.payload->'entry'->0->'changes'->0->'value';
  IF ev.event='whatsapp.message' THEN
    SELECT store_id INTO st FROM whatsapp_connections WHERE phone_number_id = v->'metadata'->>'phone_number_id';
    IF st IS NULL THEN
      UPDATE whatsapp_webhook_events SET attempts=attempts+1, processing_error='Número não vinculado a nenhuma loja' WHERE id=ev.id;
      RETURN 'unlinked';
    END IF;
    FOR msg IN SELECT * FROM jsonb_array_elements(coalesce(v->'messages','[]'::jsonb)) LOOP
      phone := regexp_replace(msg->>'from','\D','','g');
      SELECT c->'profile'->>'name' INTO nm FROM jsonb_array_elements(coalesce(v->'contacts','[]'::jsonb)) c WHERE regexp_replace(c->>'wa_id','\D','','g')=phone LIMIT 1;
      ts := to_timestamp((msg->>'timestamp')::bigint);
      mtype := msg->>'type';
      media := CASE WHEN mtype IN ('image','document','audio','video','sticker') THEN msg->mtype END;
      body := CASE WHEN mtype='text' THEN msg->'text'->>'body' WHEN media IS NOT NULL THEN coalesce(media->>'caption', media->>'filename')
                   WHEN mtype='button' THEN msg->'button'->>'text' WHEN mtype='interactive' THEN coalesce(msg->'interactive'->'button_reply'->>'title', msg->'interactive'->'list_reply'->>'title') END;
      INSERT INTO conversations (store_id, phone, contact_name) VALUES (st, phone, nm)
        ON CONFLICT (store_id, channel, phone) DO UPDATE SET contact_name = coalesce(conversations.contact_name, EXCLUDED.contact_name)
        RETURNING id INTO conv;
      ins := NULL;
      INSERT INTO messages (store_id, conversation_id, direction, wa_message_id, type, body, media_id, media_mime, status, provider_at, created_at)
        VALUES (st, conv, 'in', msg->>'id', mtype, body, media->>'id', media->>'mime_type', 'received', ts, ts)
        ON CONFLICT (wa_message_id) DO NOTHING RETURNING id INTO ins;
      IF ins IS NOT NULL THEN
        UPDATE conversations SET unread_count=unread_count+1,
          last_inbound_at=greatest(coalesce(last_inbound_at,ts),ts),
          last_message_at=greatest(coalesce(last_message_at,ts),ts),
          last_message_preview=left(coalesce(body,'['||mtype||']'),120)
        WHERE id=conv;
      END IF;
    END LOOP;
  ELSIF ev.event='whatsapp.status' THEN
    FOR stat IN SELECT * FROM jsonb_array_elements(coalesce(v->'statuses','[]'::jsonb)) LOOP
      INSERT INTO whatsapp_status_events (wa_message_id, status, provider_at, errors, delivery_id)
        VALUES (stat->>'id', stat->>'status', to_timestamp((stat->>'timestamp')::bigint), stat->'errors', _delivery_id)
        ON CONFLICT DO NOTHING;
      PERFORM wa_apply_statuses(stat->>'id');
    END LOOP;
  ELSIF ev.event='whatsapp.account_update' THEN
    UPDATE whatsapp_connections SET last_error = 'Meta: '||coalesce(v->>'event','atualização da conta'), checked_at=now()
      WHERE v->>'event' IN ('PARTNER_REMOVED','PARTNER_APP_UNINSTALLED','DISABLED_UPDATE','ACCOUNT_OFFBOARDED');
  END IF;
  UPDATE whatsapp_webhook_events SET processed_at=now(), processing_error=NULL, attempts=attempts+1 WHERE id=ev.id;
  RETURN 'processed';
END $$;
REVOKE ALL ON FUNCTION public.wa_process_event(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wa_apply_statuses(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_process_event(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_apply_statuses(text) TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;