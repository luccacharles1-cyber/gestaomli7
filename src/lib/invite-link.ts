/** A configured public deployment takes precedence over the editor's origin. */
export function isRestrictedPreview(origin: string): boolean {
  const host = new URL(origin).hostname.toLowerCase();
  return /\.(lovable\.app|gpt-eng\.com|gptengineer\.run|lovableproject\.com|lovableproject-dev\.com)$/.test(host)
    && (/^(?:id-preview|preview)(?:-[a-z0-9]+)?--/.test(host)
      || /^project--.+-dev\./.test(host)
      || /^live--/.test(host)
      || /\.lovableproject(?:-dev)?\.com$/.test(host));
}

export function buildInviteLink(token: string, currentOrigin: string, publishedUrl?: string): string {
  let origin = new URL(currentOrigin).origin;
  if (publishedUrl) {
    try {
      const candidate = new URL(publishedUrl);
      if (candidate.protocol === "https:" && !candidate.username && !candidate.password && !isRestrictedPreview(candidate.origin)) origin = candidate.origin;
    } catch { /* Keep the current site when configuration is invalid. */ }
  }
  return `${origin}/convite/${encodeURIComponent(token)}`;
}