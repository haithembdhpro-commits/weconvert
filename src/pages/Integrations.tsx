import { useRef, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Box, ChevronRight, Copy, Link2, LogOut, Plus, RefreshCw, Settings, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState, FormField, Notice, PageHeader } from "@/components/app/page"
import { FormDialog } from "@/components/app/FormDialog"
import { ToneBadge, type Tone } from "@/components/app/tone"
import { useOrderUI } from "@/components/app/orders"
import { useSubmit } from "@/components/app/useSubmit"
import { WOO_LABELS, safeError, select } from "@/lib/api"
import { SHOPIFY_LABELS, YOUCAN_LABELS, edge } from "@/lib/edge"
import { f, time } from "@/lib/format"
import { useSession } from "@/lib/session"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import shopifyLogo from "@/assets/logos/shopify.webp"
import youcanLogo from "@/assets/logos/youcan.webp"
import wooLogo from "@/assets/logos/woocommerce.webp"

type Conn = Record<string, any> | null
type Ev = { id: number; created_at: string; external_id?: string; outcome: string; code?: string; order_id?: string; entity?: string; connection_id?: string }

const SOURCE_STATES: Record<string, [string, Tone]> = {
  active: ["Réception vérifiée", "success"],
  awaiting_webhook: ["Autorisation accordée · webhook en attente", "warning"],
  pending: ["Autorisation en cours", "warning"],
  error: ["Connexion à vérifier", "danger"],
  disconnected: ["Déconnectée", "neutral"],
}
const SOURCE_OUTCOME: Record<string, [string, Tone]> = {
  received: ["Reçue", "success"], attention: ["À vérifier", "warning"], skipped: ["Ignorée", "neutral"], error: ["Erreur", "danger"],
  updated: ["Mise à jour", "info"], connected: ["Autorisée", "success"], disconnected: ["Déconnectée", "neutral"],
}
const WOO_OUTCOME: Record<string, [string, Tone]> = {
  imported: ["Reçue", "success"], updated: ["Mise à jour", "info"], linked: ["Rapproché", "info"], attention: ["À vérifier", "warning"],
  skipped: ["Ignorée", "neutral"], error: ["Échec", "danger"], connected: ["Connectée", "success"], disconnected: ["Déconnectée", "neutral"],
}

type Provider = "shopify" | "youcan" | "woocommerce"
const LOGOS: Record<Provider, [string, string]> = { shopify: [shopifyLogo, "Shopify"], youcan: [youcanLogo, "YouCan"], woocommerce: [wooLogo, "WooCommerce"] }

/** Provider mark as supplied by the owner (shipped with the app: the CSP allows no remote image). */
function Logo({ p, className }: { p: Provider; className?: string }) {
  const [src, name] = LOGOS[p]
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border bg-white", className)}>
      <img src={src} alt={"Logo " + name} width={40} height={40} className={cn("size-full", p === "shopify" ? "object-contain p-1" : "object-cover")} />
    </span>
  )
}

/** « Comment ça marche » folded by default: the card itself stays short. */
function HowItWorks({ children }: { children: ReactNode }) {
  return (
    <details className="group mt-4 rounded-lg border px-4 py-3 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
        Comment ça marche
      </summary>
      <div className="mt-2 grid gap-2 text-muted-foreground">{children}</div>
    </details>
  )
}

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="mt-4 grid gap-3 sm:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-lg bg-muted p-3">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="num mt-1 text-sm font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Steps({ items }: { items: [string, string][] }) {
  return (
    <ol className="mt-4 grid gap-3 sm:grid-cols-3">
      {items.map(([t, d], i) => (
        <li key={t} className="rounded-lg border p-3">
          <b className="text-sm">
            {i + 1}. {t}
          </b>
          <p className="mt-1 text-sm text-muted-foreground">{d}</p>
        </li>
      ))}
    </ol>
  )
}

