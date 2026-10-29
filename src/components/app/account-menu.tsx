import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import { Building2, KeyRound, Link2, LogOut, Monitor, Moon, Palette, Search, Settings, ShieldCheck, Smartphone, Sun, UserRound } from "lucide-react"
import { initialsOf } from "@domain/domain.mjs"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FormDialog } from "@/components/app/FormDialog"
import { FormField } from "@/components/app/page"
import { useSubmit } from "@/components/app/useSubmit"
import { rpc } from "@/lib/api"
import { navigate } from "@/lib/router"
import { useSession } from "@/lib/session"
import { supabase } from "@/lib/supabase"
import { useTheme, type ThemeMode } from "@/lib/theme"
import { cn } from "@/lib/utils"

const ROLE_LABEL = { owner: "Propriétaire", admin: "Administrateur", agent: "Agent de confirmation" } as const
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground", className)}>
      {initialsOf(name)}
    </span>
  )
}

type Dialog = "profile" | "password" | "everywhere" | null

/**
 * Account menu (avatar): who is signed in, profile and password, shortcuts to settings,
 * theme, company switch and sign-out — the same entry points as large SaaS products.
 * `variant="sidebar"` renders the trigger as the user card at the bottom of the menu.
 */
export function AccountMenu({ variant = "header", onSearch, onNavigate }: { variant?: "header" | "sidebar"; onSearch?: () => void; onNavigate?: () => void }) {
  const s = useSession()
  const { mode, setMode } = useTheme()
  const [dialog, setDialog] = useState<Dialog>(null)
  const me = s.members.find((m) => m.user_id === s.user?.id)
  const name = me?.display_name || s.user?.email || "?"
  const go = (route: string) => {
    navigate(route)
    onNavigate?.()
  }
  const signOut = async () => {
    try {
      await s.logout()
    } catch {
      toast.error("La déconnexion n’a pas abouti. Réessayez.")
    }
  }

  const trigger: ReactNode =
    variant === "sidebar" ? (
      <button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-12">
        <Avatar name={name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{s.role ? ROLE_LABEL[s.role] : ""}</span>
        </span>
      </button>
    ) : (
      <button type="button" aria-label={"Menu du compte : " + name} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        <Avatar name={name} className="transition-shadow hover:ring-2 hover:ring-primary/30" />
      </button>
    )

  const item = "min-h-9 gap-2.5 coarse:min-h-11"
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align={variant === "sidebar" ? "start" : "end"} side={variant === "sidebar" ? "top" : "bottom"} sideOffset={8} className="w-72">
          <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
            <Avatar name={name} className="size-10" />
            <span className="min-w-0">
              <span className="block truncate font-semibold text-foreground">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{s.user?.email}</span>
              <span className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                <ShieldCheck className="size-3 shrink-0" aria-hidden />
                {s.role ? ROLE_LABEL[s.role] : ""} · {s.workspaceName}
              </span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem className={item} onSelect={() => setDialog("profile")}>
              <UserRound />
              Mon profil
            </DropdownMenuItem>
            <DropdownMenuItem className={item} onSelect={() => setDialog("password")}>
              <KeyRound />
              {hasPassword(s.user) ? "Changer le mot de passe" : "Définir un mot de passe"}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem className={item} onSelect={() => go("settings")}>
              <Settings />
              Paramètres
            </DropdownMenuItem>
            {s.manager && (
              <>
                <DropdownMenuItem className={item} onSelect={() => go("team")}>
                  <ShieldCheck />
                  Équipe & accès
                </DropdownMenuItem>
                <DropdownMenuItem className={item} onSelect={() => go("integrations")}>
                  <Link2 />
                  Intégrations
                </DropdownMenuItem>
              </>
            )}
            {onSearch && (
              <DropdownMenuItem className={item} onSelect={onSearch}>
                <Search />
                Rechercher
                <DropdownMenuShortcut>{isMac ? "⌘K" : "Ctrl K"}</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {/* Inline (no side submenu): a submenu would open off-screen on a phone. */}
          <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Palette className="size-3.5" aria-hidden />
            Apparence
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as ThemeMode)}>
            <DropdownMenuRadioItem value="light" className={item} onSelect={(e) => e.preventDefault()}><Sun />Clair</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark" className={item} onSelect={(e) => e.preventDefault()}><Moon />Sombre</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system" className={item} onSelect={(e) => e.preventDefault()}><Monitor />Comme l’appareil</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {s.workspaces.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Building2 className="size-3.5" aria-hidden />
                Entreprise
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={s.workspace || ""}
                onValueChange={(id) => {
                  if (id !== s.workspace) s.selectWorkspace(id).catch(() => toast.error("Impossible d’ouvrir cette entreprise pour le moment."))
                }}
              >
                {s.workspaces.map((w) => (
                  <DropdownMenuRadioItem key={w.id} value={w.id} className={item}>
                    <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className={item} onSelect={signOut}>
            <LogOut />
            Se déconnecter
          </DropdownMenuItem>
          <DropdownMenuItem className={item} variant="destructive" onSelect={() => setDialog("everywhere")}>
            <Smartphone />
            Déconnecter tous mes appareils…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "profile" && <ProfileDialog current={me?.display_name || ""} onClose={() => setDialog(null)} />}
      {dialog === "password" && <PasswordDialog onClose={() => setDialog(null)} />}
      {dialog === "everywhere" && <EverywhereDialog onClose={() => setDialog(null)} />}
    </>
  )
}

function hasPassword(user: { app_metadata?: Record<string, any> } | null) {
  const providers: unknown = user?.app_metadata?.providers ?? [user?.app_metadata?.provider]
  return Array.isArray(providers) && providers.includes("email")
}

function ProfileDialog({ current, onClose }: { current: string; onClose: () => void }) {
  const s = useSession()
  const sub = useSubmit()
  return (
    <FormDialog
      id="profile-form"
      title="Mon profil"
      description={`Votre nom apparaît dans l’historique des commandes et pour votre équipe de « ${s.workspaceName} ».`}
      submitLabel="Enregistrer"
      busy={sub.busy}
      error={sub.error}
      onClose={onClose}
      onSubmit={(d) =>
        sub.run(async () => {
          await rpc("crm_my_profile_update", { p_workspace: s.workspace, p_display_name: d.display_name })
          await s.loadContext(s.workspace || undefined)
          toast.success("Profil enregistré.")
          onClose()
        })
      }
    >
      <FormField label="Nom affiché" htmlFor="pf-name" required>
        <Input id="pf-name" name="display_name" defaultValue={current} required minLength={2} maxLength={100} autoComplete="name" />
      </FormField>
      <dl className="grid gap-3 rounded-lg bg-muted p-4 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Adresse e-mail de connexion</dt>
          <dd className="mt-0.5 truncate font-medium">{s.user?.email}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Rôle</dt>
          <dd className="mt-0.5 font-medium">{s.role ? ROLE_LABEL[s.role] : ""}</dd>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {s.role === "owner" ? "Vous êtes le propriétaire de cette entreprise." : "Seul le propriétaire peut changer les rôles, dans Équipe & accès."}
        </p>
      </dl>
    </FormDialog>
  )
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const s = useSession()
  const sub = useSubmit()
  const existing = hasPassword(s.user)
  return (
    <FormDialog
      id="password-form"
      title={existing ? "Changer le mot de passe" : "Définir un mot de passe"}
      description={existing ? "Saisissez d’abord votre mot de passe actuel." : "Vous vous connectez avec Google, Microsoft, Apple ou Facebook : ajoutez un mot de passe pour pouvoir aussi vous connecter avec votre e-mail."}
      submitLabel="Enregistrer"
      busy={sub.busy}
      error={sub.error}
      onClose={onClose}
      onSubmit={(d, form) =>
        sub.run(async () => {
          if (d.next !== d.again) throw Object.assign(Error("Les deux nouveaux mots de passe ne sont pas identiques."), { friendly: true })
          if (existing) {
            // Proves the current password before changing it (an open session alone is not enough).
            const check = await supabase.auth.signInWithPassword({ email: s.user!.email!, password: d.current })
            if (check.error) throw Object.assign(Error("Mot de passe actuel incorrect."), { friendly: true })
          }
          const r = await supabase.auth.updateUser({ password: d.next })
          if (r.error) {
            const msg = /different from the old/i.test(r.error.message) ? "Choisissez un mot de passe différent de l’actuel." : /weak|short|characters/i.test(r.error.message) ? "Mot de passe trop faible : 12 caractères minimum, évitez les mots courants." : ""
            throw msg ? Object.assign(Error(msg), { friendly: true }) : r.error
          }
          form.reset()
          toast.success("Mot de passe enregistré.")
          onClose()
        })
      }
    >
      {existing && (
        <FormField label="Mot de passe actuel" htmlFor="pw-current" required>
          <Input id="pw-current" name="current" type="password" required autoComplete="current-password" maxLength={200} />
        </FormField>
      )}
      <FormField label="Nouveau mot de passe" htmlFor="pw-next" required hint="12 caractères minimum.">
        <Input id="pw-next" name="next" type="password" required minLength={12} maxLength={200} autoComplete="new-password" />
      </FormField>
      <FormField label="Confirmer le nouveau mot de passe" htmlFor="pw-again" required>
        <Input id="pw-again" name="again" type="password" required minLength={12} maxLength={200} autoComplete="new-password" />
      </FormField>
    </FormDialog>
  )
}

function EverywhereDialog({ onClose }: { onClose: () => void }) {
  const sub = useSubmit()
  return (
    <FormDialog
      id="everywhere-form"
      title="Déconnecter tous mes appareils ?"
      description="Vous serez déconnecté ici et sur tous les ordinateurs et téléphones où votre compte est ouvert. Utile après la perte d’un téléphone ou un partage de mot de passe."
      submitLabel="Tout déconnecter"
      busy={sub.busy}
      error={sub.error}
      onClose={onClose}
      onSubmit={() =>
        sub.run(async () => {
          const r = await supabase.auth.signOut({ scope: "global" })
          if (r.error) throw r.error
        })
      }
    >
      <span className="sr-only">Confirmation</span>
    </FormDialog>
  )
}
