import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Home, Boxes, ShoppingCart, Users, ClipboardCheck, Wallet, BarChart3, FileText, Truck, Settings, LogOut, Menu, Loader2,
  MessageCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StoreContext, permsFor, ROLE_LABEL, type StoreCtx } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { NotificationsBell } from "@/components/app/NotificationsBell";
import { accessBlocked, BILLING_LABEL } from "@/lib/platform";
import { formatDate } from "@/lib/format";
import { AccountMenu } from "@/components/app/AccountMenu";
import { endAccountSession } from "@/lib/account-auth";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({
    meta: [
      { title: "Painel — MLI Gestão" },
      { name: "description", content: "Painel de gestão da sua loja." },
      { property: "og:title", content: "Painel — MLI Gestão" },
      { property: "og:description", content: "Painel de gestão da sua loja." },
      { name: "robots", content: "noindex" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AppLayout,
});

const NAV = [
  { to: "/app", label: "Início", icon: Home, exact: true },
  { to: "/app/estoque", label: "Estoque", icon: Boxes },
  { to: "/app/vendas", label: "Vendas", icon: ShoppingCart },
  { to: "/app/clientes", label: "Clientes e CRM", icon: Users },
  { to: "/app/atendimento", label: "Atendimento", icon: MessageCircle },
  { to: "/app/avaliacao", label: "Avaliação de usados", icon: ClipboardCheck },
  { to: "/app/financeiro", label: "Financeiro", icon: Wallet },
  { to: "/app/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/app/documentos", label: "Documentos", icon: FileText },
  { to: "/app/fornecedores", label: "Fornecedores", icon: Truck },
  { to: "/app/configuracoes", label: "Configurações", icon: Settings },
] as const;

const MOBILE_NAV = [NAV[0], NAV[1], NAV[2], NAV[3]];

function useSession() {
  return useQuery({
    queryKey: ["session-bootstrap"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sem sessão");
      await supabase.rpc("accept_my_invites");
      const [{ data: members, error }, { data: roles }] = await Promise.all([
        supabase.from("store_members").select("*, stores(*)").eq("user_id", u.user.id).order("created_at"),
        supabase.from("user_roles").select("role").eq("user_id", u.user.id),
      ]);
      if (error) throw error;
      return {
        user: u.user,
        memberships: (members ?? []).flatMap((m) => m.stores ? [{ member: m, store: m.stores }] : []),
        isAdmin: (roles ?? []).some((r) => r.role === "admin"),
      };
    },
  });
}

function AppLayout() {
  const { data, isLoading, error, refetch } = useSession();
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setSelected(localStorage.getItem("mli.store"));
  }, []);

  const ctx = useMemo<StoreCtx | null>(() => {
    if (!data || data.memberships.length === 0) return null;
    const pick = data.memberships.find((x) => x.store.id === selected) ?? data.memberships[0];
    if (!pick) return null;
    const _m = pick.member, _s = pick.store;
    return {
      store: _s,
      member: _m,
      perms: permsFor(_m),
      stores: data.memberships.map(({ member, store }) => ({ member, store })),
      selectStore: (id) => {
        localStorage.setItem("mli.store", id);
        setSelected(id);
      },
      userId: data.user.id,
      email: data.user.email ?? null,
      isPlatformAdmin: data.isAdmin,
    };
  }, [data, selected]);

  if (isLoading)
    return (
      <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    );
  if (error)
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p className="font-semibold">Não foi possível carregar sua conta.</p>
          <Button className="mt-4" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      </div>
    );
  if (!ctx) return <Onboarding email={data?.user.email ?? ""} />;

  return (
    <StoreContext.Provider value={ctx}>
      <Shell ctx={ctx} />
    </StoreContext.Provider>
  );
}

