import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeAccountRedirect } from "@/lib/account-auth";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({ redirect: safeAccountRedirect(search["redirect"]) }),
  head: () => ({
    meta: [
      { title: "Nova senha — MLI Gestão" },
      { name: "description", content: "Defina uma nova senha para sua conta MLI Gestão." },
      { property: "og:title", content: "Nova senha — MLI Gestão" },
      { property: "og:description", content: "Defina uma nova senha para sua conta MLI Gestão." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [validRecovery, setValidRecovery] = useState(false);
  const { redirect } = Route.useSearch();

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const recovery = hash.get("type") === "recovery" || sessionStorage.getItem("mli.auth.recovery") === "true";
    if (!recovery) return;
    supabase.auth.getUser().then(({ data, error }) => setValidRecovery(!error && !!data.user));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!validRecovery || busy) return;
    if (password.length < 8) { toast.error("A senha deve ter pelo menos 8 caracteres."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { toast.error("Link inválido ou expirado. Solicite um novo."); return; }
    toast.success("Senha atualizada.");
    sessionStorage.removeItem("mli.auth.recovery");
    navigate({ to: redirect ?? "/app" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Criar nova senha</h1>
        {!validRecovery && <p className="text-sm text-muted-foreground">Abra o link enviado ao seu e-mail para definir a senha.</p>}
        <div className="space-y-1.5">
          <Label htmlFor="np">Nova senha</Label>
          <Input id="np" type="password" autoComplete="new-password" minLength={8} required disabled={!validRecovery} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button className="w-full" disabled={busy || !validRecovery}>Salvar senha</Button>
        {!validRecovery && <Button type="button" variant="link" className="w-full" onClick={() => navigate({ to: "/auth", search: { redirect } })}>Voltar ao login</Button>}
      </form>
    </div>
  );
}