function Journal({ title, description, events, labels, outcomes, empty, action }: {
  title: string; description: string; events: Ev[]; labels: Record<string, string>; outcomes: Record<string, [string, Tone]>; empty: [string, string]
  action?: (e: Ev) => ReactNode
}) {
  const ui = useOrderUI()
  const qc = useQueryClient()
  const { store } = useSession()
  return (
    <Card className="mt-4 gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4 sm:px-6">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["store", store] })}>
          <RefreshCw />
          Actualiser
        </Button>
      </div>
      {!events.length ? (
        <EmptyState title={empty[0]} description={empty[1]} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead>Date</TableHead>
                <TableHead>Référence</TableHead>
                <TableHead>Résultat</TableHead>
                <TableHead>Détail</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => {
                const [label, tone] = outcomes[e.outcome] || [e.outcome, "neutral" as Tone]
                return (
                  <TableRow key={e.id}>
                    <TableCell className="num text-muted-foreground">{time(e.created_at)}</TableCell>
                    <TableCell className="num">{e.external_id ? (e.entity === "product" ? "Produit #" : e.entity === "order" ? "Commande #" : "") + e.external_id : "—"}</TableCell>
                    <TableCell>
                      <ToneBadge tone={tone}>{label}</ToneBadge>
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal">{e.code ? labels[e.code] || WOO_LABELS[e.code] || e.code : "—"}</TableCell>
                    <TableCell>
                      {e.order_id ? (
                        <Button variant="outline" size="sm" onClick={() => ui.openOrder(e.order_id!)}>
                          Voir la fiche
                        </Button>
                      ) : (
                        action?.(e) ?? "—"
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  )
}

function ConfirmDialog({ title, body, confirm, onClose, onConfirm }: { title: string; body: ReactNode; confirm: string; onClose: () => void; onConfirm: () => Promise<unknown> }) {
  const sub = useSubmit()
  return (
    <FormDialog id="confirm-form" title={title} description={body} submitLabel={confirm} busy={sub.busy} error={sub.error} onClose={onClose} onSubmit={() => sub.run(onConfirm)}>
      <span className="sr-only">{title}</span>
    </FormDialog>
  )
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success("Copié.")
  } catch {
    toast("Sélectionnez la valeur puis copiez-la.")
  }
}

/* ---------------------------------------------------------------- Shopify */

function ShopifyCard({ c, events, failed }: { c: Conn; events: Ev[]; failed: boolean }) {
  const s = useSession()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<"connect" | "disconnect" | null>(null)
  const sub = useSubmit()
  const [label, tone] = c ? SOURCE_STATES[c.status] || ["À vérifier", "warning"] : ["À connecter", "neutral"]
  return (
    <section>
      <Card className="gap-0 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo p="shopify" />
            <div>
              <h2 className="font-semibold">Shopify</h2>
              <p className="text-sm text-muted-foreground">{c ? c.external_shop : "Nouvelles commandes COD → WeConvert"}</p>
            </div>
          </div>
          <ToneBadge tone={tone as Tone}>{label}</ToneBadge>
        </div>
        <HowItWorks>
          <p>Les nouvelles commandes COD en DZD arrivent dans la file de confirmation. Le statut de paiement ou d’expédition Shopify reste une information source ; seule l’équipe confirme dans WeConvert. Aucune ancienne commande n’est importée automatiquement.</p>
        </HowItWorks>
        {failed && <Notice tone="danger" role="alert" className="mt-3">L’autorisation Shopify n’a pas abouti. Vérifiez l’application, ses droits de lecture et réessayez.</Notice>}
        {c?.last_error && <Notice tone="danger" role="alert" className="mt-3">Dernier problème : {SHOPIFY_LABELS[c.last_error] || c.last_error}.</Notice>}
        {c && <Facts items={[["Autorisation", time(c.connected_at)], ["Dernier webhook signé", c.last_webhook_at ? time(c.last_webhook_at) : "En attente de réception"], ["Modes COD", (c.cod_methods || []).join(", ") || "—"]]} />}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant={c ? "outline" : "default"} onClick={() => setDialog("connect")}>
            <Link2 />
            {c?.status === "active" ? "Renouveler l’autorisation" : "Connecter Shopify"}
          </Button>
          {c && c.status !== "disconnected" && (
            <Button variant="outline" onClick={() => setDialog("disconnect")}>
              <LogOut />
              Déconnecter
            </Button>
          )}
        </div>
        {c?.status === "awaiting_webhook" && (
          <Notice className="mt-4">
            Autorisation reçue. Vérifiez dans l’application Shopify que les webhooks <code>orders/create</code> et <code>orders/updated</code> pointent vers WeConvert, puis passez une commande COD de test. La réception ne sera annoncée active qu’après son arrivée.
          </Notice>
        )}
        {!c && (
          <Steps
            items={[
              ["Autorisez la boutique", "Connexion avec le domaine permanent Shopify et le droit de lecture des commandes."],
              ["Vérifiez la réception", "La première commande de test valide le webhook signé."],
              ["Confirmez dans WeConvert", "La confirmation COD et le suivi de livraison restent distincts du statut Shopify."],
            ]}
          />
        )}
      </Card>
      {c && (
        <Journal title="Journal Shopify" description="Les 30 derniers événements de cette connexion" events={events} labels={SHOPIFY_LABELS} outcomes={SOURCE_OUTCOME} empty={["Aucun événement Shopify", "Une commande COD reçue ou ignorée apparaîtra ici après l’activation."]} />
      )}
      {dialog === "connect" && (
        <FormDialog
          id="shopify-connect"
          title="Connecter Shopify"
          description="Renseignez le domaine permanent de la boutique. Le propriétaire devra autoriser l’application WeConvert dans Shopify."
          submitLabel="Autoriser sur Shopify"
          busy={sub.busy}
          error={sub.error}
          onClose={() => { setDialog(null); sub.reset() }}
          onSubmit={(d) =>
            sub.run(async () => {
              const r = await edge<{ authorize_url: string }>("weconvert-shopify", "connect", { store_id: s.store, shop: d.shop || c?.external_shop, cod_methods: d.cod_methods })
              location.assign(r.authorize_url)
            })
          }
        >
          <FormField label="Domaine Shopify" htmlFor="sh-shop" required>
            <Input id="sh-shop" name="shop" defaultValue={c?.external_shop || ""} readOnly={!!c} required placeholder="boutique.myshopify.com" maxLength={80} autoComplete="off" />
          </FormField>
          <FormField label="Noms supplémentaires des moyens de paiement COD" htmlFor="sh-cod" hint="Les noms courants « Cash on Delivery (COD) » et « cod » sont déjà reconnus. Les commandes payées en ligne et les autres devises sont ignorées.">
            <Input id="sh-cod" name="cod_methods" placeholder="Ex. Paiement à la livraison" maxLength={400} autoComplete="off" />
          </FormField>
        </FormDialog>
      )}
      {dialog === "disconnect" && c && (
        <ConfirmDialog
          title="Déconnecter Shopify"
          body="La réception des nouvelles commandes s’arrêtera. Les commandes déjà créées et les décisions de confirmation restent dans WeConvert."
          confirm="Déconnecter"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await edge("weconvert-shopify", "disconnect", { connection_id: c.id })
            setDialog(null)
            toast.success("Connexion Shopify désactivée. Les commandes reçues sont conservées.")
            await qc.invalidateQueries({ queryKey: ["store", s.store] })
          }}
        />
      )}
    </section>
  )
}

/* ----------------------------------------------------------------- YouCan */

const DEFAULT_COD = ["cash on delivery", "cash on delivery (cod)", "cod", "cash_on_delivery"]

function YoucanCard({ c, events, failed }: { c: Conn; events: Ev[]; failed: boolean }) {
  const s = useSession()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<"connect" | "disconnect" | null>(null)
  const sub = useSubmit()
  const act = useSubmit()
  const refresh = () => qc.invalidateQueries({ queryKey: ["store", s.store] })
  const states: Record<string, [string, Tone]> = { ...SOURCE_STATES, pending: ["Canal créé · autorisation à faire", "warning"] }
  const [label, tone] = c ? states[c.status] || ["À vérifier", "warning"] : ["À connecter", "neutral"]
  const authorize = () =>
    act.run(async () => {
      const r = await edge<{ authorize_url: string }>("weconvert-youcan", "authorize", { connection_id: c!.id })
      location.assign(r.authorize_url)
    })
  return (
    <section>
      <Card className="gap-0 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo p="youcan" />
            <div>
              <h2 className="font-semibold">YouCan{c?.channel_name ? " · " + c.channel_name : ""}</h2>
              <p className="text-sm text-muted-foreground">{c?.public_url || "Nouvelles commandes COD → WeConvert"}</p>
            </div>
          </div>
          <ToneBadge tone={tone as Tone}>{label}</ToneBadge>
        </div>
        <HowItWorks>
          <p>1. Créez un canal avec le nom et l’URL de votre boutique. 2. Autorisez WeConvert sur YouCan. 3. Passez une commande COD de test.</p>
          <p>Les nouvelles commandes COD en DZD rejoignent la file de confirmation. Les statuts YouCan restent des informations source et aucun historique n’est importé automatiquement.</p>
        </HowItWorks>
        {failed && <Notice tone="danger" role="alert" className="mt-3">L’autorisation YouCan n’a pas abouti. Vérifiez la boutique choisie et le dernier problème ci-dessous.</Notice>}
        {c?.last_error && <Notice tone="danger" role="alert" className="mt-3">{YOUCAN_LABELS[c.last_error] || c.last_error}</Notice>}
        {c && <Facts items={[["Boutique YouCan vérifiée", c.verified_domain || "Autorisation en attente"], ["Autorisation", time(c.connected_at)], ["Dernière commande traitée", c.last_webhook_at ? time(c.last_webhook_at) : "En attente de réception"]]} />}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant={c ? "outline" : "default"} onClick={() => setDialog("connect")}>
            {c ? <Settings /> : <Plus />}
            {c ? "Modifier le canal" : "Nouveau canal YouCan"}
          </Button>
          {c && (
            <Button variant={c.connected_at ? "outline" : "default"} onClick={authorize} disabled={act.busy}>
              <Link2 />
              {c.connected_at ? "Renouveler l’autorisation" : "Autoriser sur YouCan"}
            </Button>
          )}
          {c?.connected_at && c.status !== "disconnected" && (
            <Button
              variant="outline"
              disabled={act.busy}
              onClick={() =>
                act.run(async () => {
                  await edge("weconvert-youcan", "repair", { connection_id: c.id })
                  toast.success("Abonnements webhook YouCan réactivés. Passez une commande de test.")
                  await refresh()
                })
              }
            >
              <RefreshCw />
              Réactiver les webhooks
            </Button>
          )}
          {c && c.status !== "disconnected" && (
            <Button variant="outline" onClick={() => setDialog("disconnect")}>
              <LogOut />
              Déconnecter
            </Button>
          )}
        </div>
        {act.error && <p role="alert" className="mt-3 text-sm text-danger">{act.error}</p>}
        {c && !c.connected_at && (
          <Notice className="mt-4">
            Le canal est enregistré. L’autorisation associera la boutique choisie sur YouCan à cette URL ; la réception ne sera vérifiée qu’après une nouvelle commande COD de test.
          </Notice>
        )}
      </Card>
      {c && (
        <Journal title="Journal YouCan" description="Les 30 derniers événements de cette connexion" events={events} labels={YOUCAN_LABELS} outcomes={SOURCE_OUTCOME} empty={["Aucun événement YouCan", "Une commande COD reçue ou ignorée apparaîtra ici après l’activation."]} />
      )}
      {dialog === "connect" && (
        <FormDialog
          id="youcan-connect"
          title={c ? "Modifier le canal YouCan" : "Nouveau canal YouCan"}
          description="Identifiez la boutique que vous souhaitez connecter. Vous autoriserez ensuite WeConvert dans votre compte YouCan."
          submitLabel={c?.connected_at ? "Enregistrer" : "Enregistrer et autoriser"}
          busy={sub.busy}
          error={sub.error}
          onClose={() => { setDialog(null); sub.reset() }}
          onSubmit={(d) =>
            sub.run(async () => {
              const wasConnected = Boolean(c?.connected_at)
              const saved = await edge<{ id: string }>("weconvert-youcan", "save", { store_id: s.store, channel_name: d.channel_name, public_url: d.public_url || c?.public_url, cod_methods: d.cod_methods })
              await refresh()
              if (wasConnected) {
                setDialog(null)
                toast.success("Nom du canal YouCan mis à jour.")
                return
              }
              const r = await edge<{ authorize_url: string }>("weconvert-youcan", "authorize", { connection_id: saved.id })
              location.assign(r.authorize_url)
            })
          }
        >
          <FormField label="Nom du canal" htmlFor="yc-name" required>
            <Input id="yc-name" name="channel_name" defaultValue={c?.channel_name || ""} required placeholder="Ex. Ma boutique YouCan" maxLength={100} />
          </FormField>
          <FormField
            label="URL de la boutique"
            htmlFor="yc-url"
            required
            hint={c?.connected_at ? "Cette URL est liée à la boutique autorisée. Pour connecter une autre boutique YouCan, créez une boutique CRM distincte." : undefined}
          >
            <Input id="yc-url" name="public_url" type="url" defaultValue={c?.public_url || ""} readOnly={!!c?.connected_at} required placeholder="https://maboutique.youcan.store" maxLength={255} />
          </FormField>
          <FormField label="Autres noms des moyens de paiement COD" htmlFor="yc-cod" hint="Les modes « Cash on Delivery » et « cod » sont déjà reconnus.">
            <Input id="yc-cod" name="cod_methods" defaultValue={(c?.cod_methods || []).filter((x: string) => !DEFAULT_COD.includes(x)).join(", ")} placeholder="Ex. Paiement à la livraison" maxLength={400} />
          </FormField>
        </FormDialog>
      )}
      {dialog === "disconnect" && c && (
        <ConfirmDialog
          title="Déconnecter YouCan"
          body="La réception des nouvelles commandes s’arrêtera. Les commandes et confirmations existantes restent dans WeConvert."
          confirm="Déconnecter"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await edge("weconvert-youcan", "disconnect", { connection_id: c.id })
            setDialog(null)
            toast.success("Connexion YouCan désactivée. Les commandes déjà reçues sont conservées.")
            await refresh()
          }}
        />
      )}
    </section>
  )
}

