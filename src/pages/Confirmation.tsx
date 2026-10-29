import { useEffect, useMemo, useState } from "react"
import { ArrowRight, CalendarClock, ChevronRight, Clock, Phone, Plus, RotateCcw, Search } from "lucide-react"
import { CHANNELS, PENDING, initialsOf } from "@domain/domain.mjs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState, FormError, Loading, Notice, PageHeader, Pager } from "@/components/app/page"
import { ContactActions, ItemsSummary, NoteForm, OrderActions, OrderHistory, SourcePanels, StatusMenu, useOrderUI } from "@/components/app/orders"
import { StatusBadge, ToneBadge } from "@/components/app/tone"
import { safeError } from "@/lib/api"
import { f, money, orderCode, plural, time } from "@/lib/format"
import { useOrderDetail, useOrders, useOverview } from "@/lib/queries"
import { navigate } from "@/lib/router"
import { useSession } from "@/lib/session"
import type { Order } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useDebounced } from "./Orders"

/**
 * Agent call station. Rules (UX audit 28/10/2026):
 * - the sheet on screen never changes by itself: a live refresh may add orders to the queue, never swap the customer;
 * - the queue is first in, first served (oldest first); due callbacks are ordered by callback time;
 * - after an accepted action the station moves to the next order and says so.
 */
