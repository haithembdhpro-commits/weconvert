import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, ArrowUpRight, CalendarClock, CheckCircle2, ChevronRight, MapPin, Percent, Phone, Plus, ShoppingBag, Truck } from "lucide-react"
import { algerToday, reportRange, reportRate } from "@domain/report-domain.mjs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState, Notice } from "@/components/app/page"
import { OrdersTable, useOrderUI } from "@/components/app/orders"
import { DotBar, DotSpark, DotStack, type DotDay } from "@/components/app/dots"
import { rpc } from "@/lib/api"
import { f, money } from "@/lib/format"
import { useOrderBoard, useOverview } from "@/lib/queries"
import { navigate } from "@/lib/router"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"

type Perf = {
  summary: { orders: number; rate_base?: number; confirmed: number; cancelled: number; pending: number; confirmed_amount: number }
  days: DotDay[]
  wilayas: { wilaya: string; orders: number; confirmed: number; rate_base?: number }[]
}

/** n Algiers days ending `endOffset` days before today: [from, to] as YYYY-MM-DD. */
function periodWindow(n: number, endOffset = 0) {
  const today = algerToday()
  const to = new Date(today + "T00:00:00Z")
  to.setUTCDate(to.getUTCDate() - endOffset)
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - n + 1)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

function usePerf(n: number, endOffset: number) {
  const s = useSession()
  const w = periodWindow(n, endOffset)
  return useQuery({
    queryKey: ["store", s.store, "dash-perf", w.from, w.to],
    queryFn: () => rpc<Perf>("crm_performance", { p_store: s.store, p_from: w.from, p_to: w.to, p_agent: null, p_channel: null }),
    enabled: !!s.store,
  })
}

/** Change vs previous period, as text that never relies on colour alone. */
function Delta({ now, before, points = false }: { now: number | null; before: number | null; points?: boolean }) {
  if (now === null || before === null) return <span className="text-muted-foreground">—</span>
  if (!points && before === 0) return <span className="text-muted-foreground">{now > 0 ? "nouveau sur la période" : "stable"}</span>
  const d = points ? now - before : ((now - before) / before) * 100
  const up = d > 0.05
  const down = d < -0.05
  const txt = (d > 0 ? "+" : "") + d.toFixed(1).replace(".", ",") + (points ? " pt" : " %")
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("num font-semibold", up ? "text-success" : down ? "text-danger" : "text-muted-foreground")}>
        <span aria-hidden>{up ? "▲" : down ? "▼" : "■"}</span> {txt}
      </span>
      <span className="text-muted-foreground">vs période précédente</span>
    </span>
  )
}

function Kpi({
  title, icon: Icon, value, delta, href, children, tone = "text-chart-1",
}: { title: string; icon: typeof Phone; value: string; delta: React.ReactNode; href: string; children?: React.ReactNode; tone?: string }) {
  return (
    <Card className="group relative gap-0 p-5 transition-shadow hover:shadow-md">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-secondary text-secondary-foreground">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <h2 className="leading-tight font-medium">{title}</h2>
        <a href={href} aria-label={"Ouvrir : " + title} className="ml-auto grid size-8 coarse:size-11 place-items-center rounded-lg text-muted-foreground outline-none after:absolute after:inset-0 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowUpRight className="size-[18px]" aria-hidden />
        </a>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="num text-[1.75rem] leading-none font-semibold tracking-tight">{value}</p>
          <p className="mt-2 text-[0.8125rem]">{delta}</p>
        </div>
        <span className={cn("shrink-0", tone)}>{children}</span>
      </div>
    </Card>
  )
}

const PERIODS = [7, 14, 30]
const ACCENT_KEY = "wc-accent"

/** Temporary blue / orange comparison (owner request 28/10/2026). Applies to the whole app, remembered per browser. */
function AccentPreview() {
  const [accent, setAccent] = useState(() => (document.documentElement.dataset.accent === "orange" ? "orange" : "blue"))
  useEffect(() => {
    if (accent === "orange") document.documentElement.dataset.accent = "orange"
    else delete document.documentElement.dataset.accent
    try {
      localStorage.setItem(ACCENT_KEY, accent)
    } catch {}
  }, [accent])
  return (
    <div role="radiogroup" aria-label="Aperçu de la couleur d’accent" className="inline-flex rounded-lg border bg-card p-1">
      {[
        ["blue", "Bleu", "bg-[#0071a4]"],
        ["orange", "Orange", "bg-[#f97316]"],
      ].map(([id, label, dot]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={accent === id}
          onClick={() => setAccent(id)}
          className={cn(
            "inline-flex min-h-8 coarse:min-h-11 items-center gap-2 rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
            accent === id ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span className={cn("size-2.5 rounded-full", dot)} aria-hidden />
          {label}
        </button>
      ))}
    </div>
  )
}

function Ago({ at }: { at: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 10000)
    return () => clearInterval(t)
  }, [])
  if (!at) return <>Chargement…</>
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  return <>Actualisé il y a {s < 60 ? s + " s" : Math.round(s / 60) + " min"}</>
}

