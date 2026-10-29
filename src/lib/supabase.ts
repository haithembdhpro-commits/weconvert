import { createClient } from "@supabase/supabase-js"
import { CONFIG } from "./config"

// Read before createClient: the client consumes and clears the fragment of an e-mail or OAuth return link.
const entry = new URLSearchParams(location.hash.slice(1))
export const AUTH_ENTRY = {
  recovery: entry.get("type") === "recovery",
  error: entry.has("error") ? { code: entry.get("error_code") || entry.get("error") || "", text: entry.get("error_description") || "" } : null,
}

export const supabase = createClient(CONFIG.url, CONFIG.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
