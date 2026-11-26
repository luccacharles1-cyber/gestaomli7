import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { endAccountSession } from "@/lib/account-auth";

export const Route = createFileRoute("/convite/$token")({
  head: () => ({
    meta: [
      { title: "Convite — MLI Gestão" },
      { name: "description", content: "Aceite o convite para entrar na loja." },
      { property: "og:title", content: "Convite — MLI Gestão" },
      { property: "og:description", content: "Aceite o convite para entrar na loja." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InvitePage,
});

type InviteInfo = {
  status: "valid" | "used" | "revoked" | "expired" | "other_email" | "not_found";
  store_name?: string;
  role?: "owner" | "manager" | "seller";
  email?: string | null;
};

const STATUS_TEXT: Record<Exclude<InviteInfo["status"], "valid" | "other_email">, string> = {
  not_found: "Este link de convite é inválido.",
  used: "Este convite já foi utilizado.",
  revoked: "Este convite foi revogado pelo responsável da loja.",
  expired: "Este convite venceu. Peça um novo ao responsável da loja.",
};

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: session, isLoading: loadingSession } = useQuery({
    queryKey: ["invite-session"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: invite, isLoading: loadingInvite } = useQuery({
    queryKey: ["invite", token, session?.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_invite_by_token", { _token: token });
      if (error) throw error;
      return data as unknown as InviteInfo;
    },
  });

  async function accept() {
    if (busy) return;
    setBusy(true);
    const { data: storeId, error } = await supabase.rpc("accept_invite", { _token: token });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (storeId) localStorage.setItem("mli.store", storeId);
    sessionStorage.removeItem("mli.auth.redirect");
    toast.success("Convite aceito. Bem-vindo à loja!");
    await qc.invalidateQueries({ queryKey: ["session-bootstrap"] });
    navigate({ to: "/app" });
  }

  async function switchAccount() {
    try {
      await endAccountSession(qc, () => supabase.auth.signOut({ scope: "local" }), () => {
        localStorage.removeItem("mli.store");
        sessionStorage.removeItem("mli.auth.recovery");
        sessionStorage.setItem("mli.auth.redirect", `/convite/${token}`);
      }, () => navigate({ to: "/auth", search: { redirect: `/convite/${token}` }, replace: true }));
    } catch { toast.error("Não foi possível sair. Tente novamente."); }
  }

  let body: React.ReactNode;
  if (loadingSession) {
    body = <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
  } else if (!session) {
    body = (
      <>
        <h1 className="text-xl font-semibold">Você recebeu um convite</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Entre ou crie sua conta com o e-mail que recebeu o convite para continuar.
        </p>
        <Button className="mt-6 w-full" onClick={() => navigate({ to: "/auth", search: { redirect: `/convite/${token}` } })}>
          Entrar ou criar conta
        </Button>
      </>
    );
  } else if (loadingInvite || !invite) {
    body = <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
  } else if (invite.status === "valid") {
    body = (
      <>
        <h1 className="text-xl font-semibold">Convite para {invite.store_name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Você foi convidado como <strong>{invite.role ? ROLE_LABEL[invite.role] : ""}</strong> com o e-mail <strong>{invite.email}</strong>.
        </p>
        {!session.email_confirmed_at && <p className="mt-4 text-sm text-muted-foreground">Confirme sua conta pelo link enviado ao seu e-mail e volte a este convite. Você ainda não faz parte da loja.</p>}
        <Button className="mt-6 w-full" disabled={busy || !session.email_confirmed_at} onClick={accept}>{busy ? "Aceitando…" : "Aceitar convite"}</Button>
        <Button type="button" variant="link" className="mt-3 w-full text-muted-foreground" onClick={switchAccount}>
          Não é você? Entrar com outra conta
        </Button>
      </>
    );
  } else if (invite.status === "other_email") {
    body = (
      <>
        <h1 className="text-xl font-semibold">Convite para outro e-mail</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Este convite foi criado para outro endereço de e-mail. Saia e entre com a conta que recebeu o convite.
        </p>
        <Button className="mt-6 w-full" variant="outline" onClick={switchAccount}>Sair e trocar de conta</Button>
      </>
    );
  } else {
    body = (
      <>
        <h1 className="text-xl font-semibold">Convite indisponível</h1>
        <p className="mt-2 text-sm text-muted-foreground">{STATUS_TEXT[invite.status]}</p>
        <Link to="/app" className="mt-6 inline-block text-sm underline">Ir para o início</Link>
      </>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center">{body}</div>
    </div>
  );
}
