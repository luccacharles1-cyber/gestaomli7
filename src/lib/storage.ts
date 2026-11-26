import { supabase } from "@/integrations/supabase/client";

export const BUCKET = "store-files";

/** Short-lived signed URLs; files are never publicly addressable. */
export async function signedUrls(paths: string[], expiresIn = 60 * 30): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, expiresIn);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}
