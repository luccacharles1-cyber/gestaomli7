import { createFileRoute } from "@tanstack/react-router";
import { verifyWebhookRequest } from "@lovable.dev/webhooks-js";

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["WHATSAPP_API_KEY"];
        if (!secret) return new Response("not configured", { status: 503 });
        let payload: unknown;
        try {
          const verified = await verifyWebhookRequest({ req: request, secret, maxBodyBytes: 4 * 1024 * 1024 });
          payload = verified.payload;
        } catch {
          return new Response("invalid signature", { status: 401 });
        }
        const delivery = request.headers.get("X-Lovable-Delivery");
        const event = request.headers.get("X-Lovable-Event");
        if (!delivery || !event) return new Response("missing headers", { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as any;
        const ins = await admin.from("whatsapp_webhook_events").upsert({ delivery_id: delivery, event, payload }, { onConflict: "delivery_id", ignoreDuplicates: true });
        if (ins.error) { console.error("wa inbox", ins.error); return new Response("store failed", { status: 500 }); }
        const r = await admin.rpc("wa_process_event", { _delivery_id: delivery });
        if (r.error) {
          await admin.from("whatsapp_webhook_events").update({ processing_error: r.error.message }).eq("delivery_id", delivery);
          console.error("wa process", r.error);
          return new Response("processing failed", { status: 500 });
        }
        const { recoverPending } = await import("@/lib/whatsapp-gateway.server");
        try { await recoverPending(admin); } catch (e) { console.error("wa recovery", e); }
        return new Response("ok");
      },
    },
  },
});
