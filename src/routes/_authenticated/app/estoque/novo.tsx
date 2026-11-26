import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { DeviceForm } from "@/components/app/DeviceForm";
import { PageHeader } from "@/components/app/PageHeader";
import { useStore } from "@/lib/store-context";

export const Route = createFileRoute("/_authenticated/app/estoque/novo")({
  head: () => ({ meta: [{ title: "Cadastrar aparelho — MLI Gestão" }, { name: "description", content: "Cadastre um aparelho no estoque." }, { property: "og:title", content: "Cadastrar aparelho — MLI Gestão" }, { property: "og:description", content: "Cadastre um aparelho no estoque." }] }),
  component: NewDevice,
});

function NewDevice() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { perms } = useStore();
  if (!perms.manageInventory)
    return <p className="text-muted-foreground">Você não tem permissão para cadastrar aparelhos. <Link to="/app/estoque" className="underline">Voltar</Link></p>;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Cadastrar aparelho" subtitle="Após salvar, você poderá adicionar as fotos reais da unidade." />
      <DeviceForm
        onSaved={(id) => {
          qc.invalidateQueries({ queryKey: ["devices"] });
          navigate({ to: "/app/estoque/$id", params: { id } });
        }}
      />
    </div>
  );
}
