import { useState } from "react"
import { toast } from "sonner"
import { Copy, Plus } from "lucide-react"
import { initialsOf } from "@domain/domain.mjs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FormField, Notice, PageHeader } from "@/components/app/page"
import { FormDialog } from "@/components/app/FormDialog"
import { ToneBadge } from "@/components/app/tone"
import { useSubmit } from "@/components/app/useSubmit"
import { time } from "@/lib/format"
import { navigate } from "@/lib/router"
import { useSession } from "@/lib/session"
import type { Member } from "@/lib/types"

const ROLE = { owner: "Propriétaire", admin: "Administrateur", agent: "Agent de confirmation" } as const
const PERMISSIONS = [
  ["Lire les commandes", "Toutes les boutiques", "Toutes les boutiques", "Commandes affectées uniquement"],
  ["Créer une commande", "Oui", "Oui", "Oui, affectée à lui-même"],
  ["Confirmer, appeler, noter", "Oui", "Oui", "Sur ses commandes"],
  ["Changer un prix / remise", "Oui", "Oui", "Catalogue à la création ; prix convenu conservé"],
  ["Affecter une commande", "Oui", "Oui", "Non"],
  ["Gérer produits et stock", "Oui", "Oui", "Lecture seule"],
  ["Inviter un membre", "Admin ou agent", "Agent uniquement", "Non"],
  ["Modifier / désactiver les accès", "Oui", "Non", "Non"],
]

export function Team({ tab }: { tab: string }) {
  const s = useSession()
  const [invite, setInvite] = useState(false)
  const [link, setLink] = useState<{ email: string; url: string; expires: string } | null>(null)
  const [member, setMember] = useState<Member | null>(null)
  const sub = useSubmit()
  const view = tab === "roles" ? "roles" : "members"

  return (
    <>
      <PageHeader
        title="Une équipe. Les bons accès."
        description="Les permissions sont vérifiées pour chaque opération."
        actions={
          s.manager && (
            <Button size="lg" onClick={() => setInvite(true)}>
              <Plus />
              Inviter un membre
            </Button>
          )
        }
      />
      <Tabs value={view} onValueChange={(v) => navigate("team", v === "roles" ? "roles" : "")} className="mb-4">
        <TabsList>
          <TabsTrigger value="members" className="px-3">Membres</TabsTrigger>
          <TabsTrigger value="roles" className="px-3">Permissions</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="overflow-x-auto">
          {view === "roles" ? (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead>Permission</TableHead>
                  <TableHead>Propriétaire</TableHead>
                  <TableHead>Administrateur</TableHead>
                  <TableHead>Agent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PERMISSIONS.map((r) => (
                  <TableRow key={r[0]}>
                    {r.map((c, i) => (
                      <TableCell key={i} className={i === 0 ? "font-medium" : "text-muted-foreground"}>{c}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead>Membre</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Accès</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.members.map((m) => (
                  <TableRow key={m.user_id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span aria-hidden className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">{initialsOf(m.display_name)}</span>
                        <b className="font-medium">
                          {m.display_name}
                          {m.user_id === s.user?.id && " (vous)"}
                        </b>
                      </div>
                    </TableCell>
                    <TableCell>{ROLE[m.role]}</TableCell>
                    <TableCell>
                      <ToneBadge tone={m.active ? "success" : "neutral"}>{m.active ? "Actif" : "Désactivé"}</ToneBadge>
                    </TableCell>
                    <TableCell>
                      {s.role === "owner" && m.role !== "owner" ? (
                        <Button variant="outline" size="sm" onClick={() => setMember(m)}>
                          Gérer l’accès
                        </Button>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
      {view === "members" && (
        <Notice className="mt-4">Les invitations sont des liens personnels valables 7 jours. Partagez le lien avec le membre concerné ; son adresse e-mail sera vérifiée.</Notice>
      )}

      {invite && (
        <FormDialog
          id="invite-form"
          title="Inviter un membre"
          description="Vous obtiendrez un lien à partager personnellement avec ce membre."
          submitLabel="Créer le lien d’invitation"
          busy={sub.busy}
          error={sub.error}
          onClose={() => {
            setInvite(false)
            sub.reset()
          }}
          onSubmit={(d) =>
            sub.run(async () => {
              const r = await s.command<{ token: string; expires_at: string }>("member.invite", d)
              setInvite(false)
              setLink({ email: d.email, url: location.origin + location.pathname + "#join/" + encodeURIComponent(r.token), expires: r.expires_at })
            })
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nom du membre" htmlFor="i-name" required>
              <Input id="i-name" name="display_name" required minLength={2} maxLength={100} />
            </FormField>
            <FormField label="Adresse e-mail" htmlFor="i-email" required>
              <Input id="i-email" name="email" type="email" required maxLength={254} />
            </FormField>
            <FormField label="Rôle" htmlFor="i-role">
              <NativeSelect id="i-role" name="role" defaultValue="agent">
                <NativeSelectOption value="agent">Agent de confirmation</NativeSelectOption>
                {s.role === "owner" && <NativeSelectOption value="admin">Administrateur</NativeSelectOption>}
              </NativeSelect>
            </FormField>
          </div>
        </FormDialog>
      )}

      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invitation prête à partager</DialogTitle>
            <DialogDescription>
              Lien réservé à <b>{link?.email}</b>, valable jusqu’au {time(link?.expires)}. Aucun e-mail n’a été envoyé.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Lien d’invitation" htmlFor="invite-link" hint="Il n’est affiché qu’une fois : copiez-le maintenant. S’il est perdu, créez une nouvelle invitation.">
            <Textarea id="invite-link" readOnly value={link?.url || ""} rows={3} className="num text-xs" onFocus={(e) => e.currentTarget.select()} />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLink(null)}>
              Fermer
            </Button>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link!.url)
                  toast.success("Lien copié.")
                } catch {
                  ;(document.getElementById("invite-link") as HTMLTextAreaElement | null)?.select()
                  toast("Sélectionnez puis copiez le lien.")
                }
              }}
            >
              <Copy />
              Copier le lien
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {member && (
        <FormDialog
          id="member-form"
          title={"Accès de " + member.display_name}
          description="Une désactivation bloque immédiatement les lectures et modifications. Les anciennes commandes restent historisées."
          submitLabel="Enregistrer"
          busy={sub.busy}
          error={sub.error}
          onClose={() => {
            setMember(null)
            sub.reset()
          }}
          onSubmit={(d) =>
            sub.run(async () => {
              await s.command("member.update", { user_id: member.user_id, role: d.role, active: d.active === "true" })
              setMember(null)
              await s.loadContext()
              toast.success("Accès mis à jour.")
            })
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Rôle" htmlFor="m-role">
              <NativeSelect id="m-role" name="role" defaultValue={member.role}>
                <NativeSelectOption value="agent">Agent de confirmation</NativeSelectOption>
                <NativeSelectOption value="admin">Administrateur</NativeSelectOption>
              </NativeSelect>
            </FormField>
            <FormField label="Accès" htmlFor="m-active">
              <NativeSelect id="m-active" name="active" defaultValue={String(member.active)}>
                <NativeSelectOption value="true">Actif</NativeSelectOption>
                <NativeSelectOption value="false">Désactivé</NativeSelectOption>
              </NativeSelect>
            </FormField>
          </div>
        </FormDialog>
      )}
    </>
  )
}
