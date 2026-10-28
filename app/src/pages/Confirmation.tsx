import { useEffect, useState } from "react"
import { ArrowRight, CalendarClock, Clock, Phone, Plus, Search } from "lucide-react"
import { CHANNELS, initialsOf } from "@domain/domain.mjs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState, FormError, Loading, PageHeader, Pager } from "@/components/app/page"
import { ItemsSummary, NoteForm, OrderActions, OrderHistory, SourcePanels, useOrderUI } from "@/components/app/orders"
import { StatusBadge, ToneBadge } from "@/components/app/tone"
import { safeError } from "@/lib/api"
import { f, money, orderCode, time } from "@/lib/format"
import { useOrderDetail, useOrders, useOverview } from "@/lib/queries"
import { navigate } from "@/lib/router"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"
import { useDebounced } from "./Orders"

export function Confirmation({ tab }: { tab: string }) {
  const s = useSession()
  const ui = useOrderUI()
  const status = tab === "due" ? "due" : "pending"
  const [q, setQ] = useState("")
  const query = useDebounced(q)
  const [page, setPage] = useState(1)
  const [chosen, setChosen] = useState<string | null>(null)
  const o = useOverview().data || {}
  const list = useOrders({ status, q: query, page, agent: "", ascending: false })
  const orders = list.data?.items || []
  // Keep the order being handled even if it leaves the visible page during a live refresh.
  const activeId = chosen ?? orders[0]?.id ?? null
  const detail = useOrderDetail(activeId)
  const d = detail.data

  useEffect(() => {
    setPage(1)
    setChosen(null)
  }, [status, query, s.store])

  const stats = [
    { label: "À confirmer", n: o.pending, icon: Phone },
    { label: "Rappels planifiés", n: o.callbacks, icon: CalendarClock },
    { label: "Rappels à traiter", n: o.due, icon: Clock },
  ]

  return (
    <>
      <PageHeader
        title="Un appel. Une commande confirmée."
        description="Votre espace de confirmation, avec les bonnes informations au même endroit."
        actions={
          <Button size="lg" onClick={ui.newOrder}>
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
              <span className="num block text-2xl font-semibold">{f(x.n)}</span>
            </span>
            <span className="grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground">
              <x.icon className="size-[18px]" aria-hidden />
            </span>
          </Card>
        ))}
      </div>
      <Tabs value={status} onValueChange={(v) => navigate("confirmation", v === "due" ? "due" : "")} className="mb-4">
        <TabsList>
          <TabsTrigger value="pending" className="px-3">Toute la file</TabsTrigger>
          <TabsTrigger value="due" className="px-3">Rappels à traiter</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <Card className="gap-0 overflow-hidden py-0 lg:sticky lg:top-20">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="font-semibold">File d’attente</h2>
            <span className="num rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{f(list.data?.total)}</span>
          </div>
          <div className="relative border-b p-3">
            <Search className="pointer-events-none absolute top-6.5 left-6 size-4 text-muted-foreground" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un client…" aria-label="Rechercher dans la file" className="pl-9" />
          </div>
          {list.isError && <p className="p-4 text-sm text-danger">{safeError(list.error)}</p>}
          <ul className="max-h-[60dvh] overflow-y-auto lg:max-h-[calc(100dvh-22rem)]">
            {orders.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => {
                    setChosen(x.id)
                    // Phones: the call sheet sits under the queue, bring it into view.
                    if (window.matchMedia("(max-width: 1023px)").matches)
                      requestAnimationFrame(() => document.getElementById("call-sheet")?.scrollIntoView({ block: "start", behavior: "smooth" }))
                  }}
                  aria-current={x.id === activeId ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 border-b px-4 py-3 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent",
                    x.id === activeId && "bg-accent shadow-[inset_3px_0_0_var(--primary)]",
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
                    {x.callback_at && <span className="num block text-xs text-warning">{time(x.callback_at)}</span>}
                  </span>
                  <StatusBadge status={x.status} />
                </button>
              </li>
            ))}
          </ul>
          {!orders.length && !list.isLoading && <EmptyState title="File traitée" description="Aucune commande dans cette sélection." />}
          <Pager total={list.data?.total || 0} page={page} onPage={(p) => setPage(Math.max(1, p))} />
        </Card>

        <Card id="call-sheet" className="scroll-mt-20 gap-0 p-5 sm:p-6">
          {!activeId ? (
            <EmptyState title="File de confirmation vide" description="Ajoutez une commande ou adaptez votre recherche." />
          ) : detail.isError ? (
            <FormError message={safeError(detail.error)} />
          ) : !d ? (
            <Loading />
          ) : (
            <div className="grid gap-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{d.customer_name}</h2>
                  <p className="num text-sm text-muted-foreground">
                    #{orderCode(d)} · {d.phone}
                  </p>
                </div>
                <Button variant="outline" onClick={() => ui.openOrder(d.id)}>
                  Fiche complète
                  <ArrowRight />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" asChild>
                  <a href={"tel:" + d.phone}>
                    <Phone />
                    Appeler
                  </a>
                </Button>
                <ToneBadge tone="info">{CHANNELS[d.channel]}</ToneBadge>
                <span className="num text-sm text-muted-foreground">{f(d.attempts)} tentative(s) sans réponse</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-xs text-muted-foreground">Montant à confirmer</p>
                  <p className="num mt-1 text-2xl font-semibold">{money(d.total)}</p>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-xs text-muted-foreground">Adresse de livraison</p>
                  <p className="mt-1 font-semibold">
                    {d.wilaya} · {d.commune || "Commune à compléter"}
                  </p>
                  <p className="text-sm text-muted-foreground">{d.address || "Adresse à compléter"}</p>
                </div>
              </div>
              <ItemsSummary o={d} />
              <section>
                <h3 className="mb-2 text-sm font-semibold">Script de confirmation</h3>
                <p className="max-w-[70ch] leading-relaxed">
                  « Bonjour {d.customer_name.split(" ")[0]}, je vous appelle de {s.storeName} concernant votre commande. Je vous confirme les articles, votre adresse à {d.wilaya} et le
                  montant de <b className="num">{money(d.total)}</b>, à régler à la réception. Serez-vous disponible pour réceptionner le colis ? »
                </p>
              </section>
              <SourcePanels o={d} />
              <OrderActions o={d} />
              <NoteForm o={d} key={d.id} />
              <OrderHistory o={d} />
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
