import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, Search, ShoppingCart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";
import { PAYMENT_LABEL, SALE_STATUS_LABEL, type Sale } from "@/lib/sales";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/app/vendas")({
  head: () => ({ meta: [{ title: "Vendas — MLI Gestão" }, { name: "description", content: "Vendas, trocas, pagamentos combinados e recibos." }, { property: "og:title", content: "Vendas — MLI Gestão" }, { property: "og:description", content: "Vendas, trocas, pagamentos combinados e recibos." }] }),
  component: Vendas,
});

type SaleRow = Sale & { clients: { name: string } | null; sale_payments: Array<{ method: keyof typeof PAYMENT_LABEL; amount: string | number }> };

function Vendas() {
  const { store, perms } = useStore();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("todas");

  const { data, isLoading, error } = useQuery({
    queryKey: ["sales", store.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, clients(name), sale_payments(method, amount)")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SaleRow[];
    },
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((s) => {
      if (status !== "todas" && s.status !== status) return false;
      if (term) {
        const hay = [s.clients?.name, s.receipt_number?.toString()].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [data, q, status]);

  return (
    <div>
      <PageHeader
        title="Vendas"
        subtitle="Vendas concluídas, trocas e recebimentos."
        actions={perms.registerSales && <Button asChild><Link to="/app/vendas/nova" search={{ device: undefined }}><Plus className="mr-1 h-4 w-4" />Nova venda</Link></Button>}
      />
      <div className="mb-4 grid gap-2 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por cliente ou nº do recibo" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="md:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="concluida">Concluídas</SelectItem>
            <SelectItem value="cancelada">Canceladas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : error ? (
        <p className="text-destructive">Erro ao carregar as vendas.</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-12 text-center">
          <ShoppingCart className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold">{data?.length ? "Nenhuma venda com esses filtros" : "Nenhuma venda registrada"}</p>
          {!data?.length && perms.registerSales && <Button asChild className="mt-4"><Link to="/app/vendas/nova" search={{ device: undefined }}>Registrar a primeira venda</Link></Button>}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <Link key={s.id} to="/app/vendas/$id" params={{ id: s.id }} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 transition-shadow hover:shadow-md">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.clients?.name ?? "Cliente não identificado"}</p>
                <p className="text-xs text-muted-foreground">
                  Recibo nº {s.receipt_number} · {formatDateTime(s.created_at)}
                  {s.sale_payments.length > 0 && ` · ${[...new Set(s.sale_payments.map((p) => PAYMENT_LABEL[p.method]))].join(" + ")}`}
                </p>
              </div>
              {Number(s.balance) > 0 && s.status === "concluida" && (
                <Badge variant="secondary" className="bg-warning/20 text-warning-foreground">Saldo {formatBRL(s.balance)}</Badge>
              )}
              {s.status === "cancelada" && <Badge variant="secondary" className="bg-destructive/10 text-destructive">{SALE_STATUS_LABEL[s.status]}</Badge>}
              <p className="font-display font-semibold">{formatBRL(s.total)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
