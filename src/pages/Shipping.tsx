import { useEffect, useState } from "react"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { History, Link2, LogOut, Plus, RefreshCw, Search, Settings, ShieldCheck, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState, FormError, FormField, Loading, Notice, PageHeader, Pager } from "@/components/app/page"
import { FormDialog } from "@/components/app/FormDialog"
import { ToneBadge } from "@/components/app/tone"
import { useOrderUI } from "@/components/app/orders"
import { useSubmit } from "@/components/app/useSubmit"
import { rpc, safeError, select } from "@/lib/api"
import { ZR_LABELS, ZR_STATES, edge } from "@/lib/edge"
import { f, money, time } from "@/lib/format"
import { useSession } from "@/lib/session"
import { supabase } from "@/lib/supabase"

type Zr = { id: string; active: boolean; platform: "new" | "legacy"; last_test_at?: string; source_hub_id?: string } | null
type QueueOrder = { id: string; number: number; customer_name: string; phone: string; wilaya: string; commune: string; address: string; delivery_type: string; total: number; items: { name: string; quantity: number }[] }
type Shipment = {
  id: string; order_id: string; number: number; woo_number?: string; sent_at?: string; customer_name: string; wilaya: string; commune: string
  tracking?: string; reference: string; remote_id?: string; platform?: string; state: string; raw_status?: string; last_error?: string; cod_amount: number
  delivery_cost: number | null; return_cost: number | null; other_cost: number | null; last_checked_at?: string; events?: { state: string; raw_status?: string; created_at: string }[]
}
type Loc = { id: string; name: string; code?: number }

export function ZrBadge({ state }: { state: string }) {
  const [label, tone] = ZR_STATES[state] || ZR_STATES.unknown
  return <ToneBadge tone={tone}>{label}</ToneBadge>
}
const code = (n: number) => "#WC" + String(n).padStart(5, "0")
const zrLabel = (c?: string) => (c ? ZR_LABELS[c] || c : "Erreur ZR Express.")

