import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

// Rota antiga de destaques/concessões: o acesso é restrito a administradores da
// plataforma e redireciona para /admin. Os dados existentes são preservados no banco.
export const Route = createFileRoute("/_authenticated/app/admin")({
  head: () => ({
    meta: [
      { title: "Administração — MLI Gestão" },
      { name: "description", content: "Administração da plataforma." },
      { property: "og:title", content: "Administração — MLI Gestão" },
      { property: "og:description", content: "Administração da plataforma." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LegacyAdminRedirect,
});

function LegacyAdminRedirect() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: isAdmin, isLoading } = useQuery({
    queryKey: ["is-platform-admin"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin");
      return (data ?? []).length > 0;
    },
  });

  if (isLoading) {
    return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (isAdmin) {
    navigate({ to: "/admin", replace: true });
    return null;
  }

  return (
    <div className="mx-auto max-w-md rounded-xl border bg-card p-6 text-center">
      <p className="font-semibold">Acesso restrito à administração da plataforma.</p>
      <p className="mt-2 text-sm text-muted-foreground">Sua conta de loja não tem autorização para esta área.</p>
      <div className="mt-4 flex justify-center gap-3">
        <Link to="/app" className="text-sm underline">Voltar para a loja</Link>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await qc.cancelQueries();
            qc.clear();
            await supabase.auth.signOut();
            navigate({ to: "/auth", search: { redirect: "/admin" }, replace: true });
          }}
        >
          Trocar de conta
        </Button>
      </div>
    </div>
  );
}
