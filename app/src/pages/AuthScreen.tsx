import { useState, type FormEvent } from "react"
import { ArrowRight, Moon, Sun } from "lucide-react"
import { requestId } from "@domain/domain.mjs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BrandMark } from "@/components/app/tone"
import { FormError, FormField, Notice } from "@/components/app/page"
import { rpc, safeError } from "@/lib/api"
import { supabase } from "@/lib/supabase"
import { useSession } from "@/lib/session"
import { useTheme } from "@/lib/theme"

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <section className="w-full max-w-[440px] rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark />
          <div>
            <div className="text-lg font-bold tracking-tight">WeConvert</div>
            <div className="text-xs font-medium tracking-wider text-muted-foreground">COD WORKSPACE</div>
          </div>
        </div>
        {children}
      </section>
    </main>
  )
}

function ThemeLink() {
  const { theme, toggle } = useTheme()
  return (
    <Button variant="ghost" size="sm" onClick={toggle}>
      {theme === "dark" ? <Sun /> : <Moon />}
      {theme === "dark" ? "Mode clair" : "Mode sombre"}
    </Button>
  )
}

export function BootScreen() {
  return (
    <Shell>
      <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
        Ouverture de WeConvert…
      </div>
    </Shell>
  )
}

export function AuthScreen() {
  const { authMode: mode, setAuthMode, authInfo, setAuthInfo, loadContext } = useSession()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const signup = mode === "signup", reset = mode === "reset", password = mode === "password"

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    setBusy(true)
    setError("")
    try {
      const redirect = location.origin + location.pathname
      if (signup) {
        const r = await supabase.auth.signUp({ email: d.email.trim(), password: d.password, options: { emailRedirectTo: redirect } })
        if (r.error) throw r.error
        if (!r.data.session) {
          setAuthMode("login")
          setAuthInfo("Consultez votre e-mail pour confirmer le compte, puis revenez ici vous connecter.")
        }
      } else if (reset) {
        const r = await supabase.auth.resetPasswordForEmail(d.email.trim(), { redirectTo: redirect })
        if (r.error) throw r.error
        setAuthInfo("Si ce compte existe, vous recevrez un lien de réinitialisation.")
      } else if (password) {
        const r = await supabase.auth.updateUser({ password: d.password })
        if (r.error) throw r.error
        setAuthMode("login")
        await loadContext()
      } else {
        const r = await supabase.auth.signInWithPassword({ email: d.email.trim(), password: d.password })
        if (r.error) throw r.error
        setAuthInfo("")
      }
    } catch (err) {
      setError(safeError(err))
    } finally {
      setBusy(false)
    }
  }

  const title = password ? "Choisissez votre mot de passe." : signup ? "Bienvenue dans WeConvert." : reset ? "Retrouvez votre accès." : "Votre commerce, sous contrôle."
  const lead = signup
    ? "Créez votre compte, puis votre espace de travail."
    : reset
      ? "Recevez un lien pour réinitialiser votre mot de passe."
      : password
        ? "Un mot de passe d’au moins 12 caractères."
        : "Connectez-vous pour retrouver vos commandes et votre équipe."

  return (
    <Shell>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{lead}</p>
      {authInfo && <Notice className="mt-4">{authInfo}</Notice>}
      <form className="mt-6 grid gap-4" onSubmit={submit} key={mode}>
        {!password && (
          <FormField label="Adresse e-mail" htmlFor="auth-email" required>
            <Input id="auth-email" name="email" type="email" required autoComplete="email" maxLength={254} />
          </FormField>
        )}
        {!reset && (
          <FormField label="Mot de passe" htmlFor="auth-password" required hint={signup || password ? "12 caractères minimum." : undefined}>
            <Input
              id="auth-password"
              name="password"
              type="password"
              required
              autoComplete={signup || password ? "new-password" : "current-password"}
              minLength={signup || password ? 12 : undefined}
              maxLength={200}
            />
          </FormField>
        )}
        <FormError message={error} />
        <Button type="submit" size="lg" disabled={busy} aria-busy={busy}>
          {password ? "Enregistrer le mot de passe" : signup ? "Créer mon compte" : reset ? "Recevoir le lien" : "Se connecter"}
          <ArrowRight />
        </Button>
      </form>
      <div className="mt-4 flex flex-wrap gap-1">
        {!password && (
          <Button variant="ghost" size="sm" onClick={() => setAuthMode(signup || reset ? "login" : "signup")}>
            {signup || reset ? "J’ai déjà un compte" : "Créer un compte"}
          </Button>
        )}
        {!password && !reset && !signup && (
          <Button variant="ghost" size="sm" onClick={() => setAuthMode("reset")}>
            Mot de passe oublié
          </Button>
        )}
        <ThemeLink />
      </div>
    </Shell>
  )
}

export function OnboardingScreen() {
  const { user, hasInvitation, discardInvitation, loadContext, logout } = useSession()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await fn()
    } catch (err) {
      setError(safeError(err))
    } finally {
      setBusy(false)
    }
  }

  function createWorkspace(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    run(async () => {
      // One bootstrap request id per browser session: a double click or a retry never creates two companies.
      const key = "wc-bootstrap-" + user!.id
      let request = sessionStorage.getItem(key)
      if (!request) {
        request = requestId()
        sessionStorage.setItem(key, request)
      }
      const id = await rpc<string>("crm_bootstrap", { p_name: d.name, p_store: d.store, p_display: d.display, p_request: request })
      sessionStorage.removeItem(key)
      await loadContext(id)
    })
  }

  function accept() {
    run(async () => {
      const id = await rpc<string>("crm_accept_invitation", { p_token: sessionStorage.getItem("wc-invitation") })
      discardInvitation()
      await loadContext(id)
    })
  }

  return (
    <Shell>
      <h1 className="text-2xl font-semibold tracking-tight">{hasInvitation ? "Rejoindre votre équipe." : "Créons votre espace CRM."}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Connecté avec {user?.email}.</p>
      {hasInvitation ? (
        <div className="mt-6 grid gap-3">
          <p className="text-sm">Le lien est lié à l’adresse e-mail invitée.</p>
          <FormError message={error} />
          <Button size="lg" onClick={accept} disabled={busy}>
            Accepter l’invitation
          </Button>
          <Button variant="outline" onClick={discardInvitation}>
            Créer mon propre espace
          </Button>
        </div>
      ) : (
        <form className="mt-6 grid gap-4" onSubmit={createWorkspace}>
          <FormField label="Nom de l’entreprise" htmlFor="ob-name" required>
            <Input id="ob-name" name="name" required minLength={2} maxLength={100} />
          </FormField>
          <FormField label="Première boutique" htmlFor="ob-store" required>
            <Input id="ob-store" name="store" required minLength={2} maxLength={100} />
          </FormField>
          <FormField label="Votre nom" htmlFor="ob-display" required>
            <Input id="ob-display" name="display" required minLength={2} maxLength={100} autoComplete="name" />
          </FormField>
          <Notice>Votre espace démarre vide. Vous pourrez ensuite ajouter vos produits et vos premières commandes.</Notice>
          <FormError message={error} />
          <Button type="submit" size="lg" disabled={busy}>
            Créer l’espace de travail
          </Button>
        </form>
      )}
      <Button variant="ghost" className="mt-3" onClick={() => run(logout)}>
        Se déconnecter
      </Button>
    </Shell>
  )
}
