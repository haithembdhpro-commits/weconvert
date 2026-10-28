import { createClient } from "@supabase/supabase-js"
import { CONFIG } from "./config"

export const supabase = createClient(CONFIG.url, CONFIG.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
