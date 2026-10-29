import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ArrowDownUp, Columns3, Download, ExternalLink, Inbox, PackageCheck, PackageOpen, PhoneCall, Plus, RotateCcw, Search, SlidersHorizontal, Truck, Undo2, Users, X, XCircle, type LucideIcon } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CHANNELS, STATUS, STATUS_ORDER, csvCell } from "@domain/domain.mjs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { FormField, PageHeader, Pager } from "@/components/app/page"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ORDER_COLUMNS, OrdersTable, useOrderUI } from "@/components/app/orders"
import { rpc, safeError, select } from "@/lib/api"
import { f, money, orderCode, time } from "@/lib/format"
import { boardArgs, useOrderBoard } from "@/lib/queries"
import { ZR_STATES } from "@/lib/edge"
import { navigate } from "@/lib/router"
import { useSession } from "@/lib/session"
import { supabase } from "@/lib/supabase"
import type { Order, OrderBoard, OrderStage } from "@/lib/types"
import { cn } from "@/lib/utils"

export function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i
const REASONS: Record<string, string> = { CUSTOMER_REQUIRED: "Nom du client absent", INVALID_PHONE: "Téléphone absent ou invalide", WILAYA_REQUIRED: "Wilaya absente" }
const YOUCAN_SKIP: Record<string, string> = {
  CUSTOMER_REQUIRED: "Nom du client toujours absent sur YouCan.",
  INVALID_PHONE: "Téléphone toujours absent ou invalide sur YouCan.",
  WILAYA_REQUIRED: "Wilaya toujours absente sur YouCan.",
}