function SendDialog({ order, zr, onClose }: { order: QueueOrder; zr: NonNullable<Zr>; onClose: () => void }) {
  const s = useSession()
  const qc = useQueryClient()
  const sub = useSubmit()
  const [loc, setLoc] = useState<{ cities: Loc[]; districts: Loc[]; cityId: string; districtId: string } | null>(null)
  const [loadErr, setLoadErr] = useState("")
  const [city, setCity] = useState("")
  const [district, setDistrict] = useState("")
  const newer = zr.platform === "new"

  useEffect(() => {
    if (!newer) return
    edge("weconvert-zr", "locations", { connection_id: zr.id, order_id: order.id })
      .then((r) => {
        setLoc(r)
        setCity(r.cityId || "")
        setDistrict(r.districtId || "")
      })
      .catch((e) => setLoadErr(safeError(e)))
  }, [newer, zr.id, order.id])

  async function pickCity(id: string) {
    setCity(id)
    setDistrict("")
    try {
      const r = await edge("weconvert-zr", "locations", { connection_id: zr.id, order_id: order.id, city_id: id })
      if (r.cityId === id) setLoc((l) => (l ? { ...l, districts: r.districts } : l))
    } catch (e) {
      setLoadErr(safeError(e))
    }
  }

  const items = order.items.map((i) => i.quantity + " × " + i.name).join(" ; ")
  return (
    <FormDialog
      id="zr-send"
      wide
      title={"Créer le colis ZR · " + code(order.number)}
      description="Vérifiez la destination dans le référentiel du transporteur. L’envoi ne peut pas être annulé dans WeConvert et ne sera pas répété en cas de réponse incertaine."
      submitLabel="Créer le colis chez ZR"
      busy={sub.busy}
      error={sub.error || loadErr}
      onClose={onClose}
      onSubmit={(d) =>
        sub.run(async () => {
          await edge("weconvert-zr", "send", { connection_id: zr.id, order_id: order.id, ...(newer ? { city_id: city, district_id: district } : { wilaya_code: d.wilaya_code }) })
          toast.success("Colis créé chez ZR.")
          await qc.invalidateQueries({ queryKey: ["store", s.store] })
          onClose()
        })
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-muted p-4 text-sm">
          <p className="text-xs text-muted-foreground">Client et destination</p>
          <p className="mt-1 font-semibold">{order.customer_name}</p>
          <p className="num">{order.phone} · {order.wilaya} · {order.commune}</p>
          <p className="text-muted-foreground">{order.address}</p>
        </div>
        <div className="rounded-lg bg-muted p-4 text-sm">
          <p className="text-xs text-muted-foreground">Montant COD à encaisser</p>
          <p className="num mt-1 text-xl font-semibold">{money(order.total)}</p>
          <p className="text-muted-foreground">{items}</p>
        </div>
      </div>
      {newer ? (
        !loc ? (
          !loadErr && <Loading text="Recherche des destinations ZR…" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Wilaya ZR" htmlFor="zr-city" required>
              <NativeSelect id="zr-city" required value={city} onChange={(e) => pickCity(e.target.value)}>
                <NativeSelectOption value="">Choisir la wilaya</NativeSelectOption>
                {loc.cities.map((x) => (
                  <NativeSelectOption key={x.id} value={x.id}>
                    {String(x.code).padStart(2, "0")} · {x.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Commune ZR" htmlFor="zr-district" required>
              <NativeSelect id="zr-district" required value={district} onChange={(e) => setDistrict(e.target.value)}>
                <NativeSelectOption value="">Choisir la commune</NativeSelectOption>
                {loc.districts.map((x) => (
                  <NativeSelectOption key={x.id} value={x.id}>
                    {x.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
          </div>
        )
      ) : (
        <FormField label="Code officiel de la wilaya (1–69)" htmlFor="zr-wcode" required>
          <Input id="zr-wcode" name="wilaya_code" type="number" min={1} max={69} step={1} required defaultValue={(order.wilaya.match(/^\s*(\d{1,2})(?:\s|[-–.])/) || [])[1] || ""} className="num" />
        </FormField>
      )}
    </FormDialog>
  )
}

function ConnectDialog({ zr, onClose }: { zr: Zr; onClose: () => void }) {
  const s = useSession()
  const qc = useQueryClient()
  const sub = useSubmit()
  const [platform, setPlatform] = useState<"new" | "legacy">(zr?.platform || "new")
  const [hubs, setHubs] = useState<{ id: string; name: string; city: string }[] | null>(null)
  const [hubHint, setHubHint] = useState("Saisissez vos identifiants puis recherchez le dépôt de départ.")
  const [hub, setHub] = useState(zr?.source_hub_id || "")
  const newer = platform === "new"

  async function findHubs(form: HTMLFormElement) {
    const d = Object.fromEntries(new FormData(form)) as Record<string, string>
    try {
      const r = await edge<{ hubs: { id: string; name: string; city: string }[] }>("weconvert-zr", "hubs", { store_id: s.store, platform: "new", first: d.first, second: d.second })
      setHubs(r.hubs)
      setHubHint(r.hubs.length ? `${r.hubs.length} dépôt(s) trouvé(s). Choisissez-en un ci-dessus.` : "Aucun dépôt trouvé sur ce compte ZR.")
      if (r.hubs.length === 1) setHub(r.hubs[0].id)
    } catch (e) {
      setHubHint(safeError(e))
    }
  }

  return (
    <FormDialog
      id="zr-connect"
      title={zr ? "Configurer ZR Express" : "Connecter ZR Express"}
      description="Connectez les identifiants API de votre compte ZR. Le test lit seulement les accès ; il ne crée aucun colis. Les clés sont chiffrées côté serveur et jamais réaffichées."
      submitLabel="Tester et connecter"
      busy={sub.busy}
      error={sub.error}
      onClose={onClose}
      onSubmit={(d) =>
        sub.run(async () => {
          await edge("weconvert-zr", "connect", { store_id: s.store, platform, first: d.first, second: d.second, ...(newer ? { source_hub_id: hub } : {}) })
          toast.success("Connexion ZR vérifiée et enregistrée.")
          await qc.invalidateQueries({ queryKey: ["store", s.store] })
          onClose()
        })
      }
    >
      <FormField label="Plateforme ZR" htmlFor="zr-platform" required>
        <NativeSelect id="zr-platform" value={platform} onChange={(e) => setPlatform(e.target.value as "new" | "legacy")}>
          <NativeSelectOption value="new">Nouvelle plateforme · app.zrexpress.app</NativeSelectOption>
          <NativeSelectOption value="legacy">Historique · Token et Clé</NativeSelectOption>
        </NativeSelect>
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2" key={platform}>
        <FormField label={newer ? "Tenant ID (UUID)" : "Token API"} htmlFor="zr-first" required>
          <Input id="zr-first" name="first" required autoComplete="off" spellCheck={false} maxLength={250} placeholder={newer ? "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" : "Token ZR"} />
        </FormField>
        <FormField label={newer ? "Secret Key / API Key" : "Clé API"} htmlFor="zr-second" required>
          <Input id="zr-second" name="second" type="password" required autoComplete="off" spellCheck={false} maxLength={250} />
        </FormField>
      </div>
      {newer && (
        <FormField label="Dépôt de départ ZR" htmlFor="zr-hub" required hint={hubHint}>
          <div className="flex gap-2">
            {hubs?.length ? (
              <NativeSelect id="zr-hub" required value={hub} onChange={(e) => setHub(e.target.value)}>
                <NativeSelectOption value="">Choisir le dépôt</NativeSelectOption>
                {hubs.map((h) => (
                  <NativeSelectOption key={h.id} value={h.id}>
                    {h.name} · {h.city}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : (
              <Input id="zr-hub" required value={hub} onChange={(e) => setHub(e.target.value)} autoComplete="off" spellCheck={false} maxLength={36} placeholder="UUID du dépôt" />
            )}
            <Button type="button" variant="outline" onClick={(e) => findHubs((e.currentTarget as HTMLButtonElement).form!)}>
              <Search />
              Trouver
            </Button>
          </div>
        </FormField>
      )}
    </FormDialog>
  )
}

export function Shipping() {
  const s = useSession()
  const qc = useQueryClient()
  const ui = useOrderUI()
  const [status, setStatus] = useState("all")
  const [page, setPage] = useState(1)
  const [scanPage, setScanPage] = useState(1)
  const [dialog, setDialog] = useState<null | { kind: "connect" | "disconnect" | "link" } | { kind: "send"; order: QueueOrder } | { kind: "history" | "reconcile" | "cost"; shipment: Shipment }>(null)
  const act = useSubmit()
  const sub = useSubmit()
  const refresh = () => qc.invalidateQueries({ queryKey: ["store", s.store] })

  const conn = useQuery({
    queryKey: ["store", s.store, "zr"],
    enabled: !!s.store && s.manager,
    queryFn: async () => (await select<Zr>(supabase.from("crm_shipping_connections").select("*").eq("store_id", s.store!).maybeSingle())).data,
  })
  const dash = useQuery({
    queryKey: ["store", s.store, "zr-queue"],
    enabled: !!s.store && s.manager,
    queryFn: () => rpc<{ queue: QueueOrder[] }>("crm_shipping_dashboard", { p_store: s.store }),
  })
  const list = useQuery({
    queryKey: ["store", s.store, "zr-shipments", status, page],
    enabled: !!s.store && s.manager,
    placeholderData: keepPreviousData,
    queryFn: () => rpc<{ shipments: Shipment[]; total: number }>("crm_shipping_filtered_page", { p_store: s.store, p_page: page, p_status: status }),
  })
  useEffect(() => setPage(1), [status, s.store])
  const total = Number(list.data?.total || 0)
  const shipments = list.data?.shipments || []
  useEffect(() => {
    if (page > 1 && list.data && !shipments.length && total > 0) setPage(Math.ceil(total / 50))
  }, [page, list.data, shipments.length, total])

  if (!s.manager)
    return (
      <>
        <PageHeader title="Livraisons." description="La connexion transporteur et les envois sont gérés par les administrateurs." />
        <Card><EmptyState icon={<ShieldCheck />} title="Accès administrateur requis" description="Vos commandes confirmées restent visibles dans Commandes." /></Card>
      </>
    )

  const zr = conn.data || null
  const connected = !!zr?.active
  const queue = dash.data?.queue || []

  const scan = () =>
    act.run(async () => {
      let p = scanPage, linked = 0, updated = 0, unmatched = 0, conflict = 0, scanned = 0, next: number | null = null
      for (let i = 0; i < 5; i++) {
        const r = await edge("weconvert-zr", "scan", { connection_id: zr!.id, page: p })
        linked += r.linked; updated += r.updated; unmatched += r.unmatched; conflict += r.conflict; scanned += r.scanned
        next = r.next_page
        if (!next) break
        p = next
      }
      setScanPage(next || 1)
      setPage(1)
      toast(`${scanned} colis vérifiés · ${linked} rattachés · ${updated} actualisés · ${conflict} conflits · ${unmatched} sans correspondance.`)
      await refresh()
    })
  const sync = () =>
    act.run(async () => {
      let p = 1, checked = 0, changed = 0, errors = 0, next: number | null = null
      do {
        const r = await edge("weconvert-zr", "sync", { connection_id: zr!.id, page: p })
        checked += r.checked; changed += r.changed; errors += r.errors
        next = r.next_page
        p = next || 0
      } while (next && p <= 5)
      toast(`${checked} suivis lus · ${changed} nouveaux statuts · ${errors} erreurs.`)
      await refresh()
    })

  return (
    <>
      <PageHeader
        title="Vos livraisons, suivies."
        description="Préparez vos commandes confirmées et suivez chaque colis ZR Express."
        actions={
          <Button size="lg" variant={connected ? "outline" : "default"} onClick={() => setDialog({ kind: "connect" })}>
            {connected ? <Settings /> : <Plus />}
            {connected ? "Configurer ZR Express" : "Connecter ZR Express"}
          </Button>
        }
      />
      <Card className="gap-0 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Truck className="size-[18px]" aria-hidden /></span>
            <div>
              <h2 className="font-semibold">ZR Express</h2>
              <p className="text-sm text-muted-foreground">{connected ? (zr!.platform === "new" ? "Nouvelle plateforme · API ZR Express" : "Plateforme historique · API Procolis") : "Transporteur à connecter pour cette boutique"}</p>
            </div>
          </div>
          <ToneBadge tone={connected ? "success" : "neutral"}>{connected ? "Connexion active" : zr ? "Déconnectée" : "À connecter"}</ToneBadge>
        </div>
        <p className="mt-4 text-sm">Un colis est envoyé seulement après votre validation. La confirmation CRM et le statut transporteur restent distincts. Le montant affiché est le COD demandé, pas un encaissement prouvé.</p>
        {connected ? (
          <>
            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              {[["Dernier test API", time(zr!.last_test_at)], ["Commandes prêtes (limite 50)", f(queue.length)], ["Colis affichés (page de 50)", f(shipments.length)]].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-muted p-3"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="num mt-1 text-sm font-semibold">{v}</dd></div>
              ))}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {zr!.platform === "new" && (
                <>
                  <Button variant="outline" onClick={scan} disabled={act.busy}><Link2 />{scanPage > 1 ? "Continuer l’import ZR · page " + scanPage : "Rattacher les colis ZR existants"}</Button>
                  <Button variant="outline" onClick={() => setDialog({ kind: "link" })}><Search />Rattacher un suivi précis</Button>
                </>
              )}
              <Button variant="outline" onClick={sync} disabled={act.busy}><RefreshCw />Synchroniser les statuts</Button>
              <Button
                variant="outline"
                disabled={act.busy}
                onClick={() =>
                  act.run(async () => {
                    await edge("weconvert-zr", "test", { connection_id: zr!.id })
                    toast.success("Connexion ZR fonctionnelle.")
                    await refresh()
                  })
                }
              >
                <RefreshCw />Tester la connexion
              </Button>
              <Button variant="outline" onClick={() => setDialog({ kind: "disconnect" })}><LogOut />Déconnecter</Button>
            </div>
            {act.busy && <p role="status" className="mt-3 text-sm text-muted-foreground">Opération ZR en cours…</p>}
            <FormError message={act.error} />
            <p className="mt-3 text-xs text-muted-foreground">L’import lit le compte ZR sans créer de colis. Un rapprochement exige référence Woo, téléphone et montant COD identiques. Les colis sans preuve restent séparés.</p>
          </>
        ) : (
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            {[["Préparez les commandes", "Confirmez le client, l’adresse et le montant COD."], ["Connectez ZR", "Sélectionnez votre plateforme et testez vos clés API."], ["Envoyez et suivez", "Créez chaque colis puis vérifiez son statut auprès de ZR."]].map(([t, d], i) => (
              <li key={t} className="rounded-lg border p-3"><b className="text-sm">{i + 1}. {t}</b><p className="mt-1 text-sm text-muted-foreground">{d}</p></li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="mt-5 gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4 sm:px-6">
          <div>
            <h2 className="font-semibold">Prêtes à expédier</h2>
            <p className="text-sm text-muted-foreground">Commandes confirmées, sans colis et sans alerte source</p>
          </div>
          <span className="num rounded-full bg-muted px-3 py-1 text-xs font-medium">{f(queue.length)} affichées</span>
        </div>
        {!queue.length ? (
          <EmptyState title="Aucune commande prête" description="Confirmez une commande avec une adresse complète dans votre boutique." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60"><TableHead>Commande</TableHead><TableHead>Client</TableHead><TableHead>Destination</TableHead><TableHead>Articles</TableHead><TableHead className="text-right">Montant COD</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
              <TableBody>
                {queue.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell><button type="button" className="num font-semibold text-primary hover:underline" onClick={() => ui.openOrder(o.id)}>{code(o.number)}</button></TableCell>
                    <TableCell>{o.customer_name}<span className="num block text-xs text-muted-foreground">{o.phone}</span></TableCell>
                    <TableCell>{o.wilaya} · {o.commune}<span className="block text-xs text-muted-foreground">{o.delivery_type === "desk" ? "Point de retrait" : "Domicile"}</span></TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-sm">{o.items.map((i) => i.quantity + " × " + i.name).join(" ; ")}</TableCell>
                    <TableCell className="num text-right font-semibold">{money(o.total)}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        disabled={!connected}
                        title={!connected ? "Connectez ZR Express" : undefined}
                        onClick={() => {
                          if (zr!.platform === "new" && o.delivery_type === "desk") return toast.error(ZR_LABELS.PICKUP_UNAVAILABLE)
                          setDialog({ kind: "send", order: o })
                        }}
                      >
                        <Truck />Créer le colis
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Card className="mt-5 gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 sm:px-6">
          <div>
            <h2 className="font-semibold">Colis ZR Express</h2>
            <p className="text-sm text-muted-foreground">Relisez les statuts et renseignez les frais ZR pour la marge.</p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh}><RefreshCw />Actualiser</Button>
        </div>
        <div className="px-4 pb-3 sm:px-6">
          <Tabs value={status} onValueChange={setStatus}>
            <TabsList aria-label="Filtrer les colis ZR par statut">
              {[["all", "Toutes"], ["delivered", "Livrées"], ["returned", "Retournées"], ["other", "Autres statuts"]].map(([id, label]) => (
                <TabsTrigger key={id} value={id} className="px-3">{label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {!shipments.length ? (
          <EmptyState
            title={status === "delivered" ? "Aucune commande livrée" : status === "returned" ? "Aucun retour" : "Aucun colis"}
            description={status === "all" ? "Rattachez un colis ZR existant ou créez-en un depuis une commande confirmée." : "Aucun colis ZR rattaché ne correspond à ce statut."}
          />
        ) : (
          <div className="overflow-x-auto border-t">
            <Table>
              <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60"><TableHead>Envoi</TableHead><TableHead>Client</TableHead><TableHead>Référence ZR</TableHead><TableHead>Statut ZR</TableHead><TableHead className="text-right">Montant COD</TableHead><TableHead className="text-right">Frais ZR</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
              <TableBody>
                {shipments.map((x) => (
                  <TableRow key={x.id}>
                    <TableCell>
                      <button type="button" className="num font-semibold text-primary hover:underline" onClick={() => ui.openOrder(x.order_id)}>{code(x.number)}</button>
                      <span className="num block text-xs text-muted-foreground">{x.woo_number ? `Woo #${x.woo_number} · ` : ""}{time(x.sent_at)}</span>
                    </TableCell>
                    <TableCell>{x.customer_name}<span className="block text-xs text-muted-foreground">{x.wilaya} · {x.commune}</span></TableCell>
                    <TableCell className="num">{x.tracking || x.reference}</TableCell>
                    <TableCell><ZrBadge state={x.state} /><span className="mt-1 block text-xs text-muted-foreground">{x.raw_status || (x.last_error && zrLabel(x.last_error)) || "—"}</span></TableCell>
                    <TableCell className="num text-right">{money(x.cod_amount)}</TableCell>
                    <TableCell className="num text-right">{x.delivery_cost !== null ? money(x.delivery_cost) : <span className="text-warning">À renseigner</span>}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {x.state === "needs_review" ? (
                          <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "reconcile", shipment: x })}>Rapprocher</Button>
                        ) : x.state === "sending" ? (
                          <span className="text-sm text-muted-foreground">En cours…</span>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={act.busy}
                            onClick={() =>
                              act.run(async () => {
                                await edge("weconvert-zr", "track", { connection_id: zr!.id, shipment_id: x.id })
                                toast.success("Statut ZR vérifié.")
                                await refresh()
                              })
                            }
                          >
                            <RefreshCw />Suivi
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "history", shipment: x })}><History />Historique</Button>
                        <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "cost", shipment: x })}>Frais</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <Pager total={total} page={page} size={50} onPage={(p) => setPage(Math.max(1, p))} />
      </Card>
      <Notice className="mt-4">En cas de délai ou d’erreur pendant la création, cherchez la référence dans ZR avant de rapprocher le colis. WeConvert ne renvoie jamais automatiquement une création incertaine.</Notice>

      {dialog?.kind === "connect" && <ConnectDialog zr={zr} onClose={() => setDialog(null)} />}
      {dialog?.kind === "send" && zr && <SendDialog order={dialog.order} zr={zr} onClose={() => setDialog(null)} />}
      {dialog?.kind === "disconnect" && zr && (
        <FormDialog
          id="zr-disconnect"
          title="Déconnecter ZR Express"
          description="Les identifiants seront supprimés côté serveur et aucun suivi ZR ne pourra être relu avant reconnexion. Les colis et leurs historiques restent visibles."
          submitLabel="Déconnecter ZR"
          busy={sub.busy}
          error={sub.error}
          onClose={() => { setDialog(null); sub.reset() }}
          onSubmit={() =>
            sub.run(async () => {
              await edge("weconvert-zr", "disconnect", { connection_id: zr.id })
              setDialog(null)
              toast.success("Connexion ZR désactivée. Les colis restent visibles.")
              await refresh()
            })
          }
        >
          <span className="sr-only">Confirmation</span>
        </FormDialog>
      )}
      {dialog?.kind === "link" && zr && (
        <FormDialog
          id="zr-link"
          title="Rattacher un colis existant"
          description="Indiquez le numéro WooCommerce et le suivi ZR du même colis. Le serveur vérifie aussi le téléphone et le montant COD."
          submitLabel="Vérifier et rattacher"
          busy={sub.busy}
          error={sub.error}
          onClose={() => { setDialog(null); sub.reset() }}
          onSubmit={(d) =>
            sub.run(async () => {
              const r = await edge<{ outcome: string }>("weconvert-zr", "link", { connection_id: zr.id, order_ref: d.order_ref, tracking: d.tracking })
              setDialog(null)
              toast.success(r.outcome === "linked" ? "Colis ZR rattaché à la commande Woo." : "Suivi ZR mis à jour.")
              await refresh()
            })
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Numéro de commande WooCommerce" htmlFor="l-ref" required><Input id="l-ref" name="order_ref" required maxLength={80} /></FormField>
            <FormField label="Numéro de suivi ou ID ZR" htmlFor="l-track" required><Input id="l-track" name="tracking" required minLength={3} maxLength={100} /></FormField>
          </div>
        </FormDialog>
      )}
      {dialog?.kind === "reconcile" && zr && (
        <FormDialog
          id="zr-reconcile"
          title="Rapprocher un envoi incertain"
          description={<>Cherchez <b>{dialog.shipment.reference}</b> dans votre compte ZR. Si le colis existe, indiquez sa référence de suivi ou son ID ZR. Le serveur vérifie que son identifiant externe correspond à cette commande.</>}
          submitLabel="Vérifier et rapprocher"
          busy={sub.busy}
          error={sub.error}
          onClose={() => { setDialog(null); sub.reset() }}
          onSubmit={(d) =>
            sub.run(async () => {
              await edge("weconvert-zr", "reconcile", { connection_id: zr.id, shipment_id: dialog.shipment.id, tracking: d.tracking })
              setDialog(null)
              toast.success("Colis ZR rapproché.")
              await refresh()
            })
          }
        >
          <FormField label="Numéro de suivi ou ID de colis ZR" htmlFor="r-track" required>
            <Input id="r-track" name="tracking" required minLength={3} maxLength={100} defaultValue={dialog.shipment.remote_id || (dialog.shipment.platform === "legacy" ? dialog.shipment.reference : "")} />
          </FormField>
        </FormDialog>
      )}
      {dialog?.kind === "cost" && (
        <CostDialog shipment={dialog.shipment} onClose={() => setDialog(null)} />
      )}
      <Dialog open={dialog?.kind === "history"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          {dialog?.kind === "history" && (
            <>
              <DialogHeader>
                <DialogTitle>Suivi · {dialog.shipment.tracking || dialog.shipment.reference}</DialogTitle>
                <DialogDescription>Dernière vérification : {time(dialog.shipment.last_checked_at)}</DialogDescription>
              </DialogHeader>
              <ZrBadge state={dialog.shipment.state} />
              <ol className="grid gap-3 border-l pl-4">
                {(dialog.shipment.events || []).map((e, i) => (
                  <li key={i} className="relative">
                    <span aria-hidden className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-primary" />
                    <ZrBadge state={e.state} />
                    <p className="mt-1 text-sm">{e.raw_status || "Création du colis"}</p>
                    <p className="num text-xs text-muted-foreground">{time(e.created_at)}</p>
                  </li>
                ))}
              </ol>
              <DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Fermer</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function CostDialog({ shipment, onClose }: { shipment: Shipment; onClose: () => void }) {
  const s = useSession()
  const qc = useQueryClient()
  const sub = useSubmit()
  return (
    <FormDialog
      id="shipment-cost-form"
      title={"Frais ZR · " + code(shipment.number)}
      description="Reportez les frais réellement facturés par ZR : livraison, éventuel retour et autre frais. Mettez 0 quand un frais est confirmé gratuit."
      submitLabel="Enregistrer"
      busy={sub.busy}
      error={sub.error}
      onClose={onClose}
      onSubmit={(d) =>
        sub.run(async () => {
          await rpc("crm_cost_command", { p_store: s.store, p_action: "shipment", p: { shipment_id: shipment.id, delivery_cost: Number(d.delivery_cost), return_cost: Number(d.return_cost), other_cost: Number(d.other_cost) } })
          toast.success("Coût enregistré.")
          await qc.invalidateQueries({ queryKey: ["store", s.store] })
          onClose()
        })
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Frais de livraison (DA)" htmlFor="c-del" required><Input id="c-del" name="delivery_cost" type="number" min={0} step={0.01} required defaultValue={shipment.delivery_cost ?? ""} className="num" /></FormField>
        <FormField label="Frais de retour (DA)" htmlFor="c-ret" required><Input id="c-ret" name="return_cost" type="number" min={0} step={0.01} required defaultValue={shipment.return_cost ?? 0} className="num" /></FormField>
        <FormField label="Autres frais (DA)" htmlFor="c-oth" required><Input id="c-oth" name="other_cost" type="number" min={0} step={0.01} required defaultValue={shipment.other_cost ?? 0} className="num" /></FormField>
      </div>
    </FormDialog>
  )
}

