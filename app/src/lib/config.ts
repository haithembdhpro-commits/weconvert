import fallback from "@domain/config.json"

// Publishable values only. VITE_* overrides allow staging builds; the legacy config.json stays the default.
export const CONFIG = {
  url: (import.meta.env.VITE_SUPABASE_URL as string | undefined) || (fallback as { url: string }).url,
  key: (import.meta.env.VITE_SUPABASE_KEY as string | undefined) || (fallback as { key: string }).key,
  legacyUrl: (import.meta.env.VITE_LEGACY_URL as string | undefined) || "",
}
