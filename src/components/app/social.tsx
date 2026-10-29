import { useEffect, useState } from "react"
import type { Provider } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
import { safeError } from "@/lib/api"
import { CONFIG } from "@/lib/config"
import { supabase } from "@/lib/supabase"

/*
 * Sign-in / sign-up with an identity provider. Only the providers enabled in Supabase
 * (Authentication → Sign In / Providers) are shown, read from the public /auth/v1/settings:
 * a provider that is not configured never appears as a dead button.
 * Marks are the providers' own logos, drawn inline (CSP: no remote images).
 */

type Social = { id: Provider; label: string; scopes?: string; mark: React.ReactNode }

const SOCIALS: Social[] = [
  {
    id: "google",
    label: "Google",
    mark: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.53 5.53 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z" />
        <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.1A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.28 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.27a12 12 0 0 0 0 10.78l4.01-3.1Z" />
        <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.97 11.97 0 0 0 1.27 6.61l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77Z" />
      </svg>
    ),
  },
  {
    id: "azure",
    label: "Microsoft",
    scopes: "email",
    mark: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
        <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
        <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
        <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
      </svg>
    ),
  },
  {
    id: "apple",
    label: "Apple",
    mark: (
      <svg viewBox="0 0 24 24" aria-hidden fill="currentColor">
        <path d="M16.37 12.7c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79a4.43 4.43 0 0 0-3.74 2.28c-1.6 2.77-.41 6.86 1.14 9.11.76 1.1 1.66 2.33 2.84 2.29 1.14-.05 1.57-.74 2.95-.74 1.38 0 1.76.74 2.97.71 1.23-.02 2-1.11 2.75-2.22a9.8 9.8 0 0 0 1.25-2.56 3.96 3.96 0 0 1-2.32-3.65ZM14.1 5.95c.63-.76 1.05-1.82.94-2.87-.9.04-2 .6-2.65 1.36-.58.67-1.09 1.75-.95 2.78 1 .08 2.03-.51 2.66-1.27Z" />
      </svg>
    ),
  },
  {
    id: "facebook",
    label: "Facebook",
    mark: (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path fill="#1877F2" d="M24 12a12 12 0 1 0-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.92-1.95 1.87V12h3.33l-.53 3.47h-2.8v8.38A12 12 0 0 0 24 12Z" />
        <path fill="#fff" d="m16.67 15.47.53-3.47h-3.33V9.75c0-.95.46-1.87 1.95-1.87h1.51V4.93s-1.37-.24-2.68-.24c-2.74 0-4.53 1.66-4.53 4.67V12H7.08v3.47h3.04v8.38a12.1 12.1 0 0 0 3.75 0v-8.38h2.8Z" />
      </svg>
    ),
  },
]

function useEnabledProviders() {
  const [enabled, setEnabled] = useState<Social[] | null>(null)
  useEffect(() => {
    let alive = true
    fetch(CONFIG.url + "/auth/v1/settings", { headers: { apikey: CONFIG.key } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { external?: Record<string, boolean> } | null) => alive && setEnabled(SOCIALS.filter((p) => s?.external?.[p.id])))
      .catch(() => alive && setEnabled([]))
    return () => {
      alive = false
    }
  }, [])
  return enabled
}

export function SocialSignIn({ signup, onError }: { signup: boolean; onError: (message: string) => void }) {
  const providers = useEnabledProviders()
  const [busy, setBusy] = useState<Provider | null>(null)
  if (!providers?.length) return null

  async function go(p: Social) {
    if (busy) return
    setBusy(p.id)
    onError("")
    // The provider sends the user back here; the session is read from the return link (detectSessionInUrl).
    const r = await supabase.auth.signInWithOAuth({ provider: p.id, options: { redirectTo: location.origin + location.pathname, scopes: p.scopes } })
    if (r.error) {
      onError(safeError(r.error))
      setBusy(null)
    }
  }

  return (
    <div className="mt-6 grid gap-4">
      <div className="grid gap-2">
        {providers.map((p) => (
          <Button key={p.id} type="button" variant="outline" size="lg" disabled={!!busy} aria-busy={busy === p.id} onClick={() => go(p)} className="[&_svg]:size-[18px]">
            {p.mark}
            {(signup ? "S’inscrire avec " : "Continuer avec ") + p.label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        ou avec votre e-mail
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}
