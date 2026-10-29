import { useEffect, useRef, useState } from "react"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { BadgeCheck, ChevronRight, Coins, Download, Filter, PackageCheck, Plus, ShoppingBag, Trash2 } from "lucide-react"
import { CHANNELS, csvCell, requestId } from "@domain/domain.mjs"
import { algerToday, deliveryRate, periodDelta, previousRange, reportBuckets, reportRange, reportRate } from "@domain/report-domain.mjs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState, FormError, FormField, Loading, Notice, PageHeader, Pager } from "@/components/app/page"
import { FormDialog } from "@/components/app/FormDialog"
import { type Tone } from "@/components/app/tone"
import { useOrderUI } from "@/components/app/orders"
import { useSubmit } from "@/components/app/useSubmit"
import { rpc, safeError, select } from "@/lib/api"
import { f, money } from "@/lib/format"
import { navigate } from "@/lib/router"
import { useSession } from "@/lib/session"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { ZrBadge } from "./Shipping"
import { Agents, Alerts, BasketAndHours, DataTable, Journey, Kpi, LostReasons, Section, Wilayas, type Insights } from "./report-parts"

type Row = Record<string, any>
type Report = { period: { from: string; to: string }; summary: Row; days: Row[]; channels: Row[]; wilayas: Row[]; products: Row[]; agents: Row[] }
type Filters = { preset: string; from: string; to: string; channel: string; agent: string }

const shortDate = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("fr-DZ", { day: "numeric", month: "short" })
const PRESETS: [string, string][] = [["7", "7 jours"], ["30", "30 jours"], ["90", "90 jours"], ["365", "12 mois"]]

function range(fl: Filters) {
  return fl.preset === "custom" ? { from: fl.from, to: fl.to } : reportRange(fl.preset)
}

function validate(from: string, to: string) {
  const today = algerToday()
  const a = Date.parse(from + "T00:00:00Z"), b = Date.parse(to + "T00:00:00Z")
  const ok =
    /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && Number.isFinite(a) && Number.isFinite(b) &&
    new Date(a).toISOString().slice(0, 10) === from && new Date(b).toISOString().slice(0, 10) === to &&
    from >= "2000-01-01" && to <= today && from <= to && (b - a) / 86400000 <= 365
  if (!ok) throw Error("INVALID_FILTER")
}