/* ------------------------------------------------------------ WooCommerce */

function WooCard({ c, events }: { c: Conn; events: Ev[] }) {
  const s = useSession()
  const qc = useQueryClient()
  const connected = !!c?.active
  const [dialog, setDialog] = useState<"connect" | "disconnect" | "products" | null>(null)
  const [setup, setSetup] = useState<{ url: string; secret: string } | null>(null)
  const [progress, setProgress] = useState("")
  const stop = useRef(false)
  const sub = useSubmit()
  const act = useSubmit()
  const refresh = () => qc.invalidateQueries({ queryKey: ["store", s.store] })

  async function runProducts(reset: boolean) {
    if (!c?.id || progress) return
    stop.current = false
    setDialog(null)
    setProgress("Ouverture de l’import des produits…")
    try {
      let first = true
      let r: { done: boolean; scanned: number; page: number }
      do {
        r = await edge("weconvert-woocommerce", "sync_products", { connection_id: c.id, ...(first && reset ? { reset: true } : {}) })
        first = false
        setProgress(`${r.scanned} produit(s) ou variante(s) examinés · page catalogue ${r.page}`)
        await refresh()
      } while (!r.done && !stop.current)
      toast.success(r.done ? "Catalogue synchronisé. Consultez le journal pour les erreurs éventuelles." : "Import arrêté. Vous pourrez reprendre au prochain lot.")
    } catch (e) {
      toast.error(safeError(e))
    } finally {
      setProgress("")
      await refresh()
    }
  }

  const openSetup = () =>
    act.run(async () => {
      setSetup(await edge("weconvert-woocommerce", "setup", { connection_id: c!.id }))
    })

  return (
    <section>
      <Card className="gap-0 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo p="woocommerce" />
            <div>
              <h2 className="font-semibold">WooCommerce</h2>
              <p className="text-sm text-muted-foreground">{connected ? c!.base_url : "Commandes COD · WooCommerce → WeConvert"}</p>
            </div>
          </div>
          <ToneBadge tone={connected ? "success" : "neutral"}>{connected ? "Connexion active" : c ? "Déconnectée" : "À connecter"}</ToneBadge>
        </div>
        <HowItWorks>
          <p>Connectez WooCommerce pour recevoir les nouvelles commandes à confirmer. Le statut WooCommerce décrit la commande sur le site, pas sa confirmation COD dans le CRM. La Suite peut marquer le suivi Purchase indépendamment ; synchronisez les produits ici.</p>
          <p>Les nouvelles commandes arrivent sans agent affecté. Dès qu’une fiche est travaillée, ses informations CRM sont conservées ; toute modification reçue ensuite est signalée pour vérification. Les statuts, stocks et paiements WooCommerce ne sont pas modifiés par WeConvert.</p>
          <p>Les produits simples et les variantes vendables sont rapprochés par SKU. Le stock géré par WooCommerce est importé ; sinon le produit arrive à 0 dans le CRM. Le montant à encaisser conserve remises, taxes et frais en DZD ; les autres devises sont signalées dans le journal.</p>
        </HowItWorks>
        {connected ? (
          <>
            <Facts items={[["API vérifiée", time(c!.last_test_at)], ["Dernier webhook signé", c!.last_webhook_at ? time(c!.last_webhook_at) : "En attente de réception"], ["Dernier import produits", time(c!.last_catalog_sync_at)]]} />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={act.busy}
                onClick={() =>
                  act.run(async () => {
                    await edge("weconvert-woocommerce", "test", { connection_id: c!.id })
                    toast.success("La connexion WooCommerce fonctionne.")
                    await refresh()
                  })
                }
              >
                <RefreshCw />
                Tester la connexion
              </Button>
              <Button variant="outline" onClick={openSetup} disabled={act.busy}><Link2 />Configurer les webhooks</Button>
              <Button variant="outline" onClick={() => setDialog("products")} disabled={!!progress}><Box />Synchroniser les produits</Button>
              {!c!.catalog_done && <Button variant="outline" onClick={() => runProducts(false)} disabled={!!progress}><RefreshCw />Reprendre les produits</Button>}
              <Button variant="outline" onClick={() => setDialog("connect")}><Settings />Modifier les clés</Button>
              <Button variant="outline" onClick={() => setDialog("disconnect")}><LogOut />Déconnecter</Button>
            </div>
            {act.error && <p role="alert" className="mt-3 text-sm text-danger">{act.error}</p>}
            {!c!.last_webhook_at && (
              <Notice className="mt-4">Configurez les deux webhooks pour recevoir les nouvelles commandes lorsque le CRM est fermé. La connexion API seule ne prouve pas que cette réception fonctionne.</Notice>
            )}
          </>
        ) : (
          <>
            <div className="mt-4">
              <Button onClick={() => setDialog("connect")}>
                <Plus />
                {c ? "Reconnecter WooCommerce" : "Connecter WooCommerce"}
              </Button>
            </div>
            <Steps
              items={[
                ["Connectez la boutique", "URL HTTPS et clés API WooCommerce en lecture."],
                ["Activez la réception", "Ajoutez les deux webhooks avec l’URL et le secret fournis."],
                ["Confirmez dans le CRM", "Les statuts Woo restent visibles comme information source ; la confirmation COD doit venir du CRM ou d’une intégration fiable."],
              ]}
            />
          </>
        )}
      </Card>
      {progress && (
        <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-info-soft px-4 py-3 text-sm text-info">
          <span>{progress}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              stop.current = true
              setProgress("Arrêt demandé : fin du lot en cours…")
            }}
          >
            Arrêter après ce lot
          </Button>
        </div>
      )}
      {connected && !c!.catalog_done && !progress && (
        <Notice className="mt-3">Synchronisation des produits en attente : {f(c!.catalog_scanned)} fiches examinées. Vous pouvez reprendre.</Notice>
      )}
      {c && (
        <Journal
          title="Journal de synchronisation WooCommerce"
          description="Les 50 dernières opérations de cette boutique"
          events={events}
          labels={WOO_LABELS}
          outcomes={WOO_OUTCOME}
          empty={["Aucune synchronisation pour le moment", connected ? "Configurez les webhooks pour recevoir une nouvelle commande." : "Connectez WooCommerce pour commencer."]}
          action={(e) =>
            e.external_id && connected && e.entity !== "product" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const r = await edge<{ outcome: string; code?: string }>("weconvert-woocommerce", "retry", { connection_id: c!.id, external_id: Number(e.external_id) })
                    toast(r.outcome === "error" ? WOO_LABELS[r.code || ""] || r.code : "Commande réexaminée. Consultez le journal.")
                    await refresh()
                  } catch (err) {
                    toast.error(safeError(err))
                  }
                }}
              >
                Réessayer
              </Button>
            ) : null
          }
        />
      )}

      {dialog === "connect" && (
        <FormDialog
          id="woo-connect"
          title={c ? "Connexion WooCommerce" : "Connecter WooCommerce"}
          description={<>Dans WordPress : <b>WooCommerce → Réglages → Avancé → API REST → Ajouter une clé</b>, permission <b>Lecture</b>. Les clés sont chiffrées côté serveur et ne seront pas réaffichées.</>}
          submitLabel="Tester et connecter"
          busy={sub.busy}
          error={sub.error}
          onClose={() => { setDialog(null); sub.reset() }}
          onSubmit={(d) =>
            sub.run(async () => {
              await edge("weconvert-woocommerce", "connect", { store_id: s.store, base_url: d.base_url || c?.base_url, key: d.key, secret: d.secret, cod_methods: d.cod_methods })
              setDialog(null)
              toast.success("WooCommerce connecté. Configurez maintenant les webhooks.")
              await refresh()
            })
          }
        >
          <FormField label="URL HTTPS de la boutique" htmlFor="w-url" required>
            <Input id="w-url" name="base_url" type="url" defaultValue={c?.base_url || ""} readOnly={!!c} required placeholder="https://maboutique.com" />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Clé client — Consumer key" htmlFor="w-key" required>
              <Input id="w-key" name="key" type="password" required autoComplete="off" spellCheck={false} placeholder="ck_…" maxLength={43} />
            </FormField>
            <FormField label="Secret client — Consumer secret" htmlFor="w-secret" required>
              <Input id="w-secret" name="secret" type="password" required autoComplete="off" spellCheck={false} placeholder="cs_…" maxLength={43} />
            </FormField>
          </div>
          <FormField label="Identifiants des moyens de paiement COD" htmlFor="w-cod" required hint="Laissez « cod » pour le paiement à la livraison WooCommerce standard. Ajoutez ceux de vos extensions, séparés par des virgules.">
            <Input id="w-cod" name="cod_methods" defaultValue={c?.cod_methods?.join(", ") || "cod"} required maxLength={200} />
          </FormField>
        </FormDialog>
      )}
      {dialog === "products" && (
        <ConfirmDialog
          title="Synchroniser le catalogue WooCommerce"
          body="Les produits simples et les variantes seront importés par lots. Les SKU déjà présents sont rapprochés sans écraser vos changements CRM. Le stock WooCommerce est copié seulement lorsqu’il est géré ; sinon le stock CRM commence à 0."
          confirm="Synchroniser les produits"
          onClose={() => setDialog(null)}
          onConfirm={() => runProducts(true)}
        />
      )}
      {dialog === "disconnect" && c && (
        <ConfirmDialog
          title="Déconnecter WooCommerce"
          body="Les clés seront supprimées du serveur et la réception de nouvelles commandes sera arrêtée. Les commandes, produits et historiques déjà importés sont conservés. Pensez à désactiver les deux webhooks dans WooCommerce."
          confirm="Déconnecter la boutique"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await edge("weconvert-woocommerce", "disconnect", { connection_id: c.id })
            setDialog(null)
            toast.success("Connexion désactivée. Les commandes reçues sont conservées.")
            await refresh()
          }}
        />
      )}
      <Dialog open={!!setup} onOpenChange={(o) => !o && setSetup(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Activer les commandes automatiques</DialogTitle>
            <DialogDescription>
              Dans <b>WooCommerce → Réglages → Avancé → Webhooks</b>, créez deux webhooks : <code>order.created</code> et <code>order.updated</code>. Statut <b>Actif</b>, version <b>WP REST API v3</b>, même URL et même secret.
            </DialogDescription>
          </DialogHeader>
          <FormField label="URL de livraison" htmlFor="wh-url">
            <div className="flex gap-2">
              <Input id="wh-url" readOnly value={setup?.url || ""} className="num text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" size="icon" onClick={() => copy(setup!.url)} aria-label="Copier l’URL"><Copy /></Button>
            </div>
          </FormField>
          <FormField label="Secret de signature — à coller dans les deux webhooks" htmlFor="wh-secret">
            <div className="flex gap-2">
              <Input id="wh-secret" readOnly type="password" value={setup?.secret || ""} autoComplete="off" />
              <Button variant="outline" size="icon" onClick={() => copy(setup!.secret)} aria-label="Copier le secret"><Copy /></Button>
            </div>
          </FormField>
          <Notice>Après activation, vérifiez avec une commande de test COD. « Dernier webhook signé » sera renseigné après réception ; le ping initial WooCommerce ne suffit pas à valider la signature.</Notice>
          <DialogFooter>
            <Button onClick={() => setSetup(null)}>Terminé</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/* ------------------------------------------------------------------- page */

export function Integrations({ tab }: { tab: string }) {
  const s = useSession()
  const [picked, setPicked] = useState<Provider | null>(null)
  const data = useQuery({
    queryKey: ["store", s.store, "integrations"],
    enabled: !!s.store && s.manager,
    queryFn: async () => {
      const [woo, wooEvents, shopify, youcan] = await Promise.all([
        select<Conn>(supabase.from("crm_integrations").select("*").eq("store_id", s.store!).maybeSingle()),
        select<Ev[]>(supabase.from("crm_integration_events").select("*").eq("store_id", s.store!).order("id", { ascending: false }).limit(50)),
        select<Conn>(supabase.from("crm_source_connections").select("*").eq("store_id", s.store!).eq("provider", "shopify").maybeSingle()),
        select<Conn>(supabase.from("crm_source_connections").select("*").eq("store_id", s.store!).eq("provider", "youcan").maybeSingle()),
      ])
      const batches = await Promise.all(
        [shopify.data?.id, youcan.data?.id].map((id) =>
          id ? select<Ev[]>(supabase.from("crm_source_events").select("*").eq("connection_id", id).order("id", { ascending: false }).limit(30)) : null,
        ),
      )
      return { woo: woo.data, wooEvents: wooEvents.data, shopify: shopify.data, youcan: youcan.data, shopifyEvents: batches[0]?.data || [], youcanEvents: batches[1]?.data || [] }
    },
  })

  if (!s.manager)
    return (
      <>
        <PageHeader title="Vos intégrations." description="Les connexions sont gérées par les administrateurs de votre espace." />
        <Card><EmptyState icon={<ShieldCheck />} title="Accès administrateur requis" description="Les commandes des boutiques connectées qui vous sont affectées apparaîtront dans votre file de confirmation." /></Card>
      </>
    )
  const d = data.data
  const fromTab = (tab.replace(/-error$/, "") || null) as Provider | null
  // Opened provider: the one clicked, else the one named by the link (#integrations/shopify), else the first connected.
  const firstConnected: Provider | null = d ? (d.shopify ? "shopify" : d.youcan ? "youcan" : d.woo ? "woocommerce" : null) : null
  const shown: Provider | null = picked ?? (fromTab && fromTab in LOGOS ? fromTab : firstConnected)
  const tiles: [Provider, string, [string, Tone], boolean][] = d
    ? [
        ["shopify", "Boutique Shopify", d.shopify ? SOURCE_STATES[d.shopify.status] || ["À vérifier", "warning"] : ["Non connectée", "neutral"], !!d.shopify],
        ["youcan", "Boutique YouCan", d.youcan ? SOURCE_STATES[d.youcan.status] || ["À vérifier", "warning"] : ["Non connectée", "neutral"], !!d.youcan],
        ["woocommerce", "Site WordPress + WooCommerce", d.woo?.active ? ["Connexion active", "success"] : d.woo ? ["Déconnectée", "neutral"] : ["Non connectée", "neutral"], !!d.woo],
      ]
    : []
  return (
    <>
      <PageHeader title="Vos boutiques, connectées." description="Choisissez votre plateforme : ses nouvelles commandes arrivent directement dans la file de confirmation." />
      {data.isError && <Notice tone="danger" role="alert">{safeError(data.error)}</Notice>}
      {!d ? null : (
        <>
          <ul className="grid gap-3 sm:grid-cols-3" aria-label="Plateformes de vente">
            {tiles.map(([p, line, [label, tone], has]) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(p)
                    // On a phone the detail opens below the tiles: bring it into view.
                    if (matchMedia("(max-width: 639px)").matches) requestAnimationFrame(() => document.getElementById("provider-detail")?.scrollIntoView({ block: "start", behavior: "smooth" }))
                  }}
                  aria-pressed={shown === p}
                  className={cn(
                    "grid h-full w-full gap-3 rounded-xl border bg-card p-4 text-left shadow-sm outline-none transition-colors hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring",
                    shown === p && "border-primary ring-1 ring-primary",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <Logo p={p} className="size-12" />
                    <span className="min-w-0">
                      <b className="block font-semibold">{LOGOS[p][1]}</b>
                      <span className="block text-sm text-muted-foreground">{line}</span>
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <ToneBadge tone={tone}>{label}</ToneBadge>
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                      {has ? "Gérer" : "Connecter"}
                      <ChevronRight className="size-4" aria-hidden />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div id="provider-detail" className="mt-5 scroll-mt-20">
            {shown === "shopify" && <ShopifyCard c={d.shopify} events={d.shopifyEvents} failed={tab === "shopify-error"} />}
            {shown === "youcan" && <YoucanCard c={d.youcan} events={d.youcanEvents} failed={tab === "youcan-error"} />}
            {shown === "woocommerce" && <WooCard c={d.woo} events={d.wooEvents} />}
            {!shown && (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                Sélectionnez une plateforme ci-dessus pour la connecter ou voir son état. Vous pouvez en connecter plusieurs : toutes les commandes arrivent au même endroit.
              </p>
            )}
          </div>
        </>
      )}
    </>
  )
}
