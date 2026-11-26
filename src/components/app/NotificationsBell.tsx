import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/format";

type Payload = { seller?: string | null; total?: number; receipt_number?: number; sold_at?: string; items?: string };

export function NotificationsBell({ storeId, userId }: { storeId: string; userId: string }) {
  const qc = useQueryClient();
  const key = ["notifications", storeId, userId];
  const { data = [] } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, sale_id, payload, read_at, created_at, sales(status)")
        .eq("store_id", storeId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`notif-${userId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () =>
        qc.invalidateQueries({ queryKey: ["notifications", storeId, userId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, storeId, userId]);

  const unread = data.filter((n) => !n.read_at).length;
  async function markRead(ids: string[]) {
    if (!ids.length) return;
    await supabase.rpc("mark_notifications_read", { _ids: ids });
    qc.invalidateQueries({ queryKey: key });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notificações${unread ? ` (${unread} não lidas)` : ""}`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">{unread > 99 ? "99+" : unread}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notificações</p>
          {unread > 0 && <button className="text-xs underline" onClick={() => markRead(data.filter((n) => !n.read_at).map((n) => n.id))}>Marcar todas como lidas</button>}
        </div>
        <ul className="max-h-96 divide-y overflow-y-auto">
          {data.length === 0 && <li className="p-4 text-sm text-muted-foreground">Nenhuma notificação.</li>}
          {data.map((n) => {
            const p = n.payload as Payload;
            const cancelled = (n.sales as { status: string } | null)?.status === "cancelada";
            return (
              <li key={n.id} className={n.read_at ? "" : "bg-muted/50"}>
                <Link to="/app/vendas/$id" params={{ id: n.sale_id! }} onClick={() => !n.read_at && markRead([n.id])} className="block space-y-0.5 px-3 py-2 text-sm">
                  <p className="font-medium">Venda nº {p.receipt_number} · {formatBRL(p.total ?? 0)}{cancelled && <span className="ml-1 text-destructive">(cancelada)</span>}</p>
                  {p.items && <p className="line-clamp-2 text-xs text-muted-foreground">{p.items}</p>}
                  <p className="text-xs text-muted-foreground">{p.seller ?? "Vendedor"} · {formatDateTime(p.sold_at ?? n.created_at)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
