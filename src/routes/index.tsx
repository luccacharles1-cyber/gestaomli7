import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Smartphone, ShieldCheck, Share2, BarChart3 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MLI Gestão — Gestão para lojas de iPhone" },
      { name: "description", content: "Controle aparelhos por IMEI, fotos reais, equipe e resultados da sua loja de iPhone." },
      { property: "og:title", content: "MLI Gestão — Gestão para lojas de iPhone" },
      { property: "og:description", content: "Controle aparelhos por IMEI, fotos reais, equipe e resultados da sua loja de iPhone." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const features = [
  { icon: Smartphone, title: "Estoque por IMEI", text: "Cada aparelho com ficha completa, status e histórico." },
  { icon: Share2, title: "Fotos reais", text: "Compartilhe só as fotos da unidade, sem expor custos." },
  { icon: ShieldCheck, title: "Dados isolados", text: "Cada loja enxerga apenas os próprios dados." },
  { icon: BarChart3, title: "Resultados", text: "Indicadores claros do que já está registrado." },
];

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary font-display text-sm font-bold text-gold">M</span>
          <span className="font-display text-lg font-semibold">MLI Gestão</span>
        </div>
        <Button asChild variant="outline">
          <Link to="/auth">Entrar</Link>
        </Button>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-12 md:pt-24">
        <p className="text-sm font-semibold uppercase tracking-widest text-gold">Para revendedores e lojas de iPhone</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight md:text-6xl">
          A gestão da sua loja, aparelho por aparelho.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Estoque por IMEI, fotos reais para enviar ao cliente, equipe com permissões e indicadores confiáveis.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/auth">Criar minha loja</Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link to="/auth">Já tenho conta</Link>
          </Button>
        </div>
        <div className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6">
              <f.icon className="h-5 w-5 text-gold" />
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