function Shell({ ctx }: { ctx: StoreCtx }) {
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setOpen(false), [path]);
  const { data: sub } = useQuery({
    queryKey: ["store-access", ctx.store.id],
    queryFn: async () => (await supabase.from("store_subscriptions").select("access_status, billing_status, access_until, access_reason").eq("store_id", ctx.store.id).maybeSingle()).data,
  });
  const blocked = accessBlocked(sub);

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <SidebarContent ctx={ctx} path={path} />
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="flex h-full flex-col"><SidebarContent ctx={ctx} path={path} /></div>
        </SheetContent>
      </Sheet>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm font-semibold">{ctx.store.name}</p>
            <p className="truncate text-xs text-muted-foreground">{ROLE_LABEL[ctx.member.role]} · {ctx.email}</p>
          </div>
          {ctx.member.role === "owner" && <NotificationsBell storeId={ctx.store.id} userId={ctx.userId} />}
          <AccountMenu email={ctx.email} />
        </header>
        <main className="px-4 pb-24 pt-6 lg:px-8 lg:pb-10">
          {blocked ? (
            <div className="mx-auto max-w-lg rounded-xl border bg-card p-6">
              <h1 className="text-lg font-semibold">Acesso da loja suspenso</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {sub?.access_status === "suspended" ? "O acesso a esta loja foi suspenso pela administração da plataforma." : `O período de ${BILLING_LABEL[sub?.billing_status ?? ""]?.toLowerCase()} terminou em ${formatDate(sub?.access_until)}.`}
                {" "}Seus dados continuam guardados e voltam a ficar disponíveis após a regularização.
              </p>
              <p className="mt-3 text-sm">Situação da cobrança: {BILLING_LABEL[sub?.billing_status ?? "none"]}</p>
              <p className="mt-3 text-sm text-muted-foreground">Pagamento online: integração pendente. Para regularizar, fale com o suporte da plataforma.</p>
            </div>
          ) : <Outlet />}
        </main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t bg-background lg:hidden">
        {MOBILE_NAV.map((n) => {
          const active = "exact" in n ? path === n.to : path.startsWith(n.to);
          return (
            <Link key={n.to} to={n.to} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-foreground" : "text-muted-foreground")}>
              <n.icon className={cn("h-5 w-5", active && "text-gold")} />
              {n.label.split(" ")[0]}
            </Link>
          );
        })}
        <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground">
          <Menu className="h-5 w-5" />Mais
        </button>
      </nav>
    </div>
  );
}

function SidebarContent({ ctx, path }: { ctx: StoreCtx; path: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <>
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-sidebar-accent font-display text-sm font-bold text-gold">M</span>
        <span className="font-display font-semibold text-sidebar-accent-foreground">MLI Gestão</span>
      </div>
      {ctx.stores.length > 1 && (
        <div className="px-4 pb-3">
          <Select value={ctx.store.id} onValueChange={ctx.selectStore}>
            <SelectTrigger className="border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ctx.stores.map((s) => <SelectItem key={s.store.id} value={s.store.id}>{s.store.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {NAV.map((n) => {
          const active = "exact" in n ? path === n.to : path.startsWith(n.to);
          return (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60",
              )}
            >
              <n.icon className={cn("h-4 w-4", active ? "text-sidebar-primary" : "opacity-70")} />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <button onClick={signOut} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent/60">
          <LogOut className="h-4 w-4 opacity-70" />Sair
        </button>
      </div>
    </>
  );
}

function Onboarding({ email }: { email: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("create_store", { _name: name });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    localStorage.setItem("mli.store", data);
    toast.success("Loja criada.");
    await qc.invalidateQueries({ queryKey: ["session-bootstrap"] });
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-6">
      <div className="absolute right-4 top-4"><AccountMenu email={email} /></div>
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border bg-card p-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-gold">Primeiro acesso</p>
        <h1 className="mt-2 text-2xl font-semibold">Crie sua loja</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Você será o proprietário. Se foi convidado por uma loja, peça ao responsável para enviar o convite para <strong>{email}</strong> e entre novamente.
        </p>
        <div className="mt-6 space-y-1.5">
          <Label htmlFor="sn">Nome da loja</Label>
          <Input id="sn" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Prime iPhones" />
        </div>
        <Button className="mt-6 w-full" disabled={busy || !name.trim()}>{busy ? "Criando…" : "Criar loja"}</Button>
        <button
          type="button"
          className="mt-3 w-full text-sm text-muted-foreground hover:underline"
          onClick={async () => {
            try {
              await endAccountSession(qc, () => supabase.auth.signOut({ scope: "local" }), () => {
                localStorage.removeItem("mli.store");
                sessionStorage.removeItem("mli.auth.redirect");
              }, () => navigate({ to: "/auth", replace: true }));
            } catch { toast.error("Não foi possível sair da conta. Tente novamente."); }
          }}
        >
          Sair
        </button>
      </form>
    </div>
  );
}
