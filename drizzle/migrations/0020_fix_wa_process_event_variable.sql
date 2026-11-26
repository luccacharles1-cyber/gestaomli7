CREATE OR REPLACE FUNCTION public.wa_process_event(_delivery_id text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ev record; v jsonb; st uuid; msg jsonb; stat jsonb; conv uuid; _ph text; nm text; body text; mtype text; media jsonb; ins uuid; ts timestamptz;
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
      _ph := regexp_replace(msg->>'from','\D','','g');
      SELECT c->'profile'->>'name' INTO nm FROM jsonb_array_elements(coalesce(v->'contacts','[]'::jsonb)) c WHERE regexp_replace(c->>'wa_id','\D','','g')=_ph LIMIT 1;
      ts := to_timestamp((msg->>'timestamp')::bigint);
      mtype := msg->>'type';
      media := CASE WHEN mtype IN ('image','document','audio','video','sticker') THEN msg->mtype END;
      body := CASE WHEN mtype='text' THEN msg->'text'->>'body' WHEN media IS NOT NULL THEN coalesce(media->>'caption', media->>'filename')
                   WHEN mtype='button' THEN msg->'button'->>'text' WHEN mtype='interactive' THEN coalesce(msg->'interactive'->'button_reply'->>'title', msg->'interactive'->'list_reply'->>'title') END;
      INSERT INTO conversations (store_id, phone, contact_name) VALUES (st, _ph, nm)
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