function YoucanAlerts() {
  const s = useSession()
  const qc = useQueryClient()
  const alerts = useQuery({
    queryKey: ["store", s.store, "youcan-alerts"],
    enabled: !!s.store && s.manager,
    queryFn: async () => {
      const conn = await select<{ id: string } | null>(supabase.from("crm_source_connections").select("id").eq("store_id", s.store!).eq("provider", "youcan").maybeSingle())
      if (!conn.data) return { connection: null, items: [] as any[] }
      const ev = await select<any[]>(
        supabase.from("crm_source_events").select("id,external_id,outcome,code,created_at").eq("connection_id", conn.data.id).not("external_id", "is", null).order("id", { ascending: false }).limit(100),
      )
      const latest = new Map<string, any>()
      for (const e of ev.data) if (!latest.has(e.external_id)) latest.set(e.external_id, e)
      return {
        connection: conn.data.id,
        items: [...latest.values()].filter((e) => e.outcome === "skipped" && REASONS[e.code]).slice(0, 10),
      }
    },
  })
  const [busy, setBusy] = useState("")
  if (!alerts.data?.items.length) return null
  return (
    <Card role="status" className="mb-5 gap-3 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Commandes YouCan à compléter</h2>
          <p className="text-sm text-muted-foreground">Ces commandes sont reçues, mais ne sont pas encore dans la file de confirmation ni dans les statistiques COD.</p>
        </div>
      </div>
      <ul className="grid gap-2">
        {alerts.data.items.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
            <span>
              <b className="num">{time(e.created_at)}</b> · {REASONS[e.code]}
            </span>
            {UUID.test(e.external_id || "") && (
              <span className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={`https://seller-area.youcan.shop/admin/orders/${encodeURIComponent(e.external_id)}/edit`} target="_blank" rel="noopener noreferrer">
                    Compléter sur YouCan
                    <ExternalLink />
                  </a>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy(e.external_id)
                    try {
                      const { data, error } = await supabase.functions.invoke("weconvert-youcan", {
                        body: { action: "retry_order", connection_id: alerts.data!.connection, external_id: e.external_id },
                      })
                      if (error) throw error
                      if (data?.error) throw Object.assign(Error(data.error), { youcanCode: data.error })
                      toast(data?.outcome === "skipped" ? YOUCAN_SKIP[data.code] || data.code : "Commande YouCan réexaminée.")
                      await qc.invalidateQueries({ queryKey: ["store", s.store] })
                    } catch (err) {
                      toast.error(safeError(err))
                    } finally {
                      setBusy("")
                    }
                  }}
                >
                  <RotateCcw />
                  Réessayer
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

// Logistic stages (Confirmoo "New order → In preparation → Dispatched → Delivered | Returned").
// Dispatched / delivered / returned come from the carrier parcel: a carrier state, not a cash collection.
const STAGES: { id: "all" | OrderStage; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "all", label: "Toutes", hint: "Toutes les commandes", icon: Inbox },
  { id: "new", label: "À confirmer", hint: "À confirmer : nouvelle, appels, reportée, à vérifier", icon: PhoneCall },
  { id: "preparing", label: "En préparation", hint: "Confirmées, pas encore remises au transporteur", icon: PackageOpen },
  { id: "dispatched", label: "Expédiées", hint: "Colis chez le transporteur", icon: Truck },
  { id: "delivered", label: "Livrées", hint: "Livré selon le transporteur (encaissement non vérifié)", icon: PackageCheck },
  { id: "returned", label: "Retournées", hint: "Retour confirmé par le transporteur", icon: Undo2 },
  { id: "closed", label: "Clôturées", hint: "Annulées, doublons et faux numéros", icon: XCircle },
]
// Old links (#orders/pending, #orders/cancelled_all, #orders/confirmed) keep working.
const ALIASES: Record<string, { stage: string; status: string }> = {
  pending: { stage: "new", status: "all" },
  cancelled_all: { stage: "closed", status: "all" },
  confirmed: { stage: "all", status: "confirmed" },
}
const COLUMNS_KEY = "weconvert.orders.columns"
function readColumns() {
  try {
    const v = JSON.parse(localStorage.getItem(COLUMNS_KEY) || "null")
    if (Array.isArray(v)) return new Set<string>(v.filter((x) => ORDER_COLUMNS.some(([k]) => k === x)))
  } catch {}
  return new Set(ORDER_COLUMNS.map(([k]) => k))
}

export function Orders({ tab }: { tab: string }) {
  const s = useSession()
  const ui = useOrderUI()
  const route = ALIASES[tab] || { stage: STAGES.some((x) => x.id === tab) ? tab : "all", status: "all" }
  const stage = route.stage
  const [status, setStatus] = useState(route.status)
  const [q, setQ] = useState("")
  const query = useDebounced(q)
  const [page, setPage] = useState(1)
  const [agent, setAgent] = useState("")
  const [ascending, setAscending] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [columns, setColumns] = useState(readColumns)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const list = useOrderBoard({ stage, status, q: query, page, agent, ascending })
  const orders = list.data?.items || []
  const total = list.data?.total || 0
  const counts = list.data?.stages || {}
  const all = Object.values(counts).reduce((n, x) => n + (x || 0), 0)
  const activeFilters = (agent ? 1 : 0) + (ascending ? 1 : 0) + (status !== "all" ? 1 : 0)
  const pageCod = orders.reduce((n, x) => n + (Number(x.total) || 0), 0)
  const pageConfirmed = orders.filter((x) => x.stage === "preparing" || x.stage === "dispatched").length

  // A legacy link sets a status filter; a stage card click clears it.
  useEffect(() => setStatus(route.status), [tab]) // eslint-disable-line react-hooks/exhaustive-deps
  // Filters reset pagination and selection; live refreshes do not touch either.
  useEffect(() => {
    setPage(1)
    setSelected(new Set())
  }, [stage, status, query, agent, ascending, s.store])
  // A live refresh can move a selected order out of this filter: keep only rows still on screen.
  useEffect(() => {
    if (!list.data) return
    setSelected((prev) => {
      const visible = new Set(list.data!.items.map((x) => x.id))
      const kept = [...prev].filter((id) => visible.has(id))
      return kept.length === prev.size ? prev : new Set(kept)
    })
  }, [list.data])
  useEffect(() => {
    if (page > 1 && list.data && !orders.length && total > 0) setPage(Math.ceil(total / 20))
  }, [page, list.data, orders.length, total])

  function toggleColumn(k: string, on: boolean) {
    setColumns((prev) => {
      const n = new Set(prev)
      on ? n.add(k) : n.delete(k)
      try {
        localStorage.setItem(COLUMNS_KEY, JSON.stringify([...n]))
      } catch {}
      return n
    })
  }

  async function exportCsv() {
    setExporting(true)
    try {
      const seen = new Map<string, Order>()
      const started = Date.now()
      let p = 1
      let count = Infinity
      while (seen.size < count && p <= 1000) {
        const data = await rpc<OrderBoard>("crm_order_board", boardArgs(s.store, { stage, status, q: query, page: p++, size: 100, agent, ascending }))
        count = data.total
        for (const x of data.items) if (!seen.has(x.id) && Date.parse(x.created_at) <= started) seen.set(x.id, x)
        if (!data.items.length) break
      }
      const rows = [...seen.values()]
      const stageName = (x: Order) => STAGES.find((st) => st.id === x.stage)?.label || ""
      const head = ["Commande", "Client", "Téléphone", "Wilaya", "Commune", "Adresse", "Canal", "Statut", "Étape", "Livraison (transporteur)", "Suivi", "Agent", "Montant COD", "Créée le"]
      const csv =
        "\ufeff" +
        [
          head,
          ...rows.map((x) => [
            orderCode(x), x.customer_name, x.phone, x.wilaya, x.commune, x.address, CHANNELS[x.channel], STATUS[x.status][0], stageName(x),
            x.shipment ? (ZR_STATES[x.shipment.state] || [x.shipment.state])[0] : "", x.shipment?.tracking || "", s.memberName(x.assigned_to), x.total,
            new Date(x.created_at).toLocaleString("fr-FR", { timeZone: "Africa/Algiers" }),
          ]),
        ]
          .map((r) => r.map(csvCell).join(";"))
          .join("\r\n")
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
      const a = document.createElement("a")
      a.href = url
      a.download = "WeConvert-commandes.csv"
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success(rows.length + " commandes exportées.")
    } catch (e) {
      toast.error(safeError(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Vos commandes, sous contrôle."
        description="Centralisez, vérifiez et confirmez chaque commande."
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={exporting} aria-busy={exporting}>
              <Download />
              {exporting ? "Export en cours…" : "Exporter (" + f(total) + ")"}
            </Button>
            <Button onClick={ui.newOrder}>
              <Plus />
              Nouvelle commande
            </Button>
          </>
        }
      />
      <YoucanAlerts />
      <nav aria-label="Étapes des commandes" className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {STAGES.map((x) => {
          const n = x.id === "all" ? all : counts[x.id] || 0
          const on = stage === x.id && status === "all"
          return (
            <button
              key={x.id}
              type="button"
              title={x.hint}
              aria-label={`${x.label} : ${list.data ? n : "chargement"} — ${x.hint}`}
              aria-pressed={on}
              onClick={() => {
                setStatus("all")
                navigate("orders", x.id === "all" ? "" : x.id)
              }}
              className={cn(
                "flex min-h-14 items-center justify-between gap-2 rounded-xl border bg-card px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                on && "border-primary bg-accent shadow-[inset_0_-3px_0_var(--primary)]",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-muted-foreground">{x.label}</span>
                <span className="num block text-lg font-semibold">{list.data ? f(n) : "…"}</span>
              </span>
              <x.icon className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
            </button>
          )
        })}
      </nav>
      <p className="mb-4 text-xs text-muted-foreground">Expédiées, livrées et retournées : statut du transporteur, pas un encaissement vérifié.</p>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center gap-2 border-b p-4 sm:px-6">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Client, téléphone, wilaya, n° ou suivi…" aria-label="Rechercher" maxLength={200} className="pl-9" />
          </div>
          <Button variant="outline" className="sm:hidden" onClick={() => setFiltersOpen(true)} aria-label={activeFilters ? `Filtres, ${activeFilters} actif${activeFilters > 1 ? "s" : ""}` : "Filtres"}>
            <SlidersHorizontal />
            Filtres
            {activeFilters > 0 && <span className="num grid size-5 place-items-center rounded-full bg-primary text-xs text-primary-foreground">{activeFilters}</span>}
          </Button>
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrer par statut" wrapperClassName="hidden w-48 sm:block">
            <NativeSelectOption value="all">Tous les statuts</NativeSelectOption>
            {STATUS_ORDER.map((k) => (
              <NativeSelectOption key={k} value={k}>
                {STATUS[k][0]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {s.manager && (
            <NativeSelect value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Filtrer par agent" wrapperClassName="hidden w-56 sm:block">
              <NativeSelectOption value="">Tous les agents</NativeSelectOption>
              {s.members.filter((m) => m.active).map((m) => (
                <NativeSelectOption key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          <Button variant="outline" className="hidden sm:inline-flex" onClick={() => setAscending((a) => !a)} aria-pressed={ascending}>
            <ArrowDownUp />
            {ascending ? "Anciennes d’abord" : "Récentes d’abord"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="hidden md:inline-flex">
                <Columns3 />
                Colonnes
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Colonnes affichées</DropdownMenuLabel>
              {ORDER_COLUMNS.map(([k, label]) => (
                <DropdownMenuCheckboxItem key={k} className="min-h-8 coarse:min-h-10" checked={columns.has(k)} onCheckedChange={(v) => toggleColumn(k, !!v)} onSelect={(e) => e.preventDefault()}>
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {status !== "all" && (
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm sm:px-6">
            <span>
              Statut : <b>{STATUS[status]?.[0] || status}</b>
            </span>
            <Button variant="ghost" size="sm" onClick={() => { setStatus("all"); navigate("orders", stage === "all" ? "" : stage) }}>
              <X />
              Retirer le filtre
            </Button>
          </div>
        )}
        <OrdersTable
          orders={orders}
          loading={list.isLoading}
          error={list.isError ? list.error : undefined}
          onRetry={() => list.refetch()}
          selected={selected}
          columns={columns}
          onToggle={(id, on) =>
            setSelected((prev) => {
              const n = new Set(prev)
              on ? n.add(id) : n.delete(id)
              return n
            })
          }
          onToggleAll={(on) => setSelected(on ? new Set(orders.map((x) => x.id)) : new Set())}
        />
        {orders.length > 0 && (
          <p className="num border-t px-4 py-2 text-xs text-muted-foreground sm:px-6">
            Cette page : {f(orders.length)} commande{orders.length > 1 ? "s" : ""} · {money(pageCod)} de COD demandé (non encaissé)
            {pageConfirmed > 0 ? " · " + f(pageConfirmed) + " en préparation ou expédiée" + (pageConfirmed > 1 ? "s" : "") : ""}
          </p>
        )}
        <Pager total={total} page={page} onPage={(p) => { setPage(Math.max(1, p)); setSelected(new Set()) }} />
      </Card>
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-xl">
          <SheetHeader className="border-b">
            <SheetTitle>Filtres</SheetTitle>
            <SheetDescription>{list.data ? f(total) + " résultat" + (total > 1 ? "s" : "") : "Chargement…"}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-5 p-4">
            {s.manager && (
              <FormField label="Agent" htmlFor="m-agent">
                <NativeSelect id="m-agent" value={agent} onChange={(e) => setAgent(e.target.value)}>
                  <NativeSelectOption value="">Tous les agents</NativeSelectOption>
                  {s.members.filter((m) => m.active).map((m) => (
                    <NativeSelectOption key={m.user_id} value={m.user_id}>
                      {m.display_name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
            )}
            <div role="radiogroup" aria-label="Ordre" className="grid gap-2">
              <span className="text-sm font-medium">Ordre</span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  [false, "Récentes d’abord"],
                  [true, "Anciennes d’abord"],
                ].map(([v, label]) => (
                  <Button key={String(v)} role="radio" aria-checked={ascending === v} variant={ascending === v ? "secondary" : "outline"} onClick={() => setAscending(v as boolean)}>
                    {label as string}
                  </Button>
                ))}
              </div>
            </div>
            <FormField label="Statut" htmlFor="m-status">
              <NativeSelect id="m-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <NativeSelectOption value="all">Tous les statuts</NativeSelectOption>
                {STATUS_ORDER.map((k) => (
                  <NativeSelectOption key={k} value={k}>
                    {STATUS[k][0]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
          </div>
          <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button
              variant="outline"
              disabled={!activeFilters}
              onClick={() => {
                setAgent("")
                setAscending(false)
                setStatus("all")
                if (status !== "all") navigate("orders", stage === "all" ? "" : stage)
              }}
            >
              Réinitialiser
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>Voir {list.data ? f(total) : ""} résultat{total > 1 ? "s" : ""}</Button>
          </div>
        </SheetContent>
      </Sheet>
      {/* Floating bar: selecting rows never shifts the table under the pointer. */}
      {selected.size > 0 && s.manager && (
        <div role="region" aria-label="Actions sur la sélection" className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4 lg:bottom-6 lg:pl-[272px]">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg">
            <span className="num font-medium" aria-live="polite">
              {selected.size > 1 ? selected.size + " commandes sélectionnées" : "1 commande sélectionnée"}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                ui.assign(
                  orders.filter((x) => selected.has(x.id)).map((x) => ({ id: x.id, version: x.version })),
                  null,
                )
              }
            >
              <Users />
              Affecter à un agent
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X />
              Désélectionner
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
