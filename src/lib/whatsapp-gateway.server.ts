const GATEWAY_URL = "https://connector-gateway.lovable.dev/whatsapp";
const MAX_MEDIA = 16 * 1024 * 1024;

function keys() {
  const lovable = process.env["LOVABLE_API_KEY"];
  const wa = process.env["WHATSAPP_API_KEY"];
  if (!lovable) throw new Error("LOVABLE_API_KEY não configurada");
  if (!wa) throw new Error("WhatsApp não conectado ao projeto (WHATSAPP_API_KEY ausente)");
  return { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": wa };
}

export async function gw(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(keys())) headers.set(k, v);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${GATEWAY_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { ok: res.ok, status: res.status, json: json as Record<string, any> | null, text };
}

export function metaError(r: { status: number; json: Record<string, any> | null; text: string }) {
  const e = r.json?.["error"];
  return `[${r.status}] ${e?.error_user_msg ?? e?.message ?? r.text.slice(0, 300)}`;
}

/** Downloads an inbound media file (bounded stream) into the private bucket. Retry-safe. */
export async function storeInboundMedia(admin: any, m: { id: string; store_id: string; conversation_id: string; media_id: string }) {
  const meta = await gw(`/media/${encodeURIComponent(m.media_id)}`);
  if (!meta.ok || !meta.json?.["url"]) throw new Error(metaError(meta));
  if (Number(meta.json["file_size"] ?? 0) > MAX_MEDIA) throw new Error("Arquivo acima de 16 MB");
  const res = await fetch(`${GATEWAY_URL}/media_download`, { headers: { ...keys(), "X-WhatsApp-Media-URL": meta.json["url"] } });
  if (!res.ok || !res.body) throw new Error(`[${res.status}] download falhou`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MEDIA) { await reader.cancel(); throw new Error("Arquivo acima de 16 MB"); }
    chunks.push(value);
  }
  const mime = meta.json["mime_type"] ?? res.headers.get("content-type") ?? "application/octet-stream";
  const ext = String(mime).split("/")[1]?.split(";")[0] ?? "bin";
  const path = `${m.store_id}/${m.conversation_id}/${m.id}.${ext}`;
  const up = await admin.storage.from("whatsapp-media").upload(path, new Blob(chunks as BlobPart[], { type: mime }), { contentType: mime, upsert: true });
  if (up.error) throw up.error;
  const upd = await admin.from("messages").update({ media_path: path, media_mime: mime, media_error: null }).eq("id", m.id);
  if (upd.error) throw upd.error;
}

/** Bounded recovery: reprocess a few pending events (least-attempted first) and missing images. */
export async function recoverPending(admin: any) {
  const pend = await admin.from("whatsapp_webhook_events").select("delivery_id").is("processed_at", null).lt("attempts", 20)
    .order("attempts").order("received_at").limit(5);
  for (const e of pend.data ?? []) {
    const r = await admin.rpc("wa_process_event", { _delivery_id: e.delivery_id });
    if (r.error) await admin.from("whatsapp_webhook_events").update({ processing_error: r.error.message }).eq("delivery_id", e.delivery_id);
  }
  const media = await admin.from("messages").select("id,store_id,conversation_id,media_id").eq("direction", "in").eq("type", "image")
    .not("media_id", "is", null).is("media_path", null).order("created_at", { ascending: false }).limit(3);
  for (const m of media.data ?? []) {
    try { await storeInboundMedia(admin, m); }
    catch (err) { await admin.from("messages").update({ media_error: String((err as Error).message) }).eq("id", m.id); }
  }
}
