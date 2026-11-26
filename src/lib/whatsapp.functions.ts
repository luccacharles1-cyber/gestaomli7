import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requirePerm(db: any, storeId: string, perm: "attend_chats" | "owner") {
  const r = perm === "owner" ? await db.rpc("is_store_owner", { _store_id: storeId }) : await db.rpc("has_store_permission", { _store_id: storeId, _perm: perm });
  if (r.error || !r.data) throw new Error(perm === "owner" ? "Somente o proprietário gerencia a integração." : "Sem permissão para atender conversas.");
}
async function deps() {
  const [{ supabaseAdmin }, g] = await Promise.all([import("@/integrations/supabase/client.server"), import("./whatsapp-gateway.server")]);
  return { admin: supabaseAdmin as any, ...g };
}

/** Owner links the project's WhatsApp number to this store and refreshes its status. */
export const connectWhatsapp = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ storeId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await requirePerm(context.supabase, data.storeId, "owner");
    const { admin, gw, metaError } = await deps();
    const r = await gw("/phone_number?fields=display_phone_number,verified_name,quality_rating,is_on_biz_app,platform_type,code_verification_status,name_status,account_mode");
    if (!r.ok || !r.json?.["id"]) throw new Error(`Não foi possível ler o número: ${metaError(r)}`);
    const j = r.json;
    const taken = await admin.from("whatsapp_connections").select("store_id").eq("phone_number_id", j["id"]).maybeSingle();
    if (taken.data && taken.data.store_id !== data.storeId) throw new Error("Este número já está vinculado a outra loja.");
    const mode = j["account_mode"] === "LIVE" ? "producao" : "teste";
    const up = await admin.from("whatsapp_connections").upsert({
      store_id: data.storeId, phone_number_id: j["id"], display_phone: j["display_phone_number"], verified_name: j["verified_name"],
      status: "conectado", mode, details: j, last_error: null, checked_at: new Date().toISOString(),
    }, { onConflict: "store_id" });
    if (up.error) throw new Error(up.error.message);
    // Events received before linking stay pending; process them now.
    const pend = await admin.from("whatsapp_webhook_events").select("delivery_id").is("processed_at", null).limit(50);
    for (const e of pend.data ?? []) await admin.rpc("wa_process_event", { _delivery_id: e.delivery_id });
    return { ok: true };
  });

export const listTemplates = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ storeId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await requirePerm(context.supabase, data.storeId, "attend_chats");
    const { gw, metaError } = await deps();
    const r = await gw("/message_templates?fields=name,status,language,components&limit=100");
    if (!r.ok) throw new Error(metaError(r));
    return ((r.json?.["data"] ?? []) as any[]).filter((t) => t.status === "APPROVED").map((t) => ({
      name: String(t.name), language: String(t.language),
      body: String((t.components ?? []).find((c: any) => c.type === "BODY")?.text ?? ""),
    }));
  });

const sendSchema = z.object({
  storeId: z.string().uuid(), conversationId: z.string().uuid(), clientToken: z.string().uuid(),
  text: z.string().trim().min(1).max(4096).optional(),
  image: z.object({ base64: z.string().max(7_000_000), mime: z.enum(["image/jpeg", "image/png"]), caption: z.string().max(1024).optional() }).optional(),
  template: z.object({ name: z.string().min(1).max(512), language: z.string().min(2).max(15), params: z.array(z.string().max(1000)).max(20) }).optional(),
});

async function dispatch(admin: any, gw: any, metaError: any, msgId: string, payload: Record<string, unknown>) {
  let r;
  try { r = await gw("/messages", { method: "POST", body: JSON.stringify(payload) }); }
  catch (e) {
    // Network failure: Meta may or may not have accepted it; never resend silently.
    await admin.from("messages").update({ status: "unknown", error: `Sem resposta da Meta: ${(e as Error).message}` }).eq("id", msgId);
    return;
  }
  if (!r.ok) { await admin.from("messages").update({ status: "failed", error: metaError(r), failed_at: new Date().toISOString() }).eq("id", msgId); return; }
  const waId = r.json?.["messages"]?.[0]?.id;
  await admin.from("messages").update({ status: "accepted", wa_message_id: waId, error: null }).eq("id", msgId);
  if (waId) await admin.rpc("wa_apply_statuses", { _wa_id: waId });
}

async function buildPayload(admin: any, row: any, to: string) {
  if (row.type === "template") return { messaging_product: "whatsapp", to, type: "template", template: row.media_mime ? JSON.parse(row.media_mime) : { name: row.template_name } };
  if (row.type === "image") {
    const s = await admin.storage.from("whatsapp-media").createSignedUrl(row.media_path, 3600);
    if (s.error) throw new Error(s.error.message);
    return { messaging_product: "whatsapp", to, type: "image", image: { link: s.data.signedUrl, ...(row.body ? { caption: row.body } : {}) } };
  }
  return { messaging_product: "whatsapp", to, type: "text", text: { body: row.body } };
}

