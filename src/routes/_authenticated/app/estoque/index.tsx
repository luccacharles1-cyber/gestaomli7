import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, Search, Smartphone, ImageOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";
import { STATUS_LABEL, STATUS_ORDER, STATUS_VARIANT, STORAGE_OPTIONS, daysInStock } from "@/lib/devices";
import { formatBRL } from "@/lib/money";
import { signedUrls } from "@/lib/storage";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AccessoriesPanel } from "@/components/app/AccessoriesPanel";

export const Route = createFileRoute("/_authenticated/app/estoque/")({
  head: () => ({ meta: [{ title: "Estoque — MLI Gestão" }, { name: "description", content: "Aparelhos e acessórios da loja." }, { property: "og:title", content: "Estoque — MLI Gestão" }, { property: "og:description", content: "Aparelhos e acessórios da loja." },{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"}] }),
  component: Estoque,
});


function Estoque() {
  const { store, perms } = useStore();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("ativos");
  const [storage, setStorage] = useState("todos");
  const [condition, setCondition] = useState("todas");
  const [age, setAge] = useState("todos");

  const { data, isLoading, error } = useQuery({
    queryKey: ["devices", store.id],
    queryFn: async () => {
      const [{ data: devices, error }, { data: photos }] = await Promise.all([
        supabase.from("devices").select("*").eq("store_id", store.id).order("created_at", { ascending: false }),
        supabase.from("device_photos").select("device_id, path, position").eq("store_id", store.id).order("position"),
      ]);
      if (error) throw error;
      const main = new Map<string, string>();
      for (const p of photos ?? []) if (!main.has(p.device_id)) main.set(p.device_id, p.path);
      const urls = await signedUrls([...main.values()]);
      return (devices ?? []).map((d) => ({ ...d, photoUrl: main.has(d.id) ? urls[main.get(d.id)!] : null }));
    },
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((d) => {
      if (status === "ativos" ? ["vendido", "devolvido_fornecedor"].includes(d.status) : status !== "todos" && d.status !== status) return false;
      if (storage !== "todos" && d.storage !== storage) return false;
      if (condition !== "todas" && d.condition !== condition) return false;
      const days = daysInStock(d.acquired_at, d.created_at);
      if (age === "30" && days > 30) return false;
      if (age === "30-60" && (days <= 30 || days > 60)) return false;
      if (age === "60" && days <= 60) return false;
      if (term) {
        const hay = [d.model, d.color, d.imei1, d.imei2, d.serial_number, d.internal_code].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [data, q, status, storage, condition, age]);

  return (
    <div>
      <PageHeader
        title="Estoque"
        subtitle="Aparelhos controlados por unidade e acessórios por quantidade."
        actions={perms.manageInventory && <Button asChild><Link to="/app/estoque/novo"><Plus className="mr-1 h-4 w-4" />Cadastrar aparelho</Link></Button>}
      />
      <Tabs defaultValue="aparelhos">
        <TabsList><TabsTrigger value="aparelhos">Aparelhos</TabsTrigger><TabsTrigger value="acessorios">Acessórios</TabsTrigger></TabsList>
        <TabsContent value="aparelhos" className="mt-4">
          <div className="mb-4 grid gap-2 md:grid-cols-[1fr_auto_auto_auto_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Buscar por modelo, IMEI, série ou código" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Filter value={status} onChange={setStatus} options={[["ativos", "Em estoque"], ["todos", "Todos os status"], ...STATUS_ORDER.map((s) => [s, STATUS_LABEL[s]] as [string, string])]} />
            <Filter value={storage} onChange={setStorage} options={[["todos", "Armazenamento"], ...STORAGE_OPTIONS.map((s) => [s, s] as [string, string])]} />
            <Filter value={condition} onChange={setCondition} options={[["todas", "Condição"], ["novo", "Novo"], ["seminovo", "Seminovo"]]} />
            <Filter value={age} onChange={setAge} options={[["todos", "Tempo em estoque"], ["30", "Até 30 dias"], ["30-60", "31 a 60 dias"], ["60", "Mais de 60 dias"]]} />
          </div>

          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-xl" />)}</div>
          ) : error ? (
            <p className="text-destructive">Erro ao carregar o estoque.</p>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card p-12 text-center">
              <Smartphone className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-semibold">{data?.length ? "Nenhum aparelho com esses filtros" : "Nenhum aparelho cadastrado"}</p>
              {!data?.length && perms.manageInventory && <Button asChild className="mt-4"><Link to="/app/estoque/novo">Cadastrar o primeiro</Link></Button>}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {filtered.map((d) => (
                <Link key={d.id} to="/app/estoque/$id" params={{ id: d.id }} className="group overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md">
                  <div className="aspect-[4/3] bg-muted">
                    {d.photoUrl ? <img src={d.photoUrl} alt={d.model} className="h-full w-full object-cover" loading="lazy" /> : (
                      <div className="grid h-full place-items-center text-muted-foreground"><ImageOff className="h-6 w-6" /></div>
                    )}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold leading-tight">{d.model} {d.storage}</p>
                      <Badge className={STATUS_VARIANT[d.status]} variant="secondary">{STATUS_LABEL[d.status]}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[d.color, d.condition === "novo" ? "Novo" : "Seminovo", d.battery_health != null ? `Bateria ${d.battery_health}%` : null].filter(Boolean).join(" · ")}
                    </p>
                    <div className="flex items-center justify-between">
                      <p className="font-display font-semibold">{d.sale_price != null ? formatBRL(d.sale_price) : "Sem preço"}</p>
                      <p className="text-xs text-muted-foreground">{daysInStock(d.acquired_at, d.created_at)} dias</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="acessorios" className="mt-4"><AccessoriesPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function Filter({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="md:w-44"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  );
}
