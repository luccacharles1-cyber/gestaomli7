import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, BookmarkMinus, BookmarkPlus, ImagePlus, Pencil, ShoppingCart, Star, Trash2, ImageOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";
import { STATUS_LABEL, STATUS_VARIANT, daysInStock } from "@/lib/devices";
import { formatBRL } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { BUCKET, signedUrls } from "@/lib/storage";
import { DeviceForm } from "@/components/app/DeviceForm";
import { ShareDialog } from "@/components/app/ShareDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/app/estoque/$id")({
  head: () => ({ meta: [{ title: "Aparelho — MLI Gestão" }, { name: "description", content: "Ficha do aparelho." }, { property: "og:title", content: "Aparelho — MLI Gestão" }, { property: "og:description", content: "Ficha do aparelho." }] }),
  component: DevicePage,
});

function DevicePage() {
  const { id } = Route.useParams();
  const { store, perms } = useStore();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [current, setCurrent] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const key = ["device", id];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [d, c, p, m] = await Promise.all([
        supabase.from("devices").select("*").eq("id", id).eq("store_id", store.id).maybeSingle(),
        perms.viewCosts ? supabase.from("device_costs").select("*").eq("device_id", id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from("device_photos").select("*").eq("device_id", id).order("position").order("created_at"),
        supabase.from("device_movements").select("*").eq("device_id", id).order("created_at", { ascending: false }),
      ]);
      if (d.error) throw d.error;
      const urls = await signedUrls((p.data ?? []).map((x) => x.path));
      return {
        device: d.data,
        costs: c.data,
        photos: (p.data ?? []).map((x) => ({ ...x, url: urls[x.path] })).filter((x): x is typeof x & { url: string } => !!x.url),
        movements: m.data ?? [],
      };
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["devices"] });
  };

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      let pos = (data?.photos.at(-1)?.position ?? -1) + 1;
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) { toast.error(`${file.name} não é uma imagem.`); continue; }
        if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name} passa de 10 MB.`); continue; }
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${store.id}/devices/${id}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
        if (up.error) throw up.error;
        const ins = await supabase.from("device_photos").insert({ store_id: store.id, device_id: id, path, position: pos++ });
        if (ins.error) { await supabase.storage.from(BUCKET).remove([path]); throw ins.error; }
      }
      toast.success("Fotos enviadas.");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no envio.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePhoto(photo: { id: string; path: string }) {
    const { error } = await supabase.from("device_photos").delete().eq("id", photo.id);
    if (error) { toast.error(error.message); return; }
    await supabase.storage.from(BUCKET).remove([photo.path]);
    setCurrent(0);
    refresh();
  }

  async function reserve(reserveFlag: boolean) {
    const { error } = await supabase.rpc("set_device_reservation", { _device_id: id, _reserve: reserveFlag });
    if (error) { toast.error(error.message); return; }
    toast.success(reserveFlag ? "Aparelho reservado." : "Reserva liberada.");
    refresh();
  }

  async function makeMain(photoId: string) {
    const min = Math.min(...(data?.photos ?? []).map((p) => p.position));
    const { error } = await supabase.from("device_photos").update({ position: min - 1 }).eq("id", photoId);
    if (error) { toast.error(error.message); return; }
    setCurrent(0);
    refresh();
  }

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (error) return <p className="text-destructive">Erro ao carregar o aparelho.</p>;
  if (!data?.device) return <p>Aparelho não encontrado. <Link to="/app/estoque" className="underline">Voltar ao estoque</Link></p>;
  const d = data.device;

  if (editing)
    return (
      <div className="mx-auto max-w-4xl">
        <Button variant="ghost" className="mb-4" onClick={() => setEditing(false)}><ArrowLeft className="mr-1 h-4 w-4" />Cancelar edição</Button>
        <DeviceForm device={d} costs={data.costs} onSaved={() => { setEditing(false); refresh(); }} />
      </div>
    );

  const photo = data.photos[current];
  const info: Array<[string, string | number | null | undefined]> = [
    ["IMEI 1", d.imei1], ["IMEI 2", d.imei2], ["Número de série", d.serial_number], ["Código interno", d.internal_code],
    ["Condição", d.condition === "novo" ? "Novo" : "Seminovo"], ["Conservação", d.conservation],
    ["Bateria", d.battery_health != null ? `${d.battery_health}%` : null], ["Peças substituídas", d.replaced_parts],
    ["Defeitos", d.defects], ["Localização", d.location], ["Origem", d.origin_name],
    ["Aquisição", formatDate(d.acquired_at)], ["Tempo em estoque", `${daysInStock(d.acquired_at, d.created_at)} dias`],
    ["Preço mínimo", d.min_price != null ? formatBRL(d.min_price) : null],
  ];
  const checks = Object.entries((d.test_checklist ?? {}) as Record<string, boolean>).filter(([, v]) => v).map(([k]) => k);

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/app/estoque" className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />Estoque</Link>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="aspect-[4/3] overflow-hidden rounded-xl border bg-muted">
            {photo ? <img src={photo.url} alt={d.model} className="h-full w-full object-contain" /> : (
              <div className="grid h-full place-items-center text-muted-foreground"><div className="text-center"><ImageOff className="mx-auto h-8 w-8" /><p className="mt-2 text-sm">Sem fotos</p></div></div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.photos.map((p, i) => (
              <div key={p.id} className="group relative">
                <button onClick={() => setCurrent(i)} className={`h-16 w-16 overflow-hidden rounded-md border-2 ${i === current ? "border-gold" : "border-transparent"}`}>
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                </button>
                {perms.manageInventory && (
                  <div className="absolute -right-1 -top-1 hidden gap-0.5 group-hover:flex">
                    {i !== 0 && <button title="Definir como principal" onClick={() => makeMain(p.id)} className="rounded bg-background p-0.5 shadow"><Star className="h-3 w-3" /></button>}
                    <button title="Excluir foto" onClick={() => removePhoto(p)} className="rounded bg-background p-0.5 text-destructive shadow"><Trash2 className="h-3 w-3" /></button>
                  </div>
                )}
              </div>
            ))}
            {perms.manageInventory && (
              <>
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading} className="grid h-16 w-16 place-items-center rounded-md border border-dashed text-muted-foreground hover:bg-muted" aria-label="Adicionar fotos">
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold">{d.model} {d.storage}</h1>
              <p className="text-sm text-muted-foreground">{[d.brand, d.color].filter(Boolean).join(" · ")}</p>
            </div>
            <Badge variant="secondary" className={STATUS_VARIANT[d.status]}>{STATUS_LABEL[d.status]}</Badge>
          </div>
          <p className="font-display text-3xl font-semibold">{d.sale_price != null ? formatBRL(d.sale_price) : "Sem preço"}</p>
          <div className="flex flex-wrap gap-2">
            <ShareDialog device={d} photos={data.photos} />
            {perms.registerSales && (d.status === "disponivel" || d.status === "reservado") && (
              <Button asChild><Link to="/app/vendas/nova" search={{ device: d.id }}><ShoppingCart className="mr-1 h-4 w-4" />Vender</Link></Button>
            )}
            {perms.registerSales && d.status === "disponivel" && (
              <Button variant="outline" onClick={() => reserve(true)}><BookmarkPlus className="mr-1 h-4 w-4" />Reservar</Button>
            )}
            {perms.registerSales && d.status === "reservado" && (
              <Button variant="outline" onClick={() => reserve(false)}><BookmarkMinus className="mr-1 h-4 w-4" />Liberar reserva</Button>
            )}
            {perms.manageInventory && <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="mr-1 h-4 w-4" />Editar</Button>}
          </div>

          {perms.viewCosts && (
            <div className="rounded-xl border border-gold/30 bg-gold-soft p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gold-foreground/70">Interno · custos</p>
              {data.costs ? (
                <div className="mt-2 grid grid-cols-2 gap-1 text-sm">
                  <span>Compra</span><span className="text-right">{formatBRL(data.costs.purchase_cost)}</span>
                  <span>Frete</span><span className="text-right">{formatBRL(data.costs.freight_cost)}</span>
                  <span>Outros</span><span className="text-right">{formatBRL(data.costs.other_costs)}</span>
                  <span className="font-semibold">Custo total</span><span className="text-right font-semibold">{formatBRL(data.costs.total_cost)}</span>
                </div>
              ) : <p className="mt-2 text-sm">Custo não informado.</p>}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border bg-card p-4 text-sm">
            {info.filter(([, v]) => v != null && v !== "").map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-all text-right">{v}</dd></div>
            ))}
          </dl>
          {checks.length > 0 && (
            <div className="rounded-xl border bg-card p-4 text-sm">
              <p className="mb-2 font-semibold">Testes aprovados</p>
              <div className="flex flex-wrap gap-1">{checks.map((c) => <Badge key={c} variant="outline">{c}</Badge>)}</div>
            </div>
          )}
          {d.notes && <div className="rounded-xl border bg-card p-4 text-sm"><p className="mb-1 font-semibold">Observações internas</p><p className="whitespace-pre-wrap text-muted-foreground">{d.notes}</p></div>}
          <div className="rounded-xl border bg-card p-4 text-sm">
            <p className="mb-2 font-semibold">Histórico de movimentações</p>
            <ul className="space-y-1">
              {data.movements.map((m) => (
                <li key={m.id} className="flex justify-between gap-2">
                  <span>{m.from_status ? `${STATUS_LABEL[m.from_status]} → ` : ""}{STATUS_LABEL[m.to_status]}{m.note ? ` (${m.note})` : ""}</span>
                  <span className="text-muted-foreground">{formatDateTime(m.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
