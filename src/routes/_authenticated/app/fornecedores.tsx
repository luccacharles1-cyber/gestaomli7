import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Lock, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store-context";

export const Route = createFileRoute("/_authenticated/app/fornecedores")({
  head: () => ({ meta: [{ title: "Fornecedores — MLI Gestão" }, { name: "description", content: "Área de fornecedores, liberada por produto adquirido." }, { property: "og:title", content: "Fornecedores — MLI Gestão" }, { property: "og:description", content: "Área de fornecedores, liberada por produto adquirido." }] }),
  component: Fornecedores,
});

function Fornecedores() {
  const { email } = useStore();
  const { data, isLoading } = useQuery({
    queryKey: ["grant", "fornecedores", email],
    queryFn: async () => {
      const { data } = await supabase.from("product_grants").select("id").eq("product", "fornecedores").limit(1);
      return !!data?.length;
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Verificando acesso…</p>;

  return (
    <div className="mx-auto max-w-2xl py-6">
      <h1 className="text-2xl font-semibold">Fornecedores</h1>
      {data ? (
        <div className="mt-6 rounded-xl border bg-card p-8">
          <CheckCircle2 className="h-6 w-6 text-success" />
          <p className="mt-3 font-semibold">Seu acesso está liberado.</p>
          <p className="mt-1 text-sm text-muted-foreground">A lista de contatos está sendo organizada e será publicada aqui pela equipe MLI.</p>
        </div>
      ) : (
        <div className="mt-6 rounded-xl border bg-card p-8">
          <Lock className="h-6 w-6 text-gold" />
          <p className="mt-3 font-semibold">Área exclusiva para quem adquiriu o acesso aos fornecedores</p>
          <p className="mt-2 text-sm text-muted-foreground">
            A assinatura da gestão não inclui esta área. Ela reúne contatos de fornecedores para quem tem a compra validada.
            Se você já comprou, fale com a equipe MLI informando o e-mail <strong>{email}</strong> para liberação.
          </p>
        </div>
      )}
    </div>
  );
}
