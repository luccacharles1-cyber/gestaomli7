import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { endAccountSession } from "@/lib/account-auth";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem } from "@/components/ui/dropdown-menu";

export function AccountMenu({ email }: { email?: string | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await endAccountSession(queryClient, () => supabase.auth.signOut({ scope: "local" }), () => {
        localStorage.removeItem("mli.store");
        sessionStorage.removeItem("mli.auth.redirect");
        sessionStorage.removeItem("mli.auth.recovery");
      }, () => navigate({ to: "/auth", replace: true }));
    } catch {
      toast.error("Não foi possível sair da conta. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Menu do perfil" title="Menu do perfil" disabled={busy}><UserRound className="h-5 w-5" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
      <DropdownMenuLabel className="max-w-64 break-all">{email ?? "Minha conta"}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={busy} onSelect={() => void logout()}><LogOut />Sair da conta</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}