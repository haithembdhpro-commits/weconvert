import { useState } from "react"
import { toast } from "sonner"
import { ChevronRight, LogOut, Moon, Plus, Store, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { FormField, PageHeader } from "@/components/app/page"
import { FormDialog } from "@/components/app/FormDialog"
import { useSubmit } from "@/components/app/useSubmit"
import { safeError } from "@/lib/api"
import { useSession } from "@/lib/session"
import { useTheme } from "@/lib/theme"

const ROLE = { owner: "Propriétaire", admin: "Administrateur", agent: "Agent de confirmation" } as const

export function Settings() {
  const s = useSession()
  const { theme, toggle } = useTheme()
  const [newStore, setNewStore] = useState(false)
  const sub = useSubmit()
  return (
    <>
      <PageHeader title="Votre espace de travail." description="Gérez vos boutiques, votre session et votre affichage." />
      <div className="grid gap-5 md:grid-cols-2">
        <Card className="gap-3 p-5 sm:p-6">
          <h2 className="font-semibold">Entreprise & boutiques</h2>
          <p className="text-sm text-muted-foreground">{s.workspaceName}</p>
          <div className="grid gap-2">
            {s.stores.map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => s.selectStore(st.id)}
                className="flex min-h-12 items-center gap-3 rounded-lg border px-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Store className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1 font-medium">{st.name}</span>
                {st.id === s.store ? <span className="text-xs font-medium text-primary">Sélectionnée</span> : <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
              </button>
            ))}
          </div>
          {s.manager && (
            <div>
              <Button variant="outline" onClick={() => setNewStore(true)}>
                <Plus />
                Ajouter une boutique
              </Button>
            </div>
          )}
        </Card>
        <Card className="gap-3 p-5 sm:p-6">
          <h2 className="font-semibold">Votre compte</h2>
          <p className="text-sm">{s.user?.email}</p>
          <p className="text-sm text-muted-foreground">{s.role ? ROLE[s.role] : ""}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={toggle}>
              {theme === "dark" ? <Sun /> : <Moon />}
              {theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre"}
            </Button>
            <Button
              variant="outline"
              onClick={() => s.logout().catch((e) => toast.error(safeError(e)))}
            >
              <LogOut />
              Se déconnecter
            </Button>
          </div>
        </Card>
        <Card className="gap-2 p-5 sm:p-6">
          <h2 className="font-semibold">Sources de commandes</h2>
          <p className="text-sm text-muted-foreground">
            La saisie manuelle accepte les canaux site web, WhatsApp, Messenger, Instagram et téléphone. WooCommerce, Shopify et YouCan se connectent dans Intégrations. Les API de messagerie ne sont
            pas encore raccordées.
          </p>
        </Card>
        <Card className="gap-2 p-5 sm:p-6">
          <h2 className="font-semibold">Ce qui est connecté</h2>
          <p className="text-sm text-muted-foreground">Commandes, confirmation, rappels, historique, catalogue, réservations de stock, boutiques et permissions. WooCommerce, Shopify, YouCan et ZR Express se connectent par boutique.</p>
          <p className="text-sm text-muted-foreground">Le reversement COD réel, les variantes et l’attribution publicitaire sont à compléter.</p>
        </Card>
      </div>
      {newStore && (
        <FormDialog
          id="store-form"
          title="Ajouter une boutique"
          submitLabel="Créer la boutique"
          busy={sub.busy}
          error={sub.error}
          onClose={() => {
            setNewStore(false)
            sub.reset()
          }}
          onSubmit={(d) =>
            sub.run(async () => {
              const r = await s.command<{ id: string }>("store.create", { name: d.name })
              setNewStore(false)
              await s.loadContext()
              s.selectStore(r.id)
              toast.success("Boutique créée.")
            })
          }
        >
          <FormField label="Nom de la boutique" htmlFor="st-name" required>
            <Input id="st-name" name="name" required minLength={2} maxLength={100} />
          </FormField>
        </FormDialog>
      )}
    </>
  )
}