function Chart({ days }: { days: Row[] }) {
  const buckets = reportBuckets(days as any)
  const scroller = useRef<HTMLDivElement>(null)
  const lastKey = buckets.length ? buckets[buckets.length - 1].key : ""
  // Open on the most recent days (once per period): the newest data must be visible without scrolling.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth
  }, [buckets.length, lastKey])
  const max = Math.max(1, ...buckets.map((b) => b.orders))
  if (!buckets.some((b) => b.orders)) return <EmptyState title="Aucune commande sur cette période" description="Essayez une autre plage de dates ou un autre canal." />
  const step = buckets.length > 20 ? 5 : buckets.length > 12 ? 2 : 1
  const label = (b: (typeof buckets)[number]) => (b.from === b.to ? shortDate(b.from) : shortDate(b.from) + " – " + shortDate(b.to))
  return (
    <>
      <div
        ref={scroller}
        role="region"
        aria-label="Évolution des commandes ; défilement horizontal si nécessaire"
        tabIndex={0}
        className="overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex h-56 min-w-full items-stretch gap-1 border-b" style={{ width: Math.max(buckets.length * 20, 0) }}>
          {buckets.map((b, i) => (
            <div key={b.key} role="img" tabIndex={0} title={`${label(b)} : ${f(b.orders)} reçues, ${f(b.confirmed)} confirmées, ${f(b.cancelled)} annulées`} aria-label={`${label(b)} : ${f(b.orders)} reçues, ${f(b.confirmed)} confirmées, ${f(b.cancelled)} annulées`} className="relative flex flex-1 flex-col justify-end pb-6 outline-none focus-visible:bg-accent">
              <div className="flex h-full items-end justify-center gap-0.5" aria-hidden>
                <i className="w-1/2 max-w-4 rounded-t-sm bg-chart-2" style={{ height: `${b.orders ? Math.max(2, (100 * b.orders) / max) : 0}%` }} />
                <i className="w-1/2 max-w-4 rounded-t-sm bg-chart-1" style={{ height: `${b.confirmed ? Math.max(2, (100 * b.confirmed) / max) : 0}%` }} />
              </div>
              <small className={cn("num absolute bottom-0 text-xs whitespace-nowrap text-muted-foreground", i === 0 ? "left-0" : i === buckets.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2")}>{i % step === 0 || i === buckets.length - 1 ? shortDate(b.from) : ""}</small>
            </div>
          ))}
        </div>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer py-2 text-primary">Voir les valeurs détaillées du graphique</summary>
        <DataTable head={["Période", "Reçues", "Confirmées", "Annulées"]} right={[1, 2, 3]} rows={buckets.map((b) => [label(b), f(b.orders), f(b.confirmed), f(b.cancelled)])} empty="" />
      </details>
    </>
  )
}

const BAR: Record<Tone, string> = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-neutral", info: "bg-info", violet: "bg-violet" }

function StatusBars({ s }: { s: Row }) {
  const items: [string, number, Tone][] = [["Confirmées", s.confirmed, "success"], ["À traiter", s.pending, "warning"], ["Annulées", s.cancelled, "danger"], ["Doublons", s.duplicate, "neutral"], ["Faux numéros", s.fake, "neutral"]]
  return (
    <ul className="grid gap-4">
      {items.map(([label, n, tone]) => (
        <li key={label}>
          <div className="flex justify-between text-sm"><b className="font-medium">{label}</b><span className="num text-muted-foreground">{f(n)} · {reportRate(n, s.rate_base ?? s.orders)}</span></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <i className={cn("block h-full rounded-full", BAR[tone])} style={{ width: `${(s.rate_base ?? s.orders) ? Math.min(100, (100 * (Number(n) || 0)) / Number(s.rate_base ?? s.orders)) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

// Report parts: one screen each, so a question has one place to look. Deep link: #performance/<part>.
const TABS: [string, string, boolean][] = [
  ["overview", "Vue d’ensemble", false],
  ["losses", "Pertes", false],
  ["wilayas", "Wilayas", false],
  ["team", "Équipe & horaires", false],
  ["products", "Produits & canaux", false],
  ["money", "Marge & dépenses", true],
]

/** « ▲ +12 % vs 7 j avant » — direction in words and arrow, never colour alone. */
function Trend({ d }: { d: { value: number; text: string } | null }) {
  if (!d) return <span className="block text-muted-foreground">Pas de comparaison possible</span>
  const up = d.value > 0.05, down = d.value < -0.05
  return (
    <span className={cn("block font-medium", up ? "text-success" : down ? "text-danger" : "text-muted-foreground")}>
      <span aria-hidden>{up ? "▲" : down ? "▼" : "■"}</span> {d.text} <span className="font-normal text-muted-foreground">vs période d’avant</span>
    </span>
  )
}

export function Performance({ tab: rawTab = "" }: { tab?: string }) {
  const s = useSession()
  const qc = useQueryClient()
  const ui = useOrderUI()
  const [fl, setFl] = useState<Filters>({ preset: "30", from: "", to: "", channel: "", agent: "" })
  const [filterError, setFilterError] = useState("")
  const [customOpen, setCustomOpen] = useState(false)
  const [deliveredPage, setDeliveredPage] = useState(1)
  const [delExpense, setDelExpense] = useState<Row | null>(null)
  const expenseSub = useSubmit()
  const delSub = useSubmit()
  const [expenseKey, setExpenseKey] = useState(() => requestId())
  const p = range(fl)
  const prev = previousRange(p.from, p.to)
  const agent = s.manager ? fl.agent || null : null
  const channel = fl.channel || null
  const base = ["store", s.store, "perf", p.from, p.to, channel, agent] as const

  const report = useQuery({
    queryKey: [...base, "report"],
    enabled: !!s.store,
    placeholderData: keepPreviousData,
    queryFn: () => rpc<Report>("crm_performance", { p_store: s.store, p_from: p.from, p_to: p.to, p_agent: agent, p_channel: channel }),
  })
  const tab = TABS.some(([id, , manager]) => id === rawTab && (!manager || s.manager)) ? rawTab : "overview"
  const prevInsights = useQuery({
    queryKey: [...base, "insights-prev"],
    enabled: !!s.store && prev.from >= "2000-01-01",
    placeholderData: keepPreviousData,
    queryFn: () => rpc<Insights>("crm_report_insights", { p_store: s.store, p_from: prev.from, p_to: prev.to, p_agent: agent, p_channel: channel }),
  })
  const insights = useQuery({
    queryKey: [...base, "insights"],
    enabled: !!s.store,
    placeholderData: keepPreviousData,
    queryFn: () => rpc<Insights>("crm_report_insights", { p_store: s.store, p_from: p.from, p_to: p.to, p_agent: agent, p_channel: channel }),
  })
  const delivery = useQuery({
    queryKey: [...base, "delivery"],
    enabled: !!s.store && s.manager,
    placeholderData: keepPreviousData,
    queryFn: () => rpc<{ summary: Row; channels: Row[] }>("crm_delivery_performance", { p_store: s.store, p_from: p.from, p_to: p.to, p_channel: channel }),
  })
  const delivered = useQuery({
    queryKey: [...base, "delivered", deliveredPage],
    enabled: !!s.store && s.manager,
    placeholderData: keepPreviousData,
    queryFn: () => rpc<{ orders: Row[]; total: number }>("crm_delivered_period_page", { p_store: s.store, p_from: p.from, p_to: p.to, p_agent: agent, p_channel: channel, p_page: deliveredPage }),
  })
  const expenses = useQuery({
    queryKey: ["store", s.store, "perf", p.from, p.to, "expenses"],
    enabled: !!s.store && s.manager,
    queryFn: async () =>
      (await select<Row[]>(supabase.from("crm_cost_entries").select("id,spent_on,kind,amount,note").eq("store_id", s.store!).gte("spent_on", p.from).lte("spent_on", p.to).order("spent_on", { ascending: false }).limit(100))).data,
  })

  const r = report.data
  const sm = r?.summary || {}
  const x = insights.data
  const fu = x?.funnel
  const pf = prevInsights.data?.funnel
  const today = algerToday()

  function setPreset(id: string) {
    setFilterError("")
    setDeliveredPage(1)
    setFl((x) => ({ ...x, preset: id }))
  }

  function exportCsv() {
    if (!r) return
    const x = r.summary
    const ins = insights.data
    const sections: unknown[][] = [
      ["WeConvert · Performance & rapports"], ["Boutique", s.storeName], ["Du", r.period.from], ["Au", r.period.to], ["Fuseau horaire", "Africa/Algiers"],
      ["Filtre canal", fl.channel ? CHANNELS[fl.channel] : "Tous"], ["Filtre agent", fl.agent ? s.memberName(fl.agent) : s.manager ? "Tous" : "Mes commandes"], [],
      ["Indicateurs", "Valeur"], ["Commandes reçues", x.orders], ["Confirmées", x.confirmed], ["À traiter", x.pending], ["Annulées", x.cancelled], ["Doublons", x.duplicate], ["Faux numéros", x.fake],
      ["Taux de confirmation", reportRate(x.confirmed, x.rate_base ?? x.orders)], ["Montant COD confirmé (DA)", x.confirmed_amount],
      ["WooCommerce dans le rapport opérationnel", x.woo_orders], ["WooCommerce avec Purchase CAPI marqué envoyé", x.woo_purchase_marked], ["WooCommerce sans preuve de suivi", x.woo_unverified],
      ["Confirmations Woo historiques non vérifiées", x.woo_confirmation_unverified], ["Annulations Woo historiques non vérifiées", x.woo_cancellation_unverified],
      ...(s.manager ? [["Commandes créées dans la période et actuellement livrées (ZR)", delivered.data?.total ?? 0]] : []), [],
      ["Évolution", "Reçues", "Confirmées", "Annulées"], ...(r.days || []).map((d) => [d.date, d.orders, d.confirmed, d.cancelled]), [],
      ["Canal", "Reçues", "Confirmées", "Annulées", "Montant COD confirmé (DA)"], ...(r.channels || []).map((d) => [CHANNELS[d.channel] || d.channel, d.orders, d.confirmed, d.cancelled, d.confirmed_amount]), [],
      ...(ins
        ? [
            ["Parcours des commandes"],
            ["Reçues", "Confirmées", "Expédiées", "Livrées", "Retournées", "En route", "Perdues avant expédition", "À traiter", "COD livré (DA)"],
            [ins.funnel.received, ins.funnel.confirmed, ins.funnel.shipped, ins.funnel.delivered, ins.funnel.returned, ins.funnel.in_progress, ins.funnel.lost, ins.funnel.pending, ins.funnel.delivered_cod], [],
            ["Wilaya", "Commandes", "Confirmées", "Taux de confirmation", "Expédiées", "Livrées", "Retournées", "Taux de livraison", "Délai moyen (jours)", "COD livré (DA)"],
            ...(ins.wilayas || []).map((w) => [w.wilaya, w.orders, w.confirmed, reportRate(w.confirmed, w.rate_base), w.shipped, w.delivered, w.returned, deliveryRate(w.delivered, w.returned), w.avg_days ?? "", w.delivered_cod]), [],
            ["Motif de perte", "Décision", "Commandes"], ...(ins.reasons || []).map((m) => [m.reason || "Sans motif", m.status, m.orders]), [],
            ["Agent", "Commandes", "Confirmées", "Livrées", "Retournées", "Premier appel (minutes, médiane)", "Appels sans réponse par commande"],
            ...(ins.agents || []).map((g) => [g.name, g.orders, g.confirmed, g.delivered, g.returned, g.median_first_minutes ?? "", g.avg_no_answer ?? ""]), [],
            ["Panier moyen (DA)", "Articles par commande", "Commandes à plusieurs articles", "Délai de livraison médian (jours)"],
            [ins.basket.avg_total ?? "", ins.basket.avg_units ?? "", ins.basket.multi_unit ?? 0, ins.delivery_days ?? ""], [],
          ]
        : [["Wilaya", "Reçues", "Confirmées", "Montant COD confirmé (DA)"], ...(r.wilayas || []).map((d) => [d.wilaya, d.orders, d.confirmed, d.confirmed_amount]), []]),
      ["Produit", "SKU", "Unités", "Unités confirmées", "Montant des lignes confirmées (DA)"], ...(r.products || []).map((d) => [d.name, d.sku, d.units, d.confirmed_units, d.confirmed_lines_amount]), [],
      ["Agent actuel", "Reçues", "Confirmées", "Annulées", "Montant COD confirmé (DA)"], ...(r.agents || []).map((d) => [d.name, d.orders, d.confirmed, d.cancelled, d.confirmed_amount]),
    ]
    const csv = "﻿" + sections.map((row) => (row as unknown[]).map(csvCell).join(";")).join("\r\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `WeConvert-performance-${r.period.from}-${r.period.to}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success("Rapport CSV exporté pour la période sélectionnée.")
  }

  // The delivered-orders list lives in « Marge & dépenses »: open that part, then bring the list into view.
  const scrollToDelivered = () => {
    navigate("performance", "money")
    setTimeout(() => {
      const el = document.getElementById("delivered-period-title")
      el?.scrollIntoView({ block: "start", behavior: "smooth" })
      el?.focus({ preventScroll: true })
    }, 60)
  }

  const legacy = (Number(sm.woo_confirmation_unverified) || 0) + (Number(sm.woo_cancellation_unverified) || 0)
  const d = delivery.data?.summary || {}
  const missing = Number(d.missing_product_cost || 0) + Number(d.missing_shipping_cost || 0)

  return (
    <>
      <PageHeader
        title="Performance & rapports."
        description="Ce que deviennent vos commandes, de la réception à la livraison."
        actions={r && <Button variant="outline" onClick={exportCsv}><Download />Exporter en CSV</Button>}
      />
      <div className="-mx-4 mb-5 grid gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:sticky lg:top-14 lg:z-10 lg:-mx-8 lg:px-8">
        <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
          <div role="group" aria-label="Période" className="col-span-2 flex overflow-x-auto rounded-lg border bg-card p-1 sm:inline-flex">
            {[...PRESETS, ["custom", "Dates…"] as [string, string]].map(([id, l]) => (
              <button
                key={id}
                type="button"
                aria-pressed={id === "custom" ? fl.preset === "custom" || customOpen : fl.preset === id && !customOpen}
                onClick={() => (id === "custom" ? setCustomOpen((o) => !o) : (setCustomOpen(false), setPreset(id)))}
                className={cn(
                  "num min-h-8 shrink-0 whitespace-nowrap rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11",
                  (id === "custom" ? fl.preset === "custom" || customOpen : fl.preset === id && !customOpen) ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <NativeSelect value={fl.channel} onChange={(e) => { setDeliveredPage(1); setFl((v) => ({ ...v, channel: e.target.value })) }} aria-label="Canal" wrapperClassName="w-full sm:w-44">
            <NativeSelectOption value="">Tous les canaux</NativeSelectOption>
            {Object.entries(CHANNELS).map(([k, v]) => <NativeSelectOption key={k} value={k}>{v}</NativeSelectOption>)}
          </NativeSelect>
          {s.manager && (
            <NativeSelect value={fl.agent} onChange={(e) => { setDeliveredPage(1); setFl((v) => ({ ...v, agent: e.target.value })) }} aria-label="Agent" wrapperClassName="w-full sm:w-48">
              <NativeSelectOption value="">Tous les agents</NativeSelectOption>
              {s.members.map((m) => <NativeSelectOption key={m.user_id} value={m.user_id}>{m.display_name + (m.active ? "" : " · inactif")}</NativeSelectOption>)}
            </NativeSelect>
          )}
          <span className="num col-span-2 text-xs text-muted-foreground sm:ml-auto sm:text-sm">
            Du {shortDate(p.from)} au {shortDate(p.to)} · comparé aux {f(prev.days)} jours d’avant
          </span>
        </div>
        {customOpen && (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
              try {
                validate(v.from, v.to)
                setFilterError("")
                setDeliveredPage(1)
                setCustomOpen(false)
                setFl((x) => ({ ...x, preset: "custom", from: v.from, to: v.to }))
              } catch (err) {
                setFilterError(safeError(err))
              }
            }}
          >
            <FormField label="Du" htmlFor="pf-from" required><Input id="pf-from" name="from" type="date" defaultValue={p.from} min="2000-01-01" max={today} required /></FormField>
            <FormField label="Au (inclus)" htmlFor="pf-to" required><Input id="pf-to" name="to" type="date" defaultValue={p.to} min="2000-01-01" max={today} required /></FormField>
            <Button type="submit"><Filter />Afficher</Button>
            <span className="text-xs text-muted-foreground">366 jours maximum.</span>
            <FormError message={filterError} />
          </form>
        )}
      </div>

      {report.isError ? (
        <Notice tone="danger" role="alert" className="mt-5">{safeError(report.error)}</Notice>
      ) : !r ? (
        <Loading text="Calcul du rapport…" />
      ) : (
        <>
          <Tabs value={tab} onValueChange={(v) => navigate("performance", v === "overview" ? "" : v)}>
            <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              <TabsList aria-label="Parties du rapport">
                {TABS.filter(([, , manager]) => !manager || s.manager).map(([id, l]) => (
                  <TabsTrigger key={id} value={id} className="px-3">{l}</TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value="overview" className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-5">
              <Card className="grid gap-px overflow-hidden bg-border py-0 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Commandes reçues" value={fu ? f(fu.received) : f(sm.orders)} foot={<Trend d={periodDelta("count", fu?.received, pf?.received)} />} icon={ShoppingBag} />
                <Kpi
                  label="Taux de confirmation"
                  value={fu ? reportRate(fu.confirmed, fu.rate_base) : reportRate(sm.confirmed, sm.rate_base ?? sm.orders)}
                  foot={<><span className="block">{f(fu?.confirmed ?? sm.confirmed)} confirmées sur {f(fu?.rate_base ?? sm.rate_base)}</span><Trend d={periodDelta("rate", fu?.confirmed, pf?.confirmed, fu?.rate_base, pf?.rate_base)} /></>}
                  icon={BadgeCheck}
                />
                <Kpi
                  label="Taux de livraison"
                  value={fu ? deliveryRate(fu.delivered, fu.returned) : insights.isError ? "—" : "…"}
                  foot={fu ? <><span className="block">{f(fu.delivered)} livrées sur {f(Number(fu.delivered || 0) + Number(fu.returned || 0))} colis arrivés{Number(fu.in_progress) ? " · " + f(fu.in_progress) + " en route" : ""}</span><Trend d={periodDelta("rate", fu.delivered, pf?.delivered, Number(fu.delivered || 0) + Number(fu.returned || 0), Number(pf?.delivered || 0) + Number(pf?.returned || 0))} /></> : "Livrées ÷ (livrées + retournées)"}
                  icon={PackageCheck}
                />
                <Kpi
                  label="COD livré"
                  value={fu ? money(fu.delivered_cod) : insights.isError ? "—" : "…"}
                  foot={<><span className="block">Colis livrés · argent pas encore vérifié</span><Trend d={periodDelta("count", fu?.delivered_cod, pf?.delivered_cod)} /></>}
                  icon={Coins}
                  onClick={s.manager ? () => scrollToDelivered() : undefined}
                />
              </Card>
              {legacy > 0 && (
                <Notice tone="warning">
                  {f(legacy)} anciennes commandes ont un statut « confirmé » ou « annulé » venu de WooCommerce, sans appel vérifié : elles ne comptent pas dans ces chiffres.
                </Notice>
              )}
              {insights.isError ? (
                <Notice tone="danger" role="alert">Analyse détaillée indisponible : {safeError(insights.error)}</Notice>
              ) : !x ? (
                <Loading text="Analyse du parcours des commandes…" />
              ) : (
                <>
                  <Alerts x={x} />
                  <Journey x={x} />
                </>
              )}
              <Card className="gap-0 p-5 sm:p-6">
                <div>
                  <h2 className="font-semibold">Évolution des commandes</h2>
                  <p className="text-sm text-muted-foreground">Par jour de création{(r.days || []).length > 31 ? " (regroupées par semaine ou par mois)" : ""}</p>
                </div>
                <div className="mt-3 mb-4 flex gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-chart-2" aria-hidden />Reçues</span>
                  <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-chart-1" aria-hidden />Confirmées</span>
                </div>
                <Chart days={r.days || []} />
              </Card>
              <details className="group rounded-lg border bg-card px-4 py-3 text-sm">
                <summary className="flex cursor-pointer list-none items-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
                  Comment lire ce rapport
                </summary>
                <ul className="mt-2 grid list-disc gap-1 pl-9 text-muted-foreground">
                  <li>On suit les commandes <b className="text-foreground">créées</b> pendant la période, jusqu’à aujourd’hui : une commande du 3 livrée le 10 compte dans la période qui contient le 3.</li>
                  <li>Confirmée ne veut pas dire livrée ; livrée chez ZR ne veut pas dire argent reçu.</li>
                  <li>Les flèches comparent à la période de même durée juste avant.</li>
                  <li>Les anciens statuts déduits de WooCommerce ne comptent ni comme confirmés ni comme annulés.</li>
                  {Number(sm.woo_orders) > 0 && <li>Suivi WooCommerce : {f(sm.woo_purchase_marked)} commandes sur {f(sm.woo_orders)} ont un Purchase CAPI marqué envoyé par la Suite ; ne comparez pas les autres aux achats Meta.</li>}
                </ul>
              </details>
            </TabsContent>

            <TabsContent value="losses" className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              {x ? <LostReasons x={x} /> : <Loading />}
              <Card className="gap-4 self-start p-5 sm:p-6">
                <div>
                  <h2 className="font-semibold">Où en sont les commandes</h2>
                  <p className="text-sm text-muted-foreground">Statut d’aujourd’hui des {f(sm.orders)} commandes de la période</p>
                </div>
                <StatusBars s={sm} />
              </Card>
            </TabsContent>

            <TabsContent value="wilayas" className="mt-4">{x ? <Wilayas x={x} /> : <Loading />}</TabsContent>

            <TabsContent value="team" className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-5">{x ? <><Agents x={x} /><BasketAndHours x={x} /></> : <Loading />}</TabsContent>

            <TabsContent value="products" className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
              <Section title="Par produit" description="Montant des lignes, hors frais de livraison">
                <DataTable head={["Produit", "Commandées", "Confirmées", "Montant confirmé"]} right={[1, 2, 3]} empty="Aucun produit dans cette sélection."
                  rows={(r.products || []).map((c) => [<>{c.name}<span className="block text-xs font-normal text-muted-foreground">{c.sku}</span></>, f(c.units), f(c.confirmed_units), money(c.confirmed_lines_amount)])} />
              </Section>
              <Section title="Par canal" description="Site web, WhatsApp, Messenger, Instagram, téléphone et saisie manuelle">
                <DataTable head={["Canal", "Reçues", "Confirmées", "Taux", "Montant confirmé"]} right={[1, 2, 3, 4]} empty="Les commandes par message apparaîtront selon leur canal de saisie."
                  rows={(r.channels || []).map((c) => [CHANNELS[c.channel] || c.channel, f(c.orders), f(c.confirmed), reportRate(c.confirmed, c.rate_base ?? c.orders), money(c.confirmed_amount)])} />
              </Section>
            </TabsContent>

            {s.manager && (
              <TabsContent value="money" className="mt-4">
          {fl.agent ? (
              <Card className="gap-2 p-5 sm:p-6">
                <h2 className="font-semibold">Livraison & marge COD</h2>
                <p className="text-sm text-muted-foreground">Ce rapport de livraison est calculé pour toute la boutique. Choisissez « Tous les agents » pour voir des chiffres cohérents avec les filtres.</p>
              </Card>
            ) : (
              <section className="grid gap-5">
                <Card className="gap-4 p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">Livraison & marge COD</h2>
                      <p className="text-sm text-muted-foreground">Ce qu’il reste après le coût des produits, les frais ZR et vos dépenses saisies.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => scrollToDelivered()}>Voir les commandes livrées</Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg bg-muted p-4">
                      <p className="text-xs text-muted-foreground">Marge après produits et frais ZR</p>
                      <p className="num mt-1 text-xl font-semibold">{d.contribution === null || d.contribution === undefined ? "—" : money(d.contribution)}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        COD livré − coûts d’achat estimés des produits livrés − frais ZR de tous les colis rattachés.{" "}
                        {missing ? `Calcul bloqué : ${f(d.missing_product_cost)} colis livrés sans coût d’achat et ${f(d.missing_shipping_cost)} colis sans frais ZR.` : "Coûts renseignés sur les colis concernés."}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted p-4">
                      <p className="text-xs text-muted-foreground">Résultat après dépenses saisies</p>
                      <p className="num mt-1 text-xl font-semibold">{fl.channel || d.after_recorded_expenses === null || d.after_recorded_expenses === undefined ? "—" : money(d.after_recorded_expenses)}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {fl.channel
                          ? "Les dépenses de la boutique ne sont pas réparties par canal. Affichez « Tous les canaux » pour ce résultat."
                          : `Publicité saisie : ${money(d.ads_recorded)} · exploitation saisie : ${money(d.operations_recorded)}. Les dépenses absentes ne valent pas zéro : ce résultat n’est pas un bénéfice net comptable.`}
                      </p>
                    </div>
                  </div>
                  <Notice>
                    Commandes WooCommerce dans ce rapport : {f(d.woo_delivered)} livrées sur {f(d.woo_orders)}. {f(d.delivery_issues)} colis sont en retour ou en échec. Le statut ZR « Livré » ne prouve pas le reversement.
                  </Notice>
                </Card>
                <div className="grid gap-5 lg:grid-cols-2">
                  <Section className="self-start" title="Livraison par canal" description="La période suit la création des commandes, pas la date de livraison.">
                    <DataTable head={["Canal", "Reçues", "Expédiées", "Livrées", "Retournées", "COD livré"]} right={[1, 2, 3, 4, 5]} empty="Aucun colis rattaché pour ce filtre."
                      rows={(delivery.data?.channels || []).map((x) => [CHANNELS[x.channel] || x.channel, f(x.orders), f(x.shipped), f(x.delivered), f(x.returned), money(x.delivered_cod)])} />
                  </Section>
                  <Card className="gap-3 p-5 sm:p-6">
                    <h2 className="font-semibold">Ajouter une dépense</h2>
                    <p className="text-sm text-muted-foreground">Renseignez les dépenses réelles de publicité et d’exploitation pour compléter la marge.</p>
                    <form
                      key={expenseKey}
                      className="grid gap-4"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
                        expenseSub.run(async () => {
                          // One request id per draft: a retry after a network cut cannot record the expense twice.
                          await rpc("crm_cost_command", { p_store: s.store, p_action: "expense", p: { ...v, amount: Number(v.amount), request_id: expenseKey } })
                          toast.success("Coût enregistré.")
                          setExpenseKey(requestId())
                          await qc.invalidateQueries({ queryKey: ["store", s.store] })
                        })
                      }}
                    >
                      <div className="grid gap-4 sm:grid-cols-2">
                        <FormField label="Date" htmlFor="ex-date" required><Input id="ex-date" name="spent_on" type="date" defaultValue={today} max={today} required /></FormField>
                        <FormField label="Type" htmlFor="ex-kind" required>
                          <NativeSelect id="ex-kind" name="kind" defaultValue="ads"><NativeSelectOption value="ads">Publicité</NativeSelectOption><NativeSelectOption value="operations">Exploitation</NativeSelectOption></NativeSelect>
                        </FormField>
                        <FormField label="Montant (DA)" htmlFor="ex-amount" required><Input id="ex-amount" name="amount" type="number" min={0} step={0.01} required className="num" /></FormField>
                        <FormField label="Description" htmlFor="ex-note"><Input id="ex-note" name="note" maxLength={160} /></FormField>
                      </div>
                      <FormError message={expenseSub.error} />
                      <div><Button type="submit" disabled={expenseSub.busy}><Plus />Enregistrer la dépense</Button></div>
                    </form>
                  </Card>
                </div>
                {(
            <Card className="gap-0 overflow-hidden py-0">
              <div className="border-b p-4 sm:px-6">
                <h2 id="delivered-period-title" tabIndex={-1} className="scroll-mt-20 font-semibold outline-none">Commandes livrées</h2>
                <p className="text-sm text-muted-foreground">{f(delivered.data?.total)} commande(s) de la période au statut ZR « Livré » aujourd’hui</p>
              </div>
              <DataTable
                head={["Commande", "Client", "Canal", "Commande créée le", "COD demandé", "Statut ZR"]}
                right={[4]}
                empty="Essayez une autre plage de dates ou un autre canal."
                rows={(delivered.data?.orders || []).map((o) => [
                  <button type="button" className="num font-semibold text-primary hover:underline" onClick={() => ui.openOrder(o.order_id)}>#WC{String(o.number).padStart(5, "0")}{o.woo_number && <span className="block text-xs font-normal text-muted-foreground">Woo #{o.woo_number}</span>}</button>,
                  <>{o.customer_name}<span className="block text-xs text-muted-foreground">{o.wilaya}</span></>,
                  CHANNELS[o.channel] || o.channel,
                  new Date(o.created_at).toLocaleString("fr-FR", { timeZone: "Africa/Algiers", dateStyle: "medium", timeStyle: "short" }),
                  money(o.cod_amount),
                  <ZrBadge state={o.state} />,
                ])}
              />
              <Pager total={Number(delivered.data?.total || 0)} page={deliveredPage} onPage={(n) => setDeliveredPage(Math.max(1, n))} />
            </Card>
          )}

                <Section title="Dépenses enregistrées" description={`${f((expenses.data || []).length)} affichées pour la période · maximum 100 lignes${fl.channel ? " · tous les canaux de la boutique" : ""}`}>
                  <DataTable
                    head={["Date", "Type", "Description", "Montant", "Action"]}
                    right={[3]}
                    empty="Le résultat après dépenses reste partiel tant que les frais ne sont pas saisis."
                    rows={(expenses.data || []).map((x) => [
                      x.spent_on,
                      x.kind === "ads" ? "Publicité" : "Exploitation",
                      x.note || "—",
                      money(x.amount),
                      <Button variant="outline" size="sm" onClick={() => setDelExpense(x)} aria-label={"Supprimer la dépense du " + x.spent_on}><Trash2 />Supprimer</Button>,
                    ])}
                  />
                </Section>
              </section>
            )}
              </TabsContent>
            )}
          </Tabs>
        </>
      )}

      {delExpense && (
        <FormDialog
          id="expense-delete-form"
          title="Supprimer cette dépense ?"
          description={<>La dépense du {delExpense.spent_on} de <b>{money(delExpense.amount)}</b> sera retirée des calculs. Cette action est définitive.</>}
          submitLabel="Supprimer"
          busy={delSub.busy}
          error={delSub.error}
          onClose={() => { setDelExpense(null); delSub.reset() }}
          onSubmit={() =>
            delSub.run(async () => {
              await rpc("crm_cost_command", { p_store: s.store, p_action: "delete_expense", p: { id: delExpense.id } })
              setDelExpense(null)
              toast.success("Dépense supprimée.")
              await qc.invalidateQueries({ queryKey: ["store", s.store] })
            })
          }
        >
          <span className="sr-only">Confirmation</span>
        </FormDialog>
      )}
    </>
  )
}