export function Dashboard() {
  const s = useSession()
  const ui = useOrderUI()
  const ov = useOverview()
  const m = ov.data || {}
  const [n, setN] = useState(7)
  const cur = usePerf(n, 0)
  const prev = usePerf(n, n)
  const latest = useOrderBoard({ stage: "all", status: "all", q: "", page: 1, agent: "", ascending: false, size: 5 })
  const range = reportRange("7")
  const delivered = useQuery({
    queryKey: ["store", s.store, "delivered7", range.from, range.to],
    queryFn: () => rpc<{ total: number }>("crm_delivered_period_page", { p_store: s.store, p_from: range.from, p_to: range.to, p_page: 1 }),
    enabled: !!s.store && s.manager,
  })
  const c = cur.data?.summary
  const p = prev.data?.summary
  const days = cur.data?.days || []
  const base = (x?: Perf["summary"]) => (x ? Number(x.rate_base ?? x.orders) || 0 : 0)
  const rate = (x?: Perf["summary"]) => (x && base(x) > 0 ? (100 * Number(x.confirmed)) / base(x) : null)
  const first = (s.members.find((x) => x.user_id === s.user?.id)?.display_name || "").split(" ")[0]
  const legacy = (Number(m.woo_confirmation_unverified) || 0) + (Number(m.woo_cancellation_unverified) || 0)
  const wilayas = cur.data?.wilayas || []
  const topW = Math.max(1, ...wilayas.map((w) => Number(w.orders) || 0))
  const period = n + " derniers jours"

  const tasks = [
    { icon: Phone, n: m.pending, label: "commandes à confirmer", desc: "Vérifier les coordonnées et la disponibilité", href: "#confirmation" },
    { icon: CalendarClock, n: m.due, label: "rappels arrivés à échéance", desc: "Planifier les rappels", href: "#confirmation/due" },
    ...(s.manager
      ? [{ icon: Truck, n: delivered.data?.total, label: "livrées (créées ces 7 j)", desc: "Statut ZR · reversement non vérifié", href: "#performance" }]
      : []),
  ]

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">{first ? `Bonjour, ${first}` : "Bonjour"}</h1>
          <p className="text-muted-foreground">
            <Ago at={Math.max(ov.dataUpdatedAt, cur.dataUpdatedAt)} /> · {s.storeName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AccentPreview />
          <div role="radiogroup" aria-label="Période" className="inline-flex rounded-lg border bg-card p-1">
            {PERIODS.map((x) => (
              <button
                key={x}
                type="button"
                role="radio"
                aria-checked={n === x}
                onClick={() => setN(x)}
                className={cn(
                  "num min-h-8 coarse:min-h-11 rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  n === x ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {x} j
              </button>
            ))}
          </div>
          <Button size="lg" onClick={ui.newOrder}>
            Nouvelle commande
            <Plus />
          </Button>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi title="Commandes reçues" icon={ShoppingBag} href="#orders" value={c ? f(c.orders) : "…"} delta={<Delta now={c ? c.orders : null} before={p ? p.orders : null} />}>
          <DotSpark values={days.map((d) => Number(d.orders) || 0)} label={`Commandes reçues par jour, ${period} : ${days.map((d) => d.orders).join(", ")}`} />
        </Kpi>
        <Kpi title="Confirmées" icon={CheckCircle2} href="#orders/confirmed" tone="text-success" value={c ? f(c.confirmed) : "…"} delta={<Delta now={c ? c.confirmed : null} before={p ? p.confirmed : null} />}>
          <DotSpark values={days.map((d) => Number(d.confirmed) || 0)} label={`Confirmations vérifiées par jour, ${period} : ${days.map((d) => d.confirmed).join(", ")}`} />
        </Kpi>
        <Kpi
          title="Taux de confirmation"
          icon={Percent}
          href="#performance"
          value={c ? reportRate(c.confirmed, base(c)) : "…"}
          delta={<Delta now={rate(c)} before={rate(p)} points />}
        >
          <span className="block w-24">
            <DotBar ratio={(rate(c) || 0) / 100} total={10} label={"Taux de confirmation : " + (c ? reportRate(c.confirmed, base(c)) : "—")} className="h-3" />
          </span>
        </Kpi>
        <Kpi
          title="À confirmer"
          icon={Phone}
          href="#confirmation"
          tone="text-warning"
          value={f(m.pending)}
          delta={
            <span className="text-muted-foreground">
              dont <b className="num text-foreground">{f(m.due)}</b> rappel{Number(m.due) > 1 ? "s" : ""} échu{Number(m.due) > 1 ? "s" : ""} · maintenant
            </span>
          }
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {period} comparés aux {n} jours précédents · heure d’Alger · taux = confirmées vérifiées ÷ reçues hors historique WooCommerce.
      </p>

      {legacy > 0 && (
        <Notice tone="warning" className="mt-4">
          {f(legacy)} statuts historiques (confirmations ou annulations) ont été déduits de WooCommerce sans décision COD vérifiée. Ces commandes restent visibles ; leurs statuts sont exclus
          des taux et montants du rapport jusqu’au rapprochement avec la source de confirmation d’origine.
        </Notice>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card className="gap-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Activité des commandes</h2>
              <p className="text-sm text-muted-foreground">Par jour de création · {period}</p>
            </div>
            {c && (
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                Montant COD confirmé : <b className="num">{money(c.confirmed_amount)}</b>
              </span>
            )}
          </div>
          <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="num text-[2rem] leading-none font-semibold tracking-tight">{c ? f(c.orders) : "…"}</span>
            <span className="text-sm">
              <Delta now={c ? c.orders : null} before={p ? p.orders : null} />
            </span>
          </p>
          <div className="mt-6">
            {cur.isError ? (
              <p className="text-sm text-danger">Rapport indisponible pour le moment.</p>
            ) : days.length ? (
              <DotStack days={days} />
            ) : (
              <EmptyState title="Pas encore de données" description="Les commandes reçues apparaîtront ici par jour." />
            )}
          </div>
        </Card>

        <Card className="gap-0 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Wilayas</h2>
              <p className="text-sm text-muted-foreground">Top 10 des commandes · {period}</p>
            </div>
            <a href="#performance" aria-label="Ouvrir le rapport par wilaya" className="grid size-8 coarse:size-11 place-items-center rounded-lg border text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <ArrowUpRight className="size-[18px]" aria-hidden />
            </a>
          </div>
          {wilayas.length ? (
            <ol className="mt-4 grid gap-3">
              {wilayas.map((w) => (
                <li key={w.wilaya} className="grid gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5 font-medium">
                      <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">{w.wilaya}</span>
                    </span>
                    <span className="num shrink-0 text-muted-foreground">
                      <b className="text-foreground">{f(w.orders)}</b> · {reportRate(w.confirmed, w.rate_base ?? w.orders)} conf.
                    </span>
                  </div>
                  <span className="text-chart-1">
                    <DotBar ratio={Number(w.orders) / topW} total={24} label={`${w.wilaya} : ${w.orders} commandes`} />
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="Aucune wilaya" description="Pas de commande sur cette période." />
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex flex-wrap items-center justify-between gap-2 p-5 sm:px-6">
            <div>
              <h2 className="text-base font-semibold">Dernières commandes</h2>
              <p className="text-sm text-muted-foreground">Changez le statut directement depuis le badge</p>
            </div>
            <Button variant="outline" onClick={() => navigate("orders")}>
              Tout voir
              <ArrowRight />
            </Button>
          </div>
          <OrdersTable orders={latest.data?.items || []} compact />
        </Card>
        <Card className="gap-0 p-5 sm:p-6">
          <h2 className="text-base font-semibold">Votre journée</h2>
          <p className="text-sm text-muted-foreground">Les actions qui comptent maintenant</p>
          <ul className="mt-4 grid gap-1">
            {tasks.map((t) => (
              <li key={t.href + t.label}>
                <a href={t.href} className="flex min-h-12 items-center gap-3 rounded-lg px-2 py-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                    <t.icon className="size-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      <span className="num">{t.n === undefined ? "—" : f(t.n)}</span> {t.label}
                    </span>
                    <span className="block text-sm text-muted-foreground">{t.desc}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
