import { describe, expect, it } from "vitest";
import { buildInviteLink, isRestrictedPreview } from "./invite-link";

describe("Invitation address", () => {
  const preview = "https://id-preview--project.lovable.app";
  it("prefers the public published address over the restricted preview", () => {
    expect(buildInviteLink("token-123", preview, "https://mli.example.com/")).toBe("https://mli.example.com/convite/token-123");
  });
  it("uses the current published address when no separate address is configured", () => {
    expect(buildInviteLink("token-123", "https://mli.example.com")).toBe("https://mli.example.com/convite/token-123");
  });
  it("does not invent a public URL before publication", () => {
    expect(buildInviteLink("token-123", preview)).toBe(`${preview}/convite/token-123`);
  });
  it("does not use another restricted preview as the published address", () => {
    expect(buildInviteLink("token-123", preview, "https://id-preview-6--project.lovable.app")).toBe(`${preview}/convite/token-123`);
  });
  it("distinguishes preview restriction from the public app", () => {
    expect(isRestrictedPreview(preview)).toBe(true);
    expect(isRestrictedPreview("https://id-preview-abc123--project.lovable.app")).toBe(true);
    expect(isRestrictedPreview("https://mli.lovable.app")).toBe(false);
  });
});