export function Confirmation({ tab }: { tab: string }) {
  const s = useSession()
  const ui = useOrderUI()
  const status = tab === "due" ? "due" : "pending"
  const [q, setQ] = useState("")
  const query = useDebounced(q)
  const [page, setPage] = useState(1)
  const [chosen, setChosen] = useState<string | null>(null)
  const ov = useOverview()
  const o = ov.data
  const list = useOrders({ status, q: query, page, agent: "", ascending: true })
  const orders = useMemo(() => {
    const items = list.data?.items || []
    return status === "due" ? [...items].sort((a, b) => Date.parse(a.callback_at || "") - Date.parse(b.callback_at || "")) : items
  }, [list.data, status])
  const detail = useOrderDetail(chosen)
  const d = detail.data

  useEffect(() => {
    setPage(1)
    setChosen(null)
  }, [status, query, s.store])
  // Pin the first order once; afterwards only the agent (or "next") changes the sheet.
  useEffect(() => {
    if (!chosen && orders[0]) setChosen(orders[0].id)
  }, [chosen, orders])

  const waiting = (x: Order) => x.id !== chosen && !ui.queued.has(x.id) && PENDING.includes(x.status)
  const nextOrder = () => {
    const i = orders.findIndex((x) => x.id === chosen)
    return [...orders.slice(i + 1), ...orders.slice(0, Math.max(0, i))].find(waiting) || null
  }

  function open(id: string) {
    setChosen(id)
    // Phones: the call sheet sits under the queue, bring it into view.
    if (window.matchMedia("(max-width: 1023px)").matches)
      requestAnimationFrame(() => document.getElementById("call-sheet")?.scrollIntoView({ block: "start", behavior: "smooth" }))
  }
  function goNext() {
    const n = nextOrder()
    if (n) open(n.id)
    else setChosen(null)
  }

  const stats = [
    { label: "À confirmer", n: o?.pending, icon: Phone },
    { label: "Rappels prévus", n: o?.callbacks, icon: CalendarClock },
    { label: "Rappels à faire maintenant", n: o?.due, icon: Clock },
  ]
  const next = d ? nextOrder() : null
  const handled = d && !PENDING.includes(d.status) && !ui.queued.has(d.id)

  return (
    <>
      <PageHeader
        title="Confirmation"
        description="Appelez, confirmez, passez à la suivante : la file est servie dans l’ordre d’arrivée."
        actions={
          <Button onClick={ui.newOrder}>
            <Plus />
            Nouvelle commande
          </Button>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {stats.map((x) => (
          <Card key={x.label} className="flex-row items-center justify-between gap-3 px-5 py-4">
            <span>
              <span className="block text-sm text-muted-foreground">{x.label}</span>
              <span className="num block text-2xl font-semibold">{x.n === undefined ? (ov.isError ? "—" : "…") : f(x.n)}</span>
            </span>
            <span className="grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground">
              <x.icon className="size-[18px]" aria-hidden />
            </span>
          </Card>
        ))}
      </div>
      <Tabs value={status} onValueChange={(v) => navigate("confirmation", v === "due" ? "due" : "")} className="mb-4">
        <TabsList>
          <TabsTrigger value="pending" className="px-3">
            Toute la file
          </TabsTrigger>
          <TabsTrigger value="due" className="px-3">
            Rappels à faire maintenant
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <Card className="gap-0 overflow-hidden py-0 lg:sticky lg:top-20">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <h2 className="font-semibold">File d’attente</h2>
              <p className="text-xs text-muted-foreground">{status === "due" ? "Par heure de rappel" : "Plus anciennes d’abord"}</p>
            </div>
            <span className="num rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{list.data ? f(list.data.total) : "…"}</span>
          </div>
          <div className="relative border-b p-3">
            <Search className="pointer-events-none absolute top-1/2 left-6 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un client…" aria-label="Rechercher dans la file" className="pl-9" />
          </div>
          {list.isError && !orders.length ? (
            <div className="grid justify-items-start gap-3 p-4">
              <Notice tone="danger" role="alert">
                File indisponible : {safeError(list.error)}
              </Notice>
              <Button variant="outline" onClick={() => list.refetch()}>
                <RotateCcw />
                Réessayer
              </Button>
            </div>
          ) : list.isLoading ? (
            <Loading text="Chargement de la file…" />
          ) : !orders.length ? (
            <EmptyState title={query ? "Aucun résultat" : "File traitée"} description={query ? "Aucune commande de la file ne correspond à cette recherche." : status === "due" ? "Aucun rappel n’est arrivé à échéance." : "Toutes les commandes ont été traitées."} />
          ) : (
            <ul className="max-h-[60dvh] overflow-y-auto lg:max-h-[calc(100dvh-24rem)]">
              {orders.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => open(x.id)}
                    aria-current={x.id === chosen ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 border-b px-4 py-3 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      x.id === chosen && "bg-accent shadow-[inset_3px_0_0_var(--primary)]",
                    )}
                  >
                    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                      {initialsOf(x.customer_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{x.customer_name}</span>
                      <span className="num block truncate text-xs text-muted-foreground">
                        #{orderCode(x)} · {x.wilaya}
                      </span>
                      {x.callback_at && (
                        <span className={cn("num block text-xs", Date.parse(x.callback_at) <= Date.now() ? "font-medium text-danger" : "text-warning")}>
                          Rappel · {time(x.callback_at)}
                        </span>
                      )}
                    </span>
                    {ui.queued.has(x.id) ? <ToneBadge tone="success">Envoi…</ToneBadge> : <StatusBadge status={x.status} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Pager total={list.data?.total || 0} page={page} onPage={(p) => setPage(Math.max(1, p))} className="sm:px-4" />
        </Card>

        <Card id="call-sheet" className="scroll-mt-20 gap-0 p-5 sm:p-6">
          {!chosen ? (
            <EmptyState
              title="Aucune commande à appeler"
              description="Choisissez une commande dans la file, ou créez-en une reçue par téléphone ou messagerie."
            />
          ) : detail.isError ? (
            <FormError message={safeError(detail.error)} />
          ) : !d ? (
            <Loading />
          ) : (
            <div className="grid gap-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold">{d.customer_name}</h2>
                  <p className="num text-sm text-muted-foreground">
                    #{orderCode(d)} · {d.phone} · {CHANNELS[d.channel]}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusMenu o={d} />
                  <Button variant="outline" size="sm" onClick={goNext} disabled={!next} title={next ? "Suivante : " + next.customer_name : "Aucune autre commande en attente"}>
                    Suivante
                    <ChevronRight />
                  </Button>
                </div>
              </div>

              {handled && (
                <Notice tone="success" role="status">
                  Commande traitée ({d.status === "confirmed" ? "confirmée" : "statut mis à jour"}).{" "}
                  {next ? (
                    <Button variant="link" className="h-auto p-0 align-baseline" onClick={goNext}>
                      Passer à {next.customer_name}
                    </Button>
                  ) : (
                    "La file est vide."
                  )}
                </Notice>
              )}

              <ContactActions phone={d.phone} full />
              <OrderActions o={d} onDone={goNext} className="rounded-lg border bg-muted/40 p-3" />
              <p className="num -mt-2 text-sm text-muted-foreground">
                {d.attempts ? f(d.attempts) + " " + plural(d.attempts, "appel", "appels") + " sans réponse" : "Aucun appel sans réponse pour l’instant"}
                {d.callback_at ? " · rappel prévu le " + time(d.callback_at) : ""}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-xs text-muted-foreground">Montant à confirmer</p>
                  <p className="num mt-1 text-2xl font-semibold">{money(d.total)}</p>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-xs text-muted-foreground">Adresse de livraison</p>
                  <p className="mt-1 font-semibold">
                    {d.wilaya} · {d.commune || <span className="text-warning">Commune à compléter</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">{d.address || <span className="text-warning">Adresse à compléter</span>}</p>
                </div>
              </div>
              <ItemsSummary o={d} />
              <details className="group rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-semibold">Script de confirmation</summary>
                <p className="mt-2 max-w-[70ch] leading-relaxed">
                  « Bonjour {d.customer_name.split(" ")[0]}, je vous appelle de {s.storeName} concernant votre commande. Je vous confirme les articles, votre adresse à {d.wilaya} et le
                  montant de <b className="num">{money(d.total)}</b>, à régler à la réception. Serez-vous disponible pour réceptionner le colis ? »
                </p>
              </details>
              <NoteForm o={d} key={d.id} />
              <SourcePanels o={d} />
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => ui.openOrder(d.id)}>
                  Ouvrir la fiche complète
                  <ArrowRight />
                </Button>
              </div>
              <OrderHistory o={d} />
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