export const sendMessage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(sendSchema)
  .handler(async ({ data, context }) => {
    await requirePerm(context.supabase, data.storeId, "attend_chats");
    const conv = await context.supabase.from("conversations").select("id,store_id,phone,last_inbound_at").eq("id", data.conversationId).eq("store_id", data.storeId).maybeSingle();
    if (conv.error || !conv.data) throw new Error("Conversa não encontrada nesta loja.");
    const { admin, gw, metaError } = await deps();
    const connection = await admin.from("whatsapp_connections").select("id").eq("store_id", data.storeId).maybeSingle();
    if (!connection.data) throw new Error("WhatsApp não conectado nesta loja.");
    const existing = await admin.from("messages").select("id,status").eq("client_token", data.clientToken).maybeSingle();
    if (existing.data) return { id: existing.data.id, duplicate: true };
    const open = conv.data.last_inbound_at && Date.now() - new Date(conv.data.last_inbound_at).getTime() < 86_400_000;
    if (!data.template && !open) throw new Error("Fora da janela de 24 horas: use um modelo aprovado pela Meta.");

    const id = crypto.randomUUID();
    const row: Record<string, unknown> = { id, store_id: data.storeId, conversation_id: conv.data.id, direction: "out", client_token: data.clientToken, sent_by: context.userId, status: "pending" };
    if (data.template) {
      const tpl = { name: data.template.name, language: { code: data.template.language }, ...(data.template.params.length ? { components: [{ type: "body", parameters: data.template.params.map((t) => ({ type: "text", text: t })) }] } : {}) };
      Object.assign(row, { type: "template", template_name: data.template.name, body: `Modelo: ${data.template.name}${data.template.params.length ? ` (${data.template.params.join(", ")})` : ""}`, media_mime: JSON.stringify(tpl) });
    } else if (data.image) {
      const bytes = Uint8Array.from(atob(data.image.base64), (c) => c.charCodeAt(0));
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Imagem acima de 5 MB.");
      const path = `${data.storeId}/${conv.data.id}/out-${id}.${data.image.mime === "image/png" ? "png" : "jpg"}`;
      const up = await admin.storage.from("whatsapp-media").upload(path, bytes, { contentType: data.image.mime });
      if (up.error) throw new Error(up.error.message);
      Object.assign(row, { type: "image", media_path: path, body: data.image.caption ?? null });
    } else if (data.text) Object.assign(row, { type: "text", body: data.text });
    else throw new Error("Mensagem vazia.");

    const ins = await admin.from("messages").insert(row);
    if (ins.error) {
      const again = await admin.from("messages").select("id").eq("client_token", data.clientToken).maybeSingle();
      if (again.data) return { id: again.data.id, duplicate: true };
      throw new Error(ins.error.message);
    }
    const now = new Date().toISOString();
    await admin.from("conversations").update({ last_message_at: now, last_message_preview: String(row["body"] ?? "[imagem]").slice(0, 120), unread_count: 0 }).eq("id", conv.data.id);
    const stored = await admin.from("messages").select("*").eq("id", id).single();
    await dispatch(admin, gw, metaError, id, await buildPayload(admin, stored.data, conv.data.phone));
    return { id, duplicate: false };
  });

/** Retries only a definitively failed send; the atomic status flip prevents double retries. */
export const retryMessage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ storeId: z.string().uuid(), messageId: z.string().uuid(), confirmUncertain: z.boolean().default(false) }))
  .handler(async ({ data, context }) => {
    await requirePerm(context.supabase, data.storeId, "attend_chats");
    const { admin, gw, metaError } = await deps();
    const allowed = data.confirmUncertain ? ["failed", "unknown"] : ["failed"];
    const claim = await admin.from("messages").update({ status: "pending", error: null, failed_at: null, wa_message_id: null })
      .eq("id", data.messageId).eq("store_id", data.storeId).eq("direction", "out").in("status", allowed).select("*").maybeSingle();
    if (claim.error) throw new Error(claim.error.message);
    if (!claim.data) throw new Error("Esta mensagem não está mais em falha (talvez já tenha sido reenviada).");
    const conv = await admin.from("conversations").select("phone").eq("id", claim.data.conversation_id).single();
    await dispatch(admin, gw, metaError, data.messageId, await buildPayload(admin, claim.data, conv.data.phone));
    return { ok: true };
  });

export const mediaUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ storeId: z.string().uuid(), messageId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await requirePerm(context.supabase, data.storeId, "attend_chats");
    const m = await context.supabase.from("messages").select("id,store_id,conversation_id,media_id,media_path").eq("id", data.messageId).eq("store_id", data.storeId).maybeSingle();
    if (m.error || !m.data) throw new Error("Anexo não encontrado nesta loja.");
    const { admin, storeInboundMedia } = await deps();
    let path = m.data.media_path;
    if (!path && m.data.media_id) {
      await storeInboundMedia(admin, m.data as any);
      path = (await admin.from("messages").select("media_path").eq("id", m.data.id).single()).data?.media_path;
    }
    if (!path) throw new Error("Anexo indisponível.");
    const s = await admin.storage.from("whatsapp-media").createSignedUrl(path, 600);
    if (s.error) throw new Error(s.error.message);
    return { url: s.data.signedUrl as string };
  });
