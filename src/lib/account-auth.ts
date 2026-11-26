import type { QueryClient } from "@tanstack/react-query";

export function safeAccountRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return undefined;
  return value;
}

export async function passwordLogin(
  email: string,
  password: string,
  signIn: (credentials: { email: string; password: string }) => Promise<{ error: { message: string } | null }>,
) {
  if (!email.trim() || !password) return { error: { message: "Informe seu e-mail e sua senha." } };
  return signIn({ email: email.trim(), password });
}

export async function endAccountSession(
  queryClient: Pick<QueryClient, "cancelQueries" | "clear">,
  signOut: () => Promise<{ error: { message: string } | null }>,
  clearLocalAccount: () => void,
  returnToLogin: () => void | Promise<unknown>,
) {
  await queryClient.cancelQueries();
  queryClient.clear();
  const { error } = await signOut();
  if (error) throw new Error(error.message);
  clearLocalAccount();
  await returnToLogin();
}