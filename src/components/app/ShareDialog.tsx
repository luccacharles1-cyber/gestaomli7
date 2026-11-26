import { useState } from "react";
import { toast } from "sonner";
import { Copy, Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { type Device } from "@/lib/devices";
import { deviceShareText } from "@/lib/device-share";

type Photo = { id: string; url: string; path: string };

/** Shares ONLY the real photos (plus optional commercial text). Never cost, supplier or internal notes. */
export function ShareDialog({ device, photos }: { device: Device; photos: Photo[] }) {
  const [selected, setSelected] = useState<string[]>(() => photos.map((p) => p.id));
  const [withText, setWithText] = useState(true);
  const [withPrice, setWithPrice] = useState(true);
  const [busy, setBusy] = useState(false);

  const { text, omitted } = deviceShareText(device, withText, withPrice);

  async function loadFiles(): Promise<File[]> {
    const chosen = photos.filter((p) => selected.includes(p.id));
    return Promise.all(
      chosen.map(async (p, i) => {
        const res = await fetch(p.url);
        if (!res.ok) throw new Error("Não foi possível carregar uma das fotos. Tente novamente.");
        const blob = await res.blob();
        const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
        return new File([blob], `${device.model.replace(/\s+/g, "-")}-${i + 1}.${ext}`, { type: blob.type || "image/jpeg" });
      }),
    );
  }

  async function share() {
    if (!selected.length) { toast.error("Selecione ao menos uma foto."); return; }
    setBusy(true);
    try {
      const files = await loadFiles();
      const data: ShareData = { files, ...(text ? { text } : {}) };
      if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(data))) {
        await navigator.share(data);
      } else {
        toast.info("Este navegador não permite compartilhar arquivos. Baixando as fotos.");
        download(files);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast.error("Não foi possível compartilhar. Use Baixar fotos e Copiar descrição e preço.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadAll() {
    if (!selected.length) { toast.error("Selecione ao menos uma foto."); return; }
    setBusy(true);
    try {
      download(await loadFiles());
    } catch {
      toast.error("Não foi possível baixar as fotos. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Texto copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie o texto da prévia.");
    }
  }

  function download(files: File[]) {
    for (const f of files) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!photos.length}><Share2 className="mr-1 h-4 w-4" />Compartilhar fotos</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compartilhar fotos</DialogTitle>
          <DialogDescription>Somente as fotos selecionadas são enviadas. Custos e dados internos nunca saem.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => {
            const on = selected.includes(p.id);
            return (
              <Button
                key={p.id}
                type="button"
                variant="ghost"
                aria-label={`Foto ${photos.indexOf(p) + 1}`}
                aria-pressed={on}
                onClick={() => setSelected((s) => (on ? s.filter((x) => x !== p.id) : [...s, p.id]))}
                className={`relative aspect-square h-auto w-full overflow-hidden rounded-md border-2 p-0 ${on ? "border-gold" : "border-transparent opacity-50"}`}
              >
                <img src={p.url} alt="" className="h-full w-full object-cover" />
              </Button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={withText} onCheckedChange={(v) => setWithText(v === true)} />Incluir descrição comercial</label>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={withPrice} onCheckedChange={(v) => setWithPrice(v === true)} />Incluir preço de venda</label>
        <div className="space-y-2" aria-live="polite">
          <p className="text-sm font-medium">Prévia do texto</p>
          <p className="select-text whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm" data-testid="share-text-preview">{text || "Nenhum texto será compartilhado."}</p>
          {omitted.map((notice) => <p key={notice} className="text-xs text-muted-foreground">{notice}</p>)}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={copyText} disabled={busy || !text}><Copy className="mr-1 h-4 w-4" />Copiar descrição e preço</Button>
          <Button type="button" variant="outline" onClick={downloadAll} disabled={busy || !selected.length}><Download className="mr-1 h-4 w-4" />Baixar fotos</Button>
          <Button type="button" onClick={share} disabled={busy || !selected.length}><Share2 className="mr-1 h-4 w-4" />{busy ? "Preparando…" : "Compartilhar"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">O WhatsApp pode receber as fotos sem o texto. Copie o texto para colar como legenda ou mensagem.</p>
      </DialogContent>
    </Dialog>
  );
}
