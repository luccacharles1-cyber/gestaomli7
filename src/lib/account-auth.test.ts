import { describe, expect, it, vi } from "vitest";
import { endAccountSession, passwordLogin, safeAccountRedirect } from "./account-auth";

describe("Account authentication", () => {
  it("does not authenticate with only an email", async () => {
    const signIn = vi.fn();
    expect((await passwordLogin("person@example.com", "", signIn)).error).not.toBeNull();
    expect(signIn).not.toHaveBeenCalled();
  });
  it("passes the password to the existing authentication service", async () => {
    const signIn = vi.fn().mockResolvedValue({ error: null });
    await passwordLogin(" person@example.com ", "correct-password", signIn);
    expect(signIn).toHaveBeenCalledWith({ email: "person@example.com", password: "correct-password" });
  });
  it("propagates rejection of an incorrect password", async () => {
    const signIn = vi.fn().mockResolvedValue({ error: { message: "Invalid login credentials" } });
    expect((await passwordLogin("person@example.com", "incorrect", signIn)).error?.message).toBe("Invalid login credentials");
  });
  it("preserves the invite return path", () => {
    expect(safeAccountRedirect("/convite/token-123")).toBe("/convite/token-123");
  });
  it("rejects off-site return addresses", () => {
    for (const path of ["//outside.example", "/\\outside.example", "https://outside.example", "/\n/outside.example"]) expect(safeAccountRedirect(path)).toBeUndefined();
  });
  it("cancels requests and clears account cache before sign-out and returning to login", async () => {
    const order: string[] = [];
    await endAccountSession({ cancelQueries: async () => { order.push("cancel"); }, clear: () => { order.push("cache"); } }, async () => { order.push("signout"); return { error: null }; }, () => { order.push("storage"); }, () => { order.push("login"); });
    expect(order).toEqual(["cancel", "cache", "signout", "storage", "login"]);
  });
  it("does not report a successful logout when authentication refuses it", async () => {
    const login = vi.fn();
    await expect(endAccountSession({ cancelQueries: async () => {}, clear: () => {} }, async () => ({ error: { message: "unavailable" } }), vi.fn(), login)).rejects.toThrow("unavailable");
    expect(login).not.toHaveBeenCalled();
  });